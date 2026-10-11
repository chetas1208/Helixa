from __future__ import annotations

import asyncio
import logging
import os
import sys
import uuid
from datetime import UTC, datetime
from typing import Any

from services.integrations.mongodb import (
    CheckpointRepository,
    EventRepository,
    FencingTokenConflictError,
    MongoDBClient,
    RunRepository,
    TaskModel,
    TaskRepository,
    TaskStatus,
)
from services.runtime.providers import build_model_provider

from .runner import AgentRunner

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] [%(levelname)s] %(message)s")
logger = logging.getLogger("diamond.worker")

class DurableWorker:
    def __init__(
        self,
        worker_id: str | None = None,
        mongo_uri: str | None = None,
        lease_seconds: int = 30,
        mongo_client: MongoDBClient | None = None,
    ):
        self.worker_id = worker_id or f"worker-{os.getpid()}-{uuid.uuid4().hex[:6]}"
        self.mongo = mongo_client or MongoDBClient(uri=mongo_uri)
        self.lease_seconds = lease_seconds
        self.fence_token: int = 1

        # Repositories
        self.tasks = TaskRepository(mongo=self.mongo)
        self.runs = RunRepository(mongo=self.mongo)
        self.checkpoints = CheckpointRepository(mongo=self.mongo)
        self.events = EventRepository(mongo=self.mongo)

        self.runner = AgentRunner(self.mongo)
        self.runner.proposer = build_model_provider()
        self._running = False

    async def acquire_lease(self, task_id: str) -> bool:
        """Atomic lease acquisition or renewal with generation fencing token."""
        acquired, fence_token = await self.tasks.acquire_lease(
            task_id=task_id,
            worker_id=self.worker_id,
            lease_seconds=self.lease_seconds,
        )
        if acquired:
            self.fence_token = fence_token
            # Also update run with lease owner and fence token if run exists
            await self.mongo.db.runs.update_one(
                {
                    "task_id": task_id,
                    "$or": [
                        {"fence_token": {"$lte": self.fence_token}},
                        {"fence_token": {"$exists": False}},
                    ],
                },
                {
                    "$set": {
                        "worker_lease_owner": self.worker_id,
                        "fence_token": self.fence_token,
                        "updated_at": datetime.now(UTC).isoformat(),
                    }
                },
            )
        return acquired

    async def renew_lease(self, task_id: str) -> bool:
        """Heartbeat renewal guarded by current fence_token."""
        return await self.tasks.renew_lease(
            task_id=task_id,
            worker_id=self.worker_id,
            fence_token=self.fence_token,
            lease_seconds=self.lease_seconds,
        )

    async def release_lease(self, task_id: str, final_status: TaskStatus = TaskStatus.COMPLETED) -> bool:
        """Atomic release guarded by current fence_token."""
        try:
            return await self.tasks.release_lease(
                task_id=task_id,
                worker_id=self.worker_id,
                fence_token=self.fence_token,
                final_status=final_status,
            )
        except FencingTokenConflictError as e:
            logger.warning(f"Lease release skipped due to fencing conflict: {e}")
            return False

    async def process_task(
        self,
        task_id: str,
        run_id: str,
        vcf_name: str = "ref_mismatch.vcf",
    ) -> dict[str, Any] | None:
        logger.info(f"Worker {self.worker_id} claiming task {task_id} (run {run_id})...")
        acquired = await self.acquire_lease(task_id)
        if not acquired:
            logger.warning(f"Could not acquire lease for task {task_id}. Active worker holds lease.")
            return None

        logger.info(f"Worker {self.worker_id} acquired lease with fence_token={self.fence_token}")

        try:
            # Check for existing checkpoint to resume from
            latest_cp = await self.checkpoints.get_latest_checkpoint(run_id)
            if latest_cp:
                logger.info(
                    f"Worker {self.worker_id} resuming run {run_id} from Checkpoint {latest_cp.checkpoint_id} "
                    f"at step {latest_cp.step_index} (state: {latest_cp.state})"
                )
                # Emit recovery event with worker ID and fencing token
                await self.runner.emit_event(
                    run_id=run_id,
                    seq=None,
                    event_type="worker.recovered",
                    entity_id=self.worker_id,
                    payload={
                        "checkpoint_id": latest_cp.checkpoint_id,
                        "resumed_state": latest_cp.state.value if hasattr(latest_cp.state, "value") else str(latest_cp.state),
                        "worker_id": self.worker_id,
                        "fence_token": self.fence_token,
                    },
                )

            # Execute run through the state machine
            res = await self.runner.execute_run(
                task_id=task_id,
                run_id=run_id,
                vcf_filename=vcf_name,
                fence_token=self.fence_token,
            )
            await self.release_lease(task_id, TaskStatus.COMPLETED)
            logger.info(f"Task {task_id} completed successfully. Final status: {res.get('status')}")
            return res
        except FencingTokenConflictError as e:
            logger.error(f"Worker {self.worker_id} fenced out by newer generation worker: {e}")
            raise
        except Exception as e:
            logger.error(f"Error executing task {task_id}: {e}", exc_info=True)
            await self.release_lease(task_id, TaskStatus.FAILED)
            raise

    async def run_single_job(self, resume: bool = False):
        await self.mongo.init_indexes()
        task_id = "task-demo-incident"
        run_id = "run-demo-incident"

        if not resume:
            # Create fresh task in DB
            now = datetime.now(UTC).isoformat()
            existing = await self.tasks.get_task(task_id)
            await self.tasks.create_task(
                TaskModel(
                    task_id=task_id,
                    dataset_id="SYNTH-GENOME-INCIDENT-001",
                    status=TaskStatus.CREATED,
                    worker_lease_owner=None,
                    worker_lease_expiry=None,
                    fence_token=existing.fence_token if existing else 1,
                    created_at=now,
                    updated_at=now,
                )
            )
        else:
            # Expire existing lease to simulate worker timeout recovery
            await self.mongo.db.tasks.update_one(
                {"task_id": task_id},
                {"$set": {"worker_lease_owner": None, "worker_lease_expiry": None}},
            )

        try:
            await self.process_task(task_id, run_id, "ref_mismatch.vcf")
        finally:
            await self.mongo.close()

if __name__ == "__main__":
    resume_flag = "--resume" in sys.argv
    worker = DurableWorker()
    logger.info(f"Starting DurableWorker (resume={resume_flag})...")
    asyncio.run(worker.run_single_job(resume=resume_flag))
