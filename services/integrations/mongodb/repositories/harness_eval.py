from __future__ import annotations

from typing import Any

from services.integrations.mongodb.models import (
    EvaluationModel,
    HarnessMutationModel,
    HarnessVersionModel,
)

from .base import BaseRepository


class HarnessRepository(BaseRepository):
    async def save_version(self, version: HarnessVersionModel) -> HarnessVersionModel:
        await self.db.harness_versions.replace_one(
            {"version_id": version.version_id},
            version.model_dump(),
            upsert=True,
        )
        return version

    async def get_version(self, version_id: str) -> HarnessVersionModel | None:
        doc = await self.db.harness_versions.find_one({"version_id": version_id}, {"_id": 0})
        return HarnessVersionModel(**doc) if doc else None

    async def list_versions(self) -> list[HarnessVersionModel]:
        cursor = self.db.harness_versions.find({}, {"_id": 0}).sort("created_at", 1)
        docs = await cursor.to_list(length=None)
        return [HarnessVersionModel(**d) for d in docs]

    async def get_lineage(self, root_id: str) -> dict[str, Any]:
        """
        Construct genealogical tree nodes and directed edges from persisted harness versions.
        """
        all_versions = await self.list_versions()
        nodes = []
        edges = []
        for h in all_versions:
            nodes.append({
                "id": h.version_id,
                "version_id": h.version_id,
                "harness_id": h.harness_id,
                "status": h.status.value if hasattr(h.status, "value") else str(h.status),
                "parent_id": h.parent_version_id,
                "require_reference_allele_check": h.validation_policy.get("require_reference_allele_check", False),
                "include_reference_metadata": h.context_policy.get("include_reference_metadata", False),
            })
            if h.parent_version_id:
                edges.append({
                    "source": h.parent_version_id,
                    "target": h.version_id,
                    "label": "policy_mutation",
                })
        return {
            "root_version_id": root_id,
            "nodes": nodes,
            "edges": edges,
        }

    async def record_mutation(self, mutation: HarnessMutationModel) -> HarnessMutationModel:
        await self.db.harness_mutations.replace_one(
            {"mutation_id": mutation.mutation_id},
            mutation.model_dump(),
            upsert=True,
        )
        return mutation

class EvaluationRepository(BaseRepository):
    async def save_evaluation(self, eval_model: EvaluationModel) -> EvaluationModel:
        await self.db.evaluations.replace_one(
            {"evaluation_id": eval_model.evaluation_id},
            eval_model.model_dump(),
            upsert=True,
        )
        return eval_model

    async def get_evaluation(self, eval_id: str) -> EvaluationModel | None:
        doc = await self.db.evaluations.find_one({"evaluation_id": eval_id}, {"_id": 0})
        return EvaluationModel(**doc) if doc else None

    async def get_by_run(self, run_id: str) -> EvaluationModel | None:
        doc = await self.db.evaluations.find_one({"run_id": run_id}, {"_id": 0})
        return EvaluationModel(**doc) if doc else None
