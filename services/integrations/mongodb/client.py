from __future__ import annotations

import logging
import os
import re
from datetime import UTC, datetime
from typing import Any

from pymongo import ASCENDING, AsyncMongoClient, IndexModel
from pymongo.errors import ConfigurationError, ConnectionFailure, OperationFailure

logger = logging.getLogger("diamond.mongodb")

COLLECTIONS = [
    "datasets",
    "artifacts",
    "tasks",
    "runs",
    "run_events",
    "checkpoints",
    "harness_versions",
    "harness_mutations",
    "evaluations",
    "evidence_receipts",
    "research_memories",
    "integration_events",
]

def sanitize_mongodb_uri(uri: str) -> str:
    """Mask credentials in MongoDB connection URI for safe logging."""
    if not uri:
        return ""
    return re.sub(r"://([^:/?#@]+):([^?#]*)@", r"://\1:****@", uri)

class MongoDBClient:
    def __init__(
        self,
        uri: str | None = None,
        db_name: str | None = None,
        app_name: str | None = None,
        server_selection_timeout_ms: int | None = None,
        connect_timeout_ms: int | None = None,
        min_pool_size: int | None = None,
        max_pool_size: int | None = None,
        require_atlas: bool | None = None,
    ):
        self.uri = uri or os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017")
        self.db_name = db_name or os.getenv("MONGODB_DATABASE", "diamond_genome")
        self.app_name = app_name or os.getenv("MONGODB_APP_NAME", "diamond-genome")
        self.server_selection_timeout_ms = (
            server_selection_timeout_ms
            if server_selection_timeout_ms is not None
            else int(os.getenv("MONGODB_SERVER_SELECTION_TIMEOUT_MS", "5000"))
        )
        self.connect_timeout_ms = (
            connect_timeout_ms
            if connect_timeout_ms is not None
            else int(os.getenv("MONGODB_CONNECT_TIMEOUT_MS", "5000"))
        )
        self.min_pool_size = (
            min_pool_size if min_pool_size is not None else int(os.getenv("MONGODB_MIN_POOL_SIZE", "5"))
        )
        self.max_pool_size = (
            max_pool_size if max_pool_size is not None else int(os.getenv("MONGODB_MAX_POOL_SIZE", "50"))
        )

        env_require_atlas = os.getenv("MONGODB_REQUIRE_ATLAS", "false").lower() in ("true", "1", "yes")
        self.require_atlas = require_atlas if require_atlas is not None else env_require_atlas

        # Validate Atlas requirement
        if self.require_atlas and not self.is_atlas_uri:
            raise ConfigurationError(
                f"MONGODB_REQUIRE_ATLAS is true, but URI '{self.sanitized_uri}' does not point to MongoDB Atlas. "
                "Refusing silent fallback to local instance."
            )

        self._client: AsyncMongoClient | None = None

    @property
    def is_atlas_uri(self) -> bool:
        """Determine if connection URI points to MongoDB Atlas."""
        uri_lower = self.uri.strip().lower()
        if uri_lower.startswith("mongodb+srv://"):
            return True
        authority = re.split(r"[/?#]", uri_lower.partition("://")[2], maxsplit=1)[0]
        for host_port in authority.rpartition("@")[2].split(","):
            host = host_port.partition(":")[0]
            if host == "mongodb.net" or host.endswith(".mongodb.net"):
                return True
        return False

    @property
    def deployment_mode(self) -> str:
        """Return deployment mode: 'atlas-hackathon', 'test', or 'local'."""
        if os.getenv("APP_ENV") == "test":
            return "test"
        if self.is_atlas_uri:
            return "atlas-hackathon"
        return "local"

    @property
    def sanitized_uri(self) -> str:
        return sanitize_mongodb_uri(self.uri)

    @property
    def client(self) -> AsyncMongoClient:
        if self._client is None:
            self._client = AsyncMongoClient(
                self.uri,
                appname=self.app_name,
                serverSelectionTimeoutMS=self.server_selection_timeout_ms,
                connectTimeoutMS=self.connect_timeout_ms,
                minPoolSize=self.min_pool_size,
                maxPoolSize=self.max_pool_size,
            )
        return self._client

    @property
    def db(self):
        return self.client[self.db_name]

    async def ping(self) -> bool:
        """True database ping returning boolean."""
        try:
            await self.db.command("ping")
            return True
        except (ConnectionFailure, OperationFailure, Exception) as e:
            logger.warning(f"MongoDB ping failed ({self.sanitized_uri}): {e}")
            return False

    async def verify_write(self) -> bool:
        """Perform canary write and immediate cleanup to prove genuine write authorization."""
        canary_id = f"canary-probe-{datetime.now(UTC).timestamp()}"
        try:
            await self.db.integration_events.insert_one({
                "event_id": canary_id,
                "timestamp": datetime.now(UTC).isoformat(),
                "component": "probe",
                "action": "write_verification",
                "status": "PROBING",
            })
            del_res = await self.db.integration_events.delete_one({"event_id": canary_id})
            return del_res.deleted_count > 0
        except Exception as e:
            logger.warning(f"MongoDB write verification failed: {e}")
            return False

    async def check_status(self) -> dict[str, Any]:
        """
        Evaluate full connection status across:
        'NOT_CONFIGURED', 'CONFIGURED', 'REACHABLE', 'AUTHENTICATED', 'WRITE_VERIFIED', 'INACCESSIBLE'
        """
        if not self.uri or self.uri == "mongodb://":
            return {
                "status": "NOT_CONFIGURED",
                "mode": self.deployment_mode,
                "is_atlas": self.is_atlas_uri,
                "sanitized_uri": "",
                "database": self.db_name,
                "write_verified": False,
                "error": "No connection string configured",
            }

        is_reachable = await self.ping()
        if not is_reachable:
            return {
                "status": "INACCESSIBLE",
                "mode": self.deployment_mode,
                "is_atlas": self.is_atlas_uri,
                "sanitized_uri": self.sanitized_uri,
                "database": self.db_name,
                "write_verified": False,
                "error": "Failed to ping database server",
            }

        is_writable = await self.verify_write()
        status = "WRITE_VERIFIED" if is_writable else "AUTHENTICATED"

        return {
            "status": status,
            "mode": self.deployment_mode,
            "is_atlas": self.is_atlas_uri,
            "sanitized_uri": self.sanitized_uri,
            "database": self.db_name,
            "write_verified": is_writable,
            "error": None if is_writable else "Read succeeded but write probe failed",
        }

    async def init_indexes(self) -> dict[str, list[str]]:
        """Initialize all required collections and unique/query constraints for M01."""
        created_indexes: dict[str, list[str]] = {}
        db = self.db

        # 1. datasets
        idx_datasets = [
            IndexModel([("dataset_id", ASCENDING)], unique=True, name="uniq_dataset_id"),
            IndexModel([("created_at", ASCENDING)], name="idx_dataset_created"),
        ]
        created_indexes["datasets"] = await db.datasets.create_indexes(idx_datasets)

        # 2. artifacts: unique artifact_sha256
        idx_artifacts = [
            IndexModel([("artifact_sha256", ASCENDING)], unique=True, name="uniq_artifact_sha256"),
            IndexModel([("dataset_id", ASCENDING)], name="idx_artifact_dataset"),
            IndexModel([("file_format", ASCENDING)], name="idx_artifact_format"),
        ]
        created_indexes["artifacts"] = await db.artifacts.create_indexes(idx_artifacts)

        # 3. tasks: status, leases, fence token
        idx_tasks = [
            IndexModel([("task_id", ASCENDING)], unique=True, name="uniq_task_id"),
            IndexModel([("status", ASCENDING)], name="idx_task_status"),
            IndexModel([("worker_lease_expiry", ASCENDING)], name="idx_task_lease"),
            IndexModel([("fence_token", ASCENDING)], name="idx_task_fence"),
        ]
        created_indexes["tasks"] = await db.tasks.create_indexes(idx_tasks)

        # 4. runs: run_id, task_id, status, fence token
        idx_runs = [
            IndexModel([("run_id", ASCENDING)], unique=True, name="uniq_run_id"),
            IndexModel([("task_id", ASCENDING)], name="idx_run_task"),
            IndexModel([("status", ASCENDING)], name="idx_run_status"),
            IndexModel([("worker_lease_expiry", ASCENDING)], name="idx_run_lease"),
            IndexModel([("fence_token", ASCENDING)], name="idx_run_fence"),
        ]
        created_indexes["runs"] = await db.runs.create_indexes(idx_runs)

        # 5. run_events: unique (run_id, seq), idempotency key
        idx_run_events = [
            IndexModel([("run_id", ASCENDING), ("seq", ASCENDING)], unique=True, name="uniq_run_seq"),
            IndexModel([("run_id", ASCENDING), ("idempotency_key", ASCENDING)], sparse=True, name="idx_run_idempotency"),
            IndexModel([("timestamp", ASCENDING)], name="idx_event_time"),
            IndexModel([("event_type", ASCENDING)], name="idx_event_type"),
        ]
        created_indexes["run_events"] = await db.run_events.create_indexes(idx_run_events)

        # 6. checkpoints: checkpoint_id, (run_id, step_index)
        idx_checkpoints = [
            IndexModel([("checkpoint_id", ASCENDING)], unique=True, name="uniq_checkpoint_id"),
            IndexModel([("run_id", ASCENDING), ("step_index", ASCENDING)], name="idx_checkpoint_run_step"),
            IndexModel([("timestamp", ASCENDING)], name="idx_checkpoint_time"),
        ]
        created_indexes["checkpoints"] = await db.checkpoints.create_indexes(idx_checkpoints)

        # 7. harness_versions: unique version_id, (harness_id, version_id)
        idx_harness = [
            IndexModel([("version_id", ASCENDING)], unique=True, name="uniq_version_id"),
            IndexModel([("harness_id", ASCENDING), ("version_id", ASCENDING)], unique=True, name="uniq_harness_version"),
            IndexModel([("parent_version_id", ASCENDING)], name="idx_harness_parent"),
        ]
        created_indexes["harness_versions"] = await db.harness_versions.create_indexes(idx_harness)

        # 8. harness_mutations: mutation_id, parent/candidate versions
        idx_mutations = [
            IndexModel([("mutation_id", ASCENDING)], unique=True, name="uniq_mutation_id"),
            IndexModel([("parent_version_id", ASCENDING)], name="idx_mutation_parent"),
            IndexModel([("candidate_version_id", ASCENDING)], name="idx_mutation_candidate"),
        ]
        created_indexes["harness_mutations"] = await db.harness_mutations.create_indexes(idx_mutations)

        # 9. evaluations: evaluation_id, candidate_version_id, run_id
        idx_evals = [
            IndexModel([("evaluation_id", ASCENDING)], unique=True, name="uniq_eval_id"),
            IndexModel([("candidate_version_id", ASCENDING)], name="idx_eval_candidate"),
            IndexModel([("run_id", ASCENDING)], name="idx_eval_run"),
        ]
        created_indexes["evaluations"] = await db.evaluations.create_indexes(idx_evals)

        # 10. evidence_receipts: receipt_id, receipt_digest, run_id
        idx_receipts = [
            IndexModel([("receipt_id", ASCENDING)], unique=True, name="uniq_receipt_id"),
            IndexModel([("receipt_digest", ASCENDING)], unique=True, name="uniq_receipt_digest"),
            IndexModel([("run_id", ASCENDING)], name="idx_receipt_run"),
        ]
        created_indexes["evidence_receipts"] = await db.evidence_receipts.create_indexes(idx_receipts)

        # 11. research_memories: memory_id, run_id, timestamp
        idx_memories = [
            IndexModel([("memory_id", ASCENDING)], unique=True, name="uniq_memory_id"),
            IndexModel([("run_id", ASCENDING)], name="idx_memory_run"),
            IndexModel([("timestamp", ASCENDING)], name="idx_memory_time"),
        ]
        created_indexes["research_memories"] = await db.research_memories.create_indexes(idx_memories)

        # 12. integration_events: event_id, timestamp, component
        idx_integrations = [
            IndexModel([("event_id", ASCENDING)], unique=True, name="uniq_integration_event_id"),
            IndexModel([("timestamp", ASCENDING)], name="idx_integration_time"),
            IndexModel([("component", ASCENDING)], name="idx_integration_component"),
        ]
        created_indexes["integration_events"] = await db.integration_events.create_indexes(idx_integrations)

        return created_indexes

    async def close(self):
        """Close connection pool cleanly."""
        if self._client:
            await self._client.close()
            self._client = None
