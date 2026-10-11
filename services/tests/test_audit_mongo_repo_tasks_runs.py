from __future__ import annotations

import asyncio
import uuid

import pytest

from services.integrations.mongodb import (
    FencingTokenConflictError,
    MongoDBClient,
    RunModel,
    RunRepository,
    RunState,
    TaskModel,
    TaskRepository,
    TaskStatus,
)
from services.integrations.mongodb.models import InvalidStateTransitionError


@pytest.fixture
async def mongo():
    db_name = f"diamond_audit_mongo_repo_tasks_runs_{uuid.uuid4().hex[:10]}"
    client = MongoDBClient(db_name=db_name)
    await client.init_indexes()
    yield client
    await client.client.drop_database(db_name)
    await MongoDBClient.close(client)


async def test_create_task_never_regresses_fence_token(mongo):
    tasks = TaskRepository(mongo=mongo)
    await tasks.create_task(TaskModel(task_id="t1", fence_token=1))
    assert await tasks.acquire_lease("t1", "w1") == (True, 2)
    assert await tasks.acquire_lease("t1", "w1") == (True, 3)

    await tasks.create_task(TaskModel(task_id="t1"))

    task = await tasks.get_task("t1")
    assert task is not None
    assert task.fence_token == 3
    assert task.status == TaskStatus.CREATED


async def test_create_task_accepts_higher_fence_and_new_task(mongo):
    tasks = TaskRepository(mongo=mongo)
    await tasks.create_task(TaskModel(task_id="t1", fence_token=4))
    created = await tasks.get_task("t1")
    assert created is not None and created.fence_token == 4

    await tasks.create_task(TaskModel(task_id="t1", fence_token=9, dataset_id="other"))
    task = await tasks.get_task("t1")
    assert task is not None
    assert (task.fence_token, task.dataset_id) == (9, "other")
    assert await mongo.db.tasks.count_documents({"task_id": "t1"}) == 1


async def test_create_run_never_regresses_fence_token(mongo):
    runs = RunRepository(mongo=mongo)
    await runs.create_run(RunModel(run_id="r1", task_id="t1", fence_token=5))

    await runs.create_run(RunModel(run_id="r1", task_id="t1"))

    run = await runs.get_run("r1")
    assert run is not None
    assert run.fence_token == 5
    assert await mongo.db.runs.count_documents({"run_id": "r1"}) == 1


async def test_create_run_roundtrip_fields(mongo):
    runs = RunRepository(mongo=mongo)
    model = RunModel(
        run_id="r1", task_id="t1", fence_token=3, vcf_filename="a.vcf", fasta_filename="b.fasta"
    )
    saved = await runs.create_run(model)
    assert saved == model
    assert await runs.get_run("r1") == model
    assert await runs.get_run("missing") is None


class _RacingRunRepository(RunRepository):
    """Lets a concurrent writer change the run right after transition_state read it."""

    def __init__(self, *args, interfere, **kwargs):
        super().__init__(*args, **kwargs)
        self._interfere = interfere

    async def get_run(self, run_id):
        run = await super().get_run(run_id)
        interfere, self._interfere = self._interfere, None
        if interfere is not None:
            await interfere()
        return run


async def test_transition_state_rejects_illegal_transition_after_concurrent_change(mongo):
    await RunRepository(mongo=mongo).create_run(
        RunModel(run_id="r1", task_id="t1", status=RunState.VALIDATING)
    )

    async def other_worker_completes():
        await mongo.db.runs.update_one({"run_id": "r1"}, {"$set": {"status": "COMPLETED"}})

    runs = _RacingRunRepository(mongo=mongo, interfere=other_worker_completes)
    with pytest.raises(InvalidStateTransitionError):
        await runs.transition_state("r1", RunState.DIAGNOSING)

    doc = await mongo.db.runs.find_one({"run_id": "r1"})
    assert doc["status"] == "COMPLETED"


async def test_transition_state_revalidates_against_concurrently_changed_state(mongo):
    await RunRepository(mongo=mongo).create_run(
        RunModel(run_id="r1", task_id="t1", status=RunState.CREATED)
    )

    async def other_worker_advances():
        await mongo.db.runs.update_one({"run_id": "r1"}, {"$set": {"status": "RUNNING"}})

    runs = _RacingRunRepository(mongo=mongo, interfere=other_worker_advances)
    run = await runs.transition_state("r1", RunState.VALIDATING)
    assert run.status == RunState.VALIDATING


async def test_transition_state_fence_taken_over_mid_transition_is_fenced(mongo):
    await RunRepository(mongo=mongo).create_run(
        RunModel(run_id="r1", task_id="t1", status=RunState.CREATED, fence_token=2)
    )

    async def newer_generation_takes_over():
        await mongo.db.runs.update_one({"run_id": "r1"}, {"$set": {"fence_token": 3}})

    runs = _RacingRunRepository(mongo=mongo, interfere=newer_generation_takes_over)
    with pytest.raises(FencingTokenConflictError):
        await runs.transition_state("r1", RunState.RUNNING, fence_token=2)
    doc = await mongo.db.runs.find_one({"run_id": "r1"})
    assert doc["status"] == "CREATED"


