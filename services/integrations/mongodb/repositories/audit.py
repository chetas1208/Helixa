from __future__ import annotations

from services.integrations.mongodb.models import IntegrationEventModel, ResearchMemoryModel

from .base import BaseRepository


class MemoryRepository(BaseRepository):
    async def save_memory(self, memory: ResearchMemoryModel) -> ResearchMemoryModel:
        await self.db.research_memories.replace_one(
            {"memory_id": memory.memory_id},
            memory.model_dump(),
            upsert=True,
        )
        return memory

    async def list_by_run(self, run_id: str) -> list[ResearchMemoryModel]:
        cursor = self.db.research_memories.find({"run_id": run_id}, {"_id": 0}).sort("timestamp", 1)
        docs = await cursor.to_list(length=None)
        return [ResearchMemoryModel(**d) for d in docs]

class IntegrationEventRepository(BaseRepository):
    async def log_event(self, event: IntegrationEventModel) -> IntegrationEventModel:
        await self.db.integration_events.replace_one(
            {"event_id": event.event_id},
            event.model_dump(),
            upsert=True,
        )
        return event

    async def list_events(self, component: str | None = None, limit: int = 50) -> list[IntegrationEventModel]:
        query = {"component": component} if component else {}
        cursor = self.db.integration_events.find(query, {"_id": 0}).sort("timestamp", -1).limit(limit)
        docs = await cursor.to_list(length=limit)
        return [IntegrationEventModel(**d) for d in docs]
