from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from pymongo import ReturnDocument

from services.integrations.mongodb.models import (
    FencingTokenConflictError,
    RunModel,
    RunState,
    TaskModel,
    TaskStatus,
    validate_state_transition,
)

from .base import BaseRepository

_TRANSITION_ATTEMPTS = 5


class TaskRepository(BaseRepository):
    async def create_task(self, task: TaskModel) -> TaskModel:
        doc = task.model_dump()
        fence_token = doc.pop("fence_token")
        # $max keeps the fencing generation monotonic when a task id is re-created
        await self.db.tasks.update_one(
            {"task_id": task.task_id},
            {"$set": doc, "$max": {"fence_token": fence_token}},
            upsert=True,
        )
        return task

    async def get_task(self, task_id: str) -> TaskModel | None:
        doc = await self.db.tasks.find_one({"task_id": task_id}, {"_id": 0})
        return TaskModel(**doc) if doc else None

    async def acquire_lease(
        self,
        task_id: str,
        worker_id: str,
        lease_seconds: int = 30,
    ) -> tuple[bool, int]:
        """
        Atomically acquire or re-acquire lease on task.
        Increments fence_token on acquisition.
        Returns (acquired: bool, fence_token: int).
        """
        now = datetime.now(UTC)
        expiry = now + timedelta(seconds=lease_seconds)

        updated_doc = await self.db.tasks.find_one_and_update(
            {
                "task_id": task_id,
                "$or": [
                    {"worker_lease_owner": None},
                    {"worker_lease_expiry": {"$lt": now.isoformat()}},
                    {"worker_lease_owner": worker_id},
                ],
            },
            {
                "$set": {
                    "worker_lease_owner": worker_id,
                    "worker_lease_expiry": expiry.isoformat(),
                    "status": TaskStatus.RUNNING.value,
                    "updated_at": now.isoformat(),
                },
                "$inc": {"fence_token": 1},
            },
            return_document=ReturnDocument.AFTER,
        )
        if updated_doc:
            return True, updated_doc.get("fence_token", 1)

        # Could not acquire lease
        curr = await self.get_task(task_id)
        token = curr.fence_token if curr else 0
        return False, token

    async def renew_lease(
        self,
        task_id: str,
        worker_id: str,
        fence_token: int,
        lease_seconds: int = 30,
    ) -> bool:
        """Renew active lease without changing fence token, protected by fencing token match."""
        now = datetime.now(UTC)
        expiry = now + timedelta(seconds=lease_seconds)

        res = await self.db.tasks.update_one(
            {
                "task_id": task_id,
                "worker_lease_owner": worker_id,
                "fence_token": fence_token,
            },
            {
                "$set": {
                    "worker_lease_expiry": expiry.isoformat(),
                    "updated_at": now.isoformat(),
                }
            },
        )
        return res.modified_count > 0

    async def release_lease(
        self,
        task_id: str,
        worker_id: str,
        fence_token: int,
        final_status: TaskStatus = TaskStatus.COMPLETED,
    ) -> bool:
        now = datetime.now(UTC).isoformat()
        res = await self.db.tasks.update_one(
            {
                "task_id": task_id,
                "worker_lease_owner": worker_id,
                "fence_token": fence_token,
            },
            {
                "$set": {
                    "worker_lease_owner": None,
                    "worker_lease_expiry": None,
                    "status": final_status.value,
                    "updated_at": now,
                }
            },
        )
        if res.matched_count == 0:
            raise FencingTokenConflictError(
                f"Cannot release lease for task {task_id}: fence_token {fence_token} or owner {worker_id} no longer matches."
            )
        return True

class RunRepository(BaseRepository):
    async def create_run(self, run: RunModel) -> RunModel:
        doc = run.model_dump()
        fence_token = doc.pop("fence_token")
        # $max keeps the fencing generation monotonic when a run id is re-created
        await self.db.runs.update_one(
            {"run_id": run.run_id},
            {"$set": doc, "$max": {"fence_token": fence_token}},
            upsert=True,
        )
        return run

    async def get_run(self, run_id: str) -> RunModel | None:
        doc = await self.db.runs.find_one({"run_id": run_id}, {"_id": 0})
        return RunModel(**doc) if doc else None

    async def transition_state(
        self,
        run_id: str,
        target_state: RunState,
        fence_token: int | None = None,
        additional_updates: dict[str, Any] | None = None,
    ) -> RunModel:
        """
        Transition run to target state with graph enforcement and fencing verification.
        """
        for _ in range(_TRANSITION_ATTEMPTS):
            current_run = await self.get_run(run_id)
            if not current_run:
                raise ValueError(f"Run '{run_id}' not found")

            # Fencing check: reject stale generation workers upfront
            if fence_token is not None and current_run.fence_token != fence_token:
                raise FencingTokenConflictError(
                    f"State transition to {target_state.value} rejected for run {run_id}: "
                    f"fencing token {fence_token} is stale (active generation: {current_run.fence_token})."
                )

            # Enforce state machine transition rules
            validate_state_transition(current_run.status, target_state)

            # Compare-and-set on the validated status so a concurrent change cannot be overwritten
            query: dict[str, Any] = {"run_id": run_id, "status": current_run.status.value}
            if fence_token is not None:
                query["fence_token"] = fence_token

            updates: dict[str, Any] = {
                "status": target_state.value,
                "updated_at": datetime.now(UTC).isoformat(),
            }
            if additional_updates:
                updates.update(additional_updates)

            res = await self.db.runs.update_one(query, {"$set": updates})
            if res.matched_count:
                break
        else:
            raise ValueError(f"Run '{run_id}' could not be updated.")

        updated_run = await self.get_run(run_id)
        assert updated_run is not None
        return updated_run

    async def update_run(
        self,
        run_id: str,
        updates: dict[str, Any],
        fence_token: int | None = None,
    ) -> RunModel:
        query: dict[str, Any] = {"run_id": run_id}
        if fence_token is not None:
            query["fence_token"] = fence_token

        updates = {**updates, "updated_at": datetime.now(UTC).isoformat()}
        res = await self.db.runs.update_one(query, {"$set": updates})
        if res.matched_count == 0 and fence_token is not None:
            raise FencingTokenConflictError(
                f"Update rejected for run {run_id}: fence_token {fence_token} mismatch."
            )
        run = await self.get_run(run_id)
        if not run:
            raise ValueError(f"Run '{run_id}' not found")
        return run

    async def list_runs(self, limit: int = 50) -> list[RunModel]:
        cursor = self.db.runs.find({}, {"_id": 0}).sort("created_at", -1)
        docs = await cursor.to_list(length=limit)
        return [RunModel(**d) for d in docs]
