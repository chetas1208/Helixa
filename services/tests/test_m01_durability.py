import asyncio

import pytest
from pymongo.errors import ConfigurationError

from services.integrations.mongodb import (
    EventRepository,
    FencingTokenConflictError,
    HarnessRepository,
    HarnessStatus,
    HarnessVersionModel,
    InvalidStateTransitionError,
    MongoDBClient,
    RunModel,
    RunRepository,
    RunState,
    TaskModel,
    TaskRepository,
    TaskStatus,
    sanitize_mongodb_uri,
    validate_state_transition,
)
from services.runtime.orchestration import DurableWorker


@pytest.mark.asyncio
async def test_uri_sanitization():
    raw_uri = "mongodb+srv://admin_user:SuperSecretP@ss123@cluster0.abcde.mongodb.net/diamond_genome?retryWrites=true"
    sanitized = sanitize_mongodb_uri(raw_uri)
    assert "SuperSecretP@ss123" not in sanitized
    assert "admin_user:****@" in sanitized

@pytest.mark.asyncio
async def test_require_atlas_guard():
    # If require_atlas is True but URI points to localhost, must reject
    with pytest.raises(ConfigurationError) as exc_info:
        MongoDBClient(
            uri="mongodb://127.0.0.1:27017",
            require_atlas=True,
        )
    assert "MONGODB_REQUIRE_ATLAS is true, but URI" in str(exc_info.value)
    assert "Refusing silent fallback" in str(exc_info.value)

@pytest.mark.asyncio
async def test_database_ping_and_write_verification():
    client = MongoDBClient()
    ok = await client.ping()
    assert ok is True

    write_ok = await client.verify_write()
    assert write_ok is True

    status_diag = await client.check_status()
    assert status_diag["status"] == "WRITE_VERIFIED"
    assert status_diag["mode"] == "local"
    assert status_diag["write_verified"] is True
    assert status_diag["error"] is None
    await client.close()

@pytest.mark.asyncio
async def test_all_12_collection_indexes_created():
    client = MongoDBClient()
    indexes = await client.init_indexes()
    expected_collections = [
        "datasets",
        "artifacts",
        "tasks",
        "runs",
        "run_events",
        "checkpoints",
        "harness_versions",
        "harness_mutations",
        "evaluations",
        "evidence_receipts",
        "research_memories",
        "integration_events",
    ]
    for col in expected_collections:
        assert col in indexes, f"Collection index missing for {col}"
    await client.close()

@pytest.mark.asyncio
async def test_atomic_monotonic_event_sequencing_under_concurrency():
    """
    Spawns 50 concurrent tasks emitting events to the same run.
    Verifies that atomic $inc guarantees strictly unique, monotonic sequences
    without duplicate key collisions on uniq_run_seq.
    """
    client = MongoDBClient()
    await client.init_indexes()
    event_repo = EventRepository(mongo=client)
    run_id = f"test-concurrent-seq-{int(asyncio.get_event_loop().time() * 1000)}"

    num_concurrent = 50

    async def emit_worker(i: int):
        return await event_repo.append_event(
            run_id=run_id,
            event_type="test.concurrent.event",
            payload={"worker_index": i},
        )

    # Launch all 50 concurrent appends
    results = await asyncio.gather(*(emit_worker(i) for i in range(num_concurrent)))
    assert len(results) == num_concurrent

    # Fetch all stored events ordered by seq
    stored_events = await event_repo.get_events(run_id=run_id, after_seq=0, limit=100)
    assert len(stored_events) == num_concurrent

    seq_numbers = [e.seq for e in stored_events]
    # Check that sequence numbers are strictly 1..50 with no gaps or duplicates
    expected_seqs = list(range(1, num_concurrent + 1))
    assert seq_numbers == expected_seqs

    # Clean up test events
    await client.db.run_events.delete_many({"run_id": run_id})
    await client.db.run_sequence_counters.delete_many({"run_id": run_id})
    await client.close()

@pytest.mark.asyncio
async def test_event_idempotency_deduplication():
    client = MongoDBClient()
    await client.init_indexes()
    event_repo = EventRepository(mongo=client)
    run_id = "test-idempotency-run"
    idempotency_key = "idemp-key-12345"

    await client.db.run_events.delete_many({"run_id": run_id})
    await client.db.run_sequence_counters.delete_many({"run_id": run_id})

    # First append with idempotency key
    evt1 = await event_repo.append_event(
        run_id=run_id,
        event_type="run.test.once",
        idempotency_key=idempotency_key,
        payload={"attempt": 1},
    )

    # Second append with identical idempotency key
    evt2 = await event_repo.append_event(
        run_id=run_id,
        event_type="run.test.once",
        idempotency_key=idempotency_key,
        payload={"attempt": 2},
    )

    assert evt1.seq == evt2.seq
    assert evt1.event_id == evt2.event_id
    assert evt2.payload.get("attempt") == 1  # Original document preserved

    events = await event_repo.get_events(run_id=run_id)
    assert len(events) == 1

    await client.db.run_events.delete_many({"run_id": run_id})
    await client.db.run_sequence_counters.delete_many({"run_id": run_id})
    await client.close()

