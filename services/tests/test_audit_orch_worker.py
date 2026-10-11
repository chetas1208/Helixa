from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest

import services.runtime.orchestration as orchestration
from services.integrations.mongodb import (
    MongoDBClient,
    RunModel,
    RunRepository,
    TaskModel,
    TaskRepository,
)
from services.runtime.orchestration import DurableWorker


@pytest.fixture
async def mongo():
    db_name = f"diamond_audit_orch_worker_{uuid.uuid4().hex[:10]}"
    client = MongoDBClient(db_name=db_name)
    await client.init_indexes()
    yield client
    await client.client.drop_database(db_name)
    await MongoDBClient.close(client)


async def test_stale_acquirer_cannot_regress_run_fence_token(mongo):
    task_id, run_id = "audit-task-race", "audit-run-race"
    await TaskRepository(mongo=mongo).create_task(TaskModel(task_id=task_id, fence_token=1))
    await RunRepository(mongo=mongo).create_run(RunModel(run_id=run_id, task_id=task_id, fence_token=1))

    worker1 = DurableWorker(worker_id="audit-w1", mongo_client=mongo, lease_seconds=1)
    worker2 = DurableWorker(worker_id="audit-w2", mongo_client=mongo, lease_seconds=30)

    real_acquire = worker1.tasks.acquire_lease

    async def acquire_then_stall(*args, **kwargs):
        result = await real_acquire(*args, **kwargs)
        # worker1 stalls after winning the lease; its lease expires and worker2 takes over
        await mongo.db.tasks.update_one(
            {"task_id": task_id}, {"$set": {"worker_lease_owner": None, "worker_lease_expiry": None}}
        )
        assert await worker2.acquire_lease(task_id) is True
        return result

    worker1.tasks.acquire_lease = acquire_then_stall
    assert await worker1.acquire_lease(task_id) is True
    assert worker2.fence_token > worker1.fence_token

    run = await RunRepository(mongo=mongo).get_run(run_id)
    assert run is not None
    assert run.fence_token == worker2.fence_token
    assert run.worker_lease_owner == "audit-w2"


async def test_acquire_updates_run_fence_token_and_owner(mongo):
    task_id, run_id = "audit-task-ok", "audit-run-ok"
    await TaskRepository(mongo=mongo).create_task(TaskModel(task_id=task_id, fence_token=1))
    await RunRepository(mongo=mongo).create_run(RunModel(run_id=run_id, task_id=task_id, fence_token=1))

    worker = DurableWorker(worker_id="audit-w1", mongo_client=mongo)
    assert await worker.acquire_lease(task_id) is True
    assert worker.fence_token == 2
    run = await RunRepository(mongo=mongo).get_run(run_id)
    assert run is not None
    assert (run.fence_token, run.worker_lease_owner) == (2, "audit-w1")

    other = DurableWorker(worker_id="audit-w2", mongo_client=mongo)
    assert await other.acquire_lease(task_id) is False
    run = await RunRepository(mongo=mongo).get_run(run_id)
    assert run is not None and run.fence_token == 2


async def test_run_single_job_keeps_fence_token_monotonic(mongo):
    task_id = "task-demo-incident"
    await TaskRepository(mongo=mongo).create_task(TaskModel(task_id=task_id, fence_token=7))

    worker = DurableWorker(worker_id="audit-w1", mongo_client=mongo)
    seen: dict[str, int] = {}

    async def fake_process_task(tid, rid, vcf_name):
        doc = await mongo.db.tasks.find_one({"task_id": tid}, {"_id": 0})
        seen["fence_token"] = doc["fence_token"]

    worker.process_task = fake_process_task
    mongo.close = AsyncMock()
    await worker.run_single_job(resume=False)

    assert seen["fence_token"] >= 7


async def test_run_single_job_closes_client_when_task_fails(mongo):
    worker = DurableWorker(worker_id="audit-w1", mongo_client=mongo)
    worker.process_task = AsyncMock(side_effect=RuntimeError("boom"))
    mongo.close = AsyncMock()

    with pytest.raises(RuntimeError, match="boom"):
        await worker.run_single_job(resume=False)

    mongo.close.assert_awaited_once()


async def test_release_lease_swallows_only_fencing_conflict(mongo):
    task_id = "audit-task-release"
    await TaskRepository(mongo=mongo).create_task(TaskModel(task_id=task_id, fence_token=1))
    worker = DurableWorker(worker_id="audit-w1", mongo_client=mongo)
    assert await worker.acquire_lease(task_id) is True

    stale = DurableWorker(worker_id="audit-w0", mongo_client=mongo)
    assert await stale.release_lease(task_id) is False
    assert await worker.release_lease(task_id) is True
    task = await TaskRepository(mongo=mongo).get_task(task_id)
    assert task is not None and task.worker_lease_owner is None


def test_package_exports_resolve():
    for name in orchestration.__all__:
        assert getattr(orchestration, name) is not None
