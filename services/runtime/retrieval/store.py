"""Research document store. MongoDB is canonical when a client is attached."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import Any

from services.runtime.retrieval.corpus import CURATED_DOCUMENTS, chunk_for


def _now() -> str:
    return datetime.now(UTC).isoformat()


class ResearchStore:
    def __init__(self, db: Any | None = None) -> None:
        self.db = db
        self.documents: dict[str, dict[str, Any]] = {}
        self.chunks: dict[str, dict[str, Any]] = {}
        self.runs: list[dict[str, Any]] = []
        self.jobs: dict[str, dict[str, Any]] = {}
        self.policy_evals: list[dict[str, Any]] = []

    def seed_curated(self) -> int:
        for document in CURATED_DOCUMENTS:
            self.upsert_document(document)
        return len(self.documents)

    def upsert_document(self, document: dict[str, Any]) -> str:
        document_id = document["document_id"]
        stored = dict(document)
        self.documents[document_id] = stored
        chunk = chunk_for(stored)
        # Same excerpt keeps the same chunk id, so reindex does not duplicate.
        self.chunks[chunk["chunk_id"]] = {**self.chunks.get(chunk["chunk_id"], {}), **chunk}
        return document_id

    def upsert_embedding(
        self, chunk_id: str, *, vector: list[float], model_name: str, embedding_version: str
    ) -> None:
        chunk = self.chunks[chunk_id]
        existing = chunk.get("embedding_version")
        if existing and existing != embedding_version:
            raise ValueError(
                f"Refusing to mix embedding version {existing} with {embedding_version}."
            )
        chunk["embedding"] = vector
        chunk["model_name"] = model_name
        chunk["embedding_version"] = embedding_version

    def record_job(self, *, idempotency_key: str, content_hash: str, model_version: str, state: str) -> dict[str, Any]:
        prior = self.jobs.get(idempotency_key)
        if prior and prior["content_hash"] == content_hash and prior["state"] == "completed":
            return prior
        job = {
            "idempotency_key": idempotency_key,
            "content_hash": content_hash,
            "model_version": model_version,
            "state": state,
            "retry_count": 0 if not prior else prior["retry_count"] + (1 if state == "retry" else 0),
            "updated_at": _now(),
        }
        self.jobs[idempotency_key] = job
        return job

    def record_run(self, run: dict[str, Any]) -> dict[str, Any]:
        stored = dict(run)
        stored.setdefault("recorded_at", _now())
        self.runs.append(stored)
        return stored

    def record_policy_eval(self, result: dict[str, Any]) -> dict[str, Any]:
        stored = dict(result)
        stored.setdefault("recorded_at", _now())
        self.policy_evals.append(stored)
        return stored

    async def flush_mongo(self) -> dict[str, int]:
        """Idempotent upserts. Vectors are stored only when already computed."""
        if self.db is None:
            return {"documents": 0, "chunks": 0, "runs": 0}
        for document in self.documents.values():
            await self.db.research_documents.update_one(
                {"document_id": document["document_id"]},
                {"$set": document},
                upsert=True,
            )
        for chunk in self.chunks.values():
            await self.db.research_chunks.update_one(
                {"chunk_id": chunk["chunk_id"]},
                {"$set": chunk},
                upsert=True,
            )
        for run in self.runs:
            key = run.get("query_hash") or hashlib.sha256(repr(run).encode()).hexdigest()
            await self.db.retrieval_runs.update_one(
                {"query_hash": key, "recorded_at": run.get("recorded_at")},
                {"$set": run},
                upsert=True,
            )
        for job in self.jobs.values():
            await self.db.embedding_jobs.update_one(
                {"idempotency_key": job["idempotency_key"]},
                {"$set": job},
                upsert=True,
            )
        for result in self.policy_evals:
            await self.db.retrieval_policy_evals.insert_one(dict(result))
        return {
            "documents": len(self.documents),
            "chunks": len(self.chunks),
            "runs": len(self.runs),
        }

    async def ensure_indexes(self) -> None:
        if self.db is None:
            return
        await self.db.research_documents.create_index("document_id", unique=True)
        await self.db.research_chunks.create_index("chunk_id", unique=True)
        await self.db.research_chunks.create_index("document_id")
        await self.db.embedding_jobs.create_index("idempotency_key", unique=True)
        await self.db.retrieval_runs.create_index("query_hash")
