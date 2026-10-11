#!/usr/bin/env python3
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.integrations.mongodb import MongoDBClient
from services.runtime.harness import get_baseline_harness


async def seed():
    print("Seeding initial dataset manifest and baseline harness to MongoDB...")
    mongo = MongoDBClient()
    await mongo.init_indexes()

    # Seed Manifest
    manifest_path = Path("fixtures/manifests/dataset_manifest.json")
    if manifest_path.exists():
        with open(manifest_path, "r") as f:
            manifest_data = json.load(f)
            await mongo.db.datasets.replace_one(
                {"dataset_id": manifest_data["dataset_id"]},
                manifest_data,
                upsert=True,
            )
            print(f"  Seeded dataset: {manifest_data['dataset_id']}")

    # Seed Baseline Harness
    baseline = get_baseline_harness()
    await mongo.db.harness_versions.replace_one(
        {"version_id": baseline.version_id},
        baseline.model_dump(),
        upsert=True,
    )
    print(f"  Seeded baseline harness: {baseline.version_id}")

    await mongo.close()
    print("Database seeding completed.")

if __name__ == "__main__":
    asyncio.run(seed())