@pytest.mark.asyncio
async def test_worker_lease_fencing_generation_tokens():
    """
    Verifies that when Worker 2 takes over a lease, Worker 1's stale fence_token
    causes all subsequent state updates to be rejected with FencingTokenConflictError.
    """
    client = MongoDBClient()
    await client.init_indexes()
    task_repo = TaskRepository(mongo=client)
    run_repo = RunRepository(mongo=client)

    task_id = "test-fencing-task"
    run_id = "test-fencing-run"

    await client.db.tasks.delete_many({"task_id": task_id})
    await client.db.runs.delete_many({"run_id": run_id})

    # Create task and run
    await task_repo.create_task(TaskModel(task_id=task_id, status=TaskStatus.CREATED, fence_token=1))
    await run_repo.create_run(RunModel(run_id=run_id, task_id=task_id, status=RunState.CREATED, fence_token=1))

    # Worker 1 acquires lease
    worker1 = DurableWorker(worker_id="worker-node-1", mongo_client=client, lease_seconds=1)
    acq1 = await worker1.acquire_lease(task_id)
    assert acq1 is True
    fence_token_1 = worker1.fence_token
    assert fence_token_1 >= 2

    # Worker 1 updates task/run state successfully with its fence token
    updated_run = await run_repo.transition_state(run_id, RunState.VALIDATING, fence_token=fence_token_1)
    assert updated_run.status == RunState.VALIDATING

    # Simulate lease expiry for Worker 1
    await client.db.tasks.update_one(
        {"task_id": task_id},
        {"$set": {"worker_lease_owner": None, "worker_lease_expiry": None}},
    )

    # Worker 2 acquires lease -> increments fence_token
    worker2 = DurableWorker(worker_id="worker-node-2", mongo_client=client, lease_seconds=30)
    acq2 = await worker2.acquire_lease(task_id)
    assert acq2 is True
    fence_token_2 = worker2.fence_token
    assert fence_token_2 > fence_token_1

    # Worker 1 wakes up (e.g. after GC pause) and tries to transition or update run
    with pytest.raises(FencingTokenConflictError) as exc_info:
        await run_repo.transition_state(run_id, RunState.DIAGNOSING, fence_token=fence_token_1)
    assert "fencing token" in str(exc_info.value)

    # Worker 1 tries to release lease -> fails
    released_by_stale = await worker1.release_lease(task_id)
    assert released_by_stale is False

    # Worker 2 transitions successfully
    res2 = await run_repo.transition_state(run_id, RunState.DIAGNOSING, fence_token=fence_token_2)
    assert res2.status == RunState.DIAGNOSING

    # Worker 2 successfully releases lease
    released_by_active = await worker2.release_lease(task_id)
    assert released_by_active is True

    await client.db.tasks.delete_many({"task_id": task_id})
    await client.db.runs.delete_many({"run_id": run_id})
    await client.close()

@pytest.mark.asyncio
async def test_state_machine_illegal_transition_rejection():
    # Attempting to jump directly from CREATED to COMPLETED is forbidden
    with pytest.raises(InvalidStateTransitionError) as exc_info:
        validate_state_transition(RunState.CREATED, RunState.COMPLETED)
    assert "Illegal state transition" in str(exc_info.value)

    # Transitioning out of COMPLETED terminal state is forbidden
    with pytest.raises(InvalidStateTransitionError):
        validate_state_transition(RunState.COMPLETED, RunState.VALIDATING)

    # Valid transitions succeed without exception
    validate_state_transition(RunState.CREATED, RunState.VALIDATING)
    validate_state_transition(RunState.VALIDATING, RunState.DIAGNOSING)
    validate_state_transition(RunState.DIAGNOSING, RunState.MUTATING)
    validate_state_transition(RunState.MUTATING, RunState.EVALUATING)
    validate_state_transition(RunState.EVALUATING, RunState.PROMOTED)
    validate_state_transition(RunState.PROMOTED, RunState.COMPLETED)

@pytest.mark.asyncio
async def test_harness_genealogy_lineage_graph():
    client = MongoDBClient()
    harness_repo = HarnessRepository(mongo=client)

    root = HarnessVersionModel(
        version_id="harness-root",
        harness_id="diamond-genome",
        status=HarnessStatus.BASELINE,
    )
    child = HarnessVersionModel(
        version_id="harness-child",
        harness_id="diamond-genome",
        parent_version_id="harness-root",
        status=HarnessStatus.CANDIDATE,
    )

    await harness_repo.save_version(root)
    await harness_repo.save_version(child)

    lineage = await harness_repo.get_lineage("harness-root")
    assert lineage["root_version_id"] == "harness-root"
    node_ids = [n["id"] for n in lineage["nodes"]]
    assert "harness-root" in node_ids
    assert "harness-child" in node_ids

    edges = lineage["edges"]
    matching_edges = [e for e in edges if e["source"] == "harness-root" and e["target"] == "harness-child"]
    assert len(matching_edges) == 1

    await client.db.harness_versions.delete_many({"version_id": {"$in": ["harness-root", "harness-child"]}})
    await client.close()
