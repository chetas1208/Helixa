from __future__ import annotations

import json
from pathlib import Path

from services.integrations.mongodb.models import ArtifactModel, DatasetModel

from .base import BaseRepository


class DatasetRepository(BaseRepository):
    async def get_dataset(self, dataset_id: str) -> DatasetModel | None:
        doc = await self.db.datasets.find_one({"dataset_id": dataset_id}, {"_id": 0})
        if doc:
            return DatasetModel(**doc)

        # Fallback to local manifest if not yet synced to DB
        manifest_path = Path("fixtures/manifests/dataset_manifest.json")
        if manifest_path.exists():
            with open(manifest_path, "r") as f:
                data = json.load(f)
                if dataset_id == "default":
                    persisted = await self.db.datasets.find_one(
                        {"dataset_id": data.get("dataset_id", "SYNTH-GENOME-INCIDENT-001")},
                        {"_id": 0},
                    )
                    if persisted:
                        return DatasetModel(**persisted)
                if data.get("dataset_id") == dataset_id or dataset_id == "default":
                    ds = DatasetModel(
                        dataset_id=data.get("dataset_id", "SYNTH-GENOME-INCIDENT-001"),
                        manifest_version=data.get("manifest_version", "1.0.0"),
                        declared_assembly=data.get("declared_assembly", "GRCh38"),
                        is_synthetic=data.get("is_synthetic", True),
                        reference=data.get("reference", {}),
                        fixtures=data.get("fixtures", {}),
                        metadata=data.get("dataset_metadata", {}),
                    )
                    await self.upsert_dataset(ds)
                    return ds
        return None

    async def upsert_dataset(self, dataset: DatasetModel) -> DatasetModel:
        await self.db.datasets.replace_one(
            {"dataset_id": dataset.dataset_id},
            dataset.model_dump(),
            upsert=True,
        )
        return dataset

    async def list_datasets(self) -> list[DatasetModel]:
        cursor = self.db.datasets.find({}, {"_id": 0})
        docs = await cursor.to_list(length=None)
        if not docs:
            # Sync default dataset
            default_ds = await self.get_dataset("default")
            if default_ds:
                return [default_ds]
        return [DatasetModel(**d) for d in docs]

class ArtifactRepository(BaseRepository):
    async def get_by_sha256(self, sha256: str) -> ArtifactModel | None:
        doc = await self.db.artifacts.find_one({"artifact_sha256": sha256}, {"_id": 0})
        if doc:
            return ArtifactModel(**doc)
        return None

    async def upsert_artifact(self, artifact: ArtifactModel) -> ArtifactModel:
        await self.db.artifacts.replace_one(
            {"artifact_sha256": artifact.artifact_sha256},
            artifact.model_dump(),
            upsert=True,
        )
        return artifact

    async def list_by_dataset(self, dataset_id: str) -> list[ArtifactModel]:
        cursor = self.db.artifacts.find({"dataset_id": dataset_id}, {"_id": 0})
        docs = await cursor.to_list(length=None)
        return [ArtifactModel(**d) for d in docs]

    async def list_by_run(self, run_id: str) -> list[ArtifactModel]:
        cursor = self.db.artifacts.find({"run_id": run_id}, {"_id": 0})
        docs = await cursor.to_list(length=None)
        return [ArtifactModel(**d) for d in docs]
