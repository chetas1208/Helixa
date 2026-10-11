"""Local Mongo checkpoint for the V8 campaign.

The JSON file remains the offline copy. When MongoDB is reachable, the same
state is the resume source. Atlas is not implied by a local connection.
"""

from __future__ import annotations

import hashlib
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pymongo import MongoClient, ReturnDocument
from pymongo.errors import PyMongoError


def namespace_for(output_dir: Path) -> str:
    digest = hashlib.sha256(str(output_dir.resolve()).encode("utf-8")).hexdigest()
    return f"v8-campaign-{digest[:16]}"


def _client() -> MongoClient:
    uri = os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017")
    return MongoClient(uri, serverSelectionTimeoutMS=800, connectTimeoutMS=800)


def _database_name() -> str:
    return os.getenv("MONGODB_DATABASE", "diamond_genome")


def save_checkpoint(output_dir: Path, state: dict[str, Any]) -> str:
    """Upsert campaign state. Returns `mongodb` or `file`."""
    namespace = namespace_for(output_dir)
    client = None
    try:
        client = _client()
        client.admin.command("ping")
        client[_database_name()].v8_campaign_checkpoints.replace_one(
            {"namespace": namespace},
            {
                "namespace": namespace,
                "output_dir": str(output_dir.resolve()),
                "state": state,
                "updated_at": datetime.now(UTC).isoformat(),
            },
            upsert=True,
        )
    except PyMongoError:
        return "file"
    finally:
        if client is not None:
            client.close()
    return "mongodb"


def load_checkpoint(output_dir: Path) -> dict[str, Any] | None:
    namespace = namespace_for(output_dir)
    client = None
    try:
        client = _client()
        client.admin.command("ping")
        doc = client[_database_name()].v8_campaign_checkpoints.find_one(
            {"namespace": namespace},
            {"_id": 0, "state": 1},
        )
    except PyMongoError:
        return None
    finally:
        if client is not None:
            client.close()
    if not doc or not isinstance(doc.get("state"), dict):
        return None
    return doc["state"]


def claim_promotion(output_dir: Path, expected_parent: str, candidate_id: str) -> bool:
    """One writer moves the active pointer off the parent. A second writer gets False."""
    namespace = namespace_for(output_dir)
    client = None
    try:
        client = _client()
        client.admin.command("ping")
        coll = client[_database_name()].v8_active_pointers
        coll.update_one(
            {"namespace": namespace},
            {"$setOnInsert": {"namespace": namespace, "active_version_id": expected_parent}},
            upsert=True,
        )
        updated = coll.find_one_and_update(
            {"namespace": namespace, "active_version_id": expected_parent},
            {"$set": {"active_version_id": candidate_id}},
            return_document=ReturnDocument.AFTER,
        )
    except PyMongoError:
        return False
    finally:
        if client is not None:
            client.close()
    return updated is not None
