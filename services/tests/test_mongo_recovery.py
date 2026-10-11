import pytest

from services.integrations.mongodb import MongoDBClient
from services.runtime.orchestration import AgentRunner, DurableWorker


@pytest.mark.asyncio
async def test_mongo_indexes_and_collections():
    client = MongoDBClient()
    ok = await client.ping()
    assert ok is True
    indexes = await client.init_indexes()
    assert "run_events" in indexes
    assert "checkpoints" in indexes
    assert "evidence_receipts" in indexes
    await client.close()

@pytest.mark.asyncio
async def test_orchestrator_execution_and_receipt_persistence():
    client = MongoDBClient()
    await client.init_indexes()
    runner = AgentRunner(client)

    task_id = "test-task-001"
    run_id = "test-run-001"

    # Ensure clean test state
    await client.db.runs.delete_many({"run_id": run_id})
    await client.db.checkpoints.delete_many({"run_id": run_id})
    await client.db.run_events.delete_many({"run_id": run_id})
    await client.db.run_sequence_counters.delete_many({"run_id": run_id})
    await client.db.evidence_receipts.delete_many({"run_id": run_id})

    res = await runner.execute_run(task_id, run_id, "ref_mismatch.vcf")
    assert res["status"] == "PROMOTED"
    assert res["active_harness_version"] == "harness-v2-candidate"

    # Verify receipt exists in MongoDB
    receipt_doc = await client.db.evidence_receipts.find_one({"run_id": run_id})
    assert receipt_doc is not None
    assert receipt_doc["promoted"] is True
    assert receipt_doc["score"] == "6/6"

    # Verify monotonic event sequence
    events = await client.db.run_events.find({"run_id": run_id}).sort("seq", 1).to_list(length=100)
    assert len(events) >= 6
    seqs = [e["seq"] for e in events]
    assert seqs == list(range(1, len(seqs) + 1))

    # Verify checkpoints
    checkpoints = await client.db.checkpoints.find({"run_id": run_id}).to_list(length=100)
    assert len(checkpoints) >= 3

    await client.close()

@pytest.mark.asyncio
async def test_durable_worker_lease_and_resume():
    client = MongoDBClient()
    await client.init_indexes()
    worker = DurableWorker(mongo_uri=client.uri)

    task_id = "test-task-lease"

    # Create task
    await client.db.tasks.replace_one(
        {"task_id": task_id},
        {"task_id": task_id, "status": "CREATED", "worker_lease_owner": None, "worker_lease_expiry": None},
        upsert=True,
    )

    # Acquire lease
    acquired = await worker.acquire_lease(task_id)
    assert acquired is True

    # Attempt acquire by another worker should succeed only if expired
    other_worker = DurableWorker(mongo_uri=client.uri)
    reacquire = await other_worker.acquire_lease(task_id)
    assert reacquire is False

    await worker.release_lease(task_id)
    await client.close()