async def test_transition_state_basic_contract(mongo):
    runs = RunRepository(mongo=mongo)
    await runs.create_run(RunModel(run_id="r1", task_id="t1", fence_token=2))

    with pytest.raises(ValueError, match="not found"):
        await runs.transition_state("nope", RunState.RUNNING)
    with pytest.raises(FencingTokenConflictError):
        await runs.transition_state("r1", RunState.RUNNING, fence_token=1)
    with pytest.raises(InvalidStateTransitionError):
        await runs.transition_state("r1", RunState.COMPLETED, fence_token=2)

    run = await runs.transition_state(
        "r1", RunState.RUNNING, fence_token=2, additional_updates={"vcf_filename": "x.vcf"}
    )
    assert (run.status, run.vcf_filename) == (RunState.RUNNING, "x.vcf")
    # same-state transition is idempotent
    assert (await runs.transition_state("r1", RunState.RUNNING, fence_token=2)).status == (
        RunState.RUNNING
    )


async def test_update_run_does_not_mutate_caller_dict(mongo):
    runs = RunRepository(mongo=mongo)
    await runs.create_run(RunModel(run_id="r1", task_id="t1"))
    updates = {"evidence_receipt_id": "ev-1"}

    run = await runs.update_run("r1", updates)

    assert run.evidence_receipt_id == "ev-1"
    assert updates == {"evidence_receipt_id": "ev-1"}


async def test_update_run_fencing_and_missing(mongo):
    runs = RunRepository(mongo=mongo)
    await runs.create_run(RunModel(run_id="r1", task_id="t1", fence_token=2))
    with pytest.raises(FencingTokenConflictError):
        await runs.update_run("r1", {"evidence_receipt_id": "x"}, fence_token=1)
    with pytest.raises(ValueError, match="not found"):
        await runs.update_run("nope", {"evidence_receipt_id": "x"})
    run = await runs.update_run("r1", {"evidence_receipt_id": "x"}, fence_token=2)
    assert run.evidence_receipt_id == "x"


async def test_lease_lifecycle_and_fencing(mongo):
    tasks = TaskRepository(mongo=mongo)
    await tasks.create_task(TaskModel(task_id="t1"))

    assert await tasks.acquire_lease("missing", "w1") == (False, 0)
    assert await tasks.acquire_lease("t1", "w1") == (True, 2)
    # live lease held by w1: w2 cannot take it and sees the current token
    assert await tasks.acquire_lease("t1", "w2") == (False, 2)
    assert await tasks.renew_lease("t1", "w1", 2) is True
    assert await tasks.renew_lease("t1", "w1", 1) is False
    assert await tasks.renew_lease("t1", "w2", 2) is False

    with pytest.raises(FencingTokenConflictError):
        await tasks.release_lease("t1", "w1", 1)
    assert await tasks.release_lease("t1", "w1", 2, TaskStatus.FAILED) is True
    task = await tasks.get_task("t1")
    assert task is not None
    assert (task.status, task.worker_lease_owner, task.worker_lease_expiry) == (
        TaskStatus.FAILED,
        None,
        None,
    )


async def test_expired_lease_is_taken_over_with_higher_fence(mongo):
    tasks = TaskRepository(mongo=mongo)
    await tasks.create_task(TaskModel(task_id="t1"))
    assert await tasks.acquire_lease("t1", "w1", lease_seconds=-5) == (True, 2)
    assert await tasks.acquire_lease("t1", "w2") == (True, 3)
    assert await tasks.renew_lease("t1", "w1", 2) is False
    with pytest.raises(FencingTokenConflictError):
        await tasks.release_lease("t1", "w1", 2)


async def test_concurrent_acquire_has_single_winner(mongo):
    tasks = TaskRepository(mongo=mongo)
    await tasks.create_task(TaskModel(task_id="t1"))
    results = await asyncio.gather(*(tasks.acquire_lease("t1", f"w{i}") for i in range(10)))
    assert sum(1 for ok, _ in results if ok) == 1
    task = await tasks.get_task("t1")
    assert task is not None and task.fence_token == 2


async def test_list_runs_newest_first_and_limited(mongo):
    runs = RunRepository(mongo=mongo)
    for i in range(3):
        await runs.create_run(
            RunModel(run_id=f"r{i}", task_id="t", created_at=f"2026-01-0{i + 1}T00:00:00+00:00")
        )
    listed = await runs.list_runs()
    assert [r.run_id for r in listed] == ["r2", "r1", "r0"]
    assert [r.run_id for r in await runs.list_runs(limit=2)] == ["r2", "r1"]
