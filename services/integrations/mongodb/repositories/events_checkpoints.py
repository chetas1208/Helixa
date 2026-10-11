from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from pymongo import ReturnDocument

from services.integrations.mongodb.models import CheckpointModel, RunEventModel

from .base import BaseRepository


class EventRepository(BaseRepository):
    async def append_event(
        self,
        run_id: str,
        event_type: str,
        entity_id: str | None = None,
        evidence_digest: str | None = None,
        idempotency_key: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> RunEventModel:
        """
        Atomically allocates a monotonic sequence number and stores the event.
        Guarantees concurrency safety without index collision.
        Supports idempotency deduplication if idempotency_key is provided.
        """
        if idempotency_key:
            existing = await self.db.run_events.find_one(
                {"run_id": run_id, "idempotency_key": idempotency_key},
                {"_id": 0},
            )
            if existing:
                return RunEventModel(**existing)

        # Atomic sequence allocation using dedicated run sequence counter
        counter_doc = await self.db.run_sequence_counters.find_one_and_update(
            {"run_id": run_id},
            {"$inc": {"seq": 1}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        seq: int = counter_doc.get("seq", 1)

        event = RunEventModel(
            event_id=f"evt-{run_id}-{seq}",
            run_id=run_id,
            seq=seq,
            timestamp=datetime.now(UTC).isoformat(),
            event_type=event_type,
            entity_id=entity_id,
            evidence_digest=evidence_digest,
            idempotency_key=idempotency_key,
            payload=payload or {},
        )

        await self.db.run_events.replace_one(
            {"run_id": run_id, "seq": seq},
            event.model_dump(),
            upsert=True,
        )

        # Synchronize seq_counter onto run document if present
        await self.db.runs.update_one(
            {"run_id": run_id},
            {
                "$max": {"seq_counter": seq},
                "$set": {"updated_at": datetime.now(UTC).isoformat()},
            },
        )

        return event

    async def get_events(
        self,
        run_id: str,
        after_seq: int = 0,
        limit: int = 100,
    ) -> list[RunEventModel]:
        cursor = self.db.run_events.find(
            {"run_id": run_id, "seq": {"$gt": after_seq}},
            {"_id": 0},
        ).sort("seq", 1).limit(limit)
        docs = await cursor.to_list(length=limit)
        return [RunEventModel(**d) for d in docs]

    async def get_latest_event(self, run_id: str) -> RunEventModel | None:
        doc = await self.db.run_events.find_one(
            {"run_id": run_id},
            {"_id": 0},
            sort=[("seq", -1)],
        )
        return RunEventModel(**doc) if doc else None

class CheckpointRepository(BaseRepository):
    async def save_checkpoint(
        self,
        checkpoint: CheckpointModel,
    ) -> CheckpointModel:
        await self.db.checkpoints.replace_one(
            {"checkpoint_id": checkpoint.checkpoint_id},
            checkpoint.model_dump(),
            upsert=True,
        )
        return checkpoint

    async def get_latest_checkpoint(self, run_id: str) -> CheckpointModel | None:
        doc = await self.db.checkpoints.find_one(
            {"run_id": run_id},
            {"_id": 0},
            sort=[("step_index", -1)],
        )
        return CheckpointModel(**doc) if doc else None

    async def list_checkpoints(self, run_id: str) -> list[CheckpointModel]:
        cursor = self.db.checkpoints.find(
            {"run_id": run_id},
            {"_id": 0},
        ).sort("step_index", 1)
        docs = await cursor.to_list(length=None)
        return [CheckpointModel(**d) for d in docs]
