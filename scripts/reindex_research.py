"""Upsert the curated corpus. Embed only when Voyage is enabled, configured, and allowed."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.integrations.mongodb import MongoDBClient  # noqa: E402
from services.integrations.voyage import VoyageAdapter, VoyageError  # noqa: E402
from services.runtime.retrieval.corpus import CURATED_DOCUMENTS
from services.runtime.retrieval.store import ResearchStore
from services.runtime.retrieval.vector_capability import probe_vector_search


async def main() -> int:
    store = ResearchStore()
    store.seed_curated()
    client = MongoDBClient()
    if not await client.ping():
        print("MongoDB unreachable. Curated documents remain in memory only.")
        await client.close()
        return 2
    store.db = client.db
    await store.ensure_indexes()
    probe = await probe_vector_search(client.db)
    embedded = 0
    vectors: list[list[float]] = []
    try:
        adapter = VoyageAdapter()
    except VoyageError as exc:
        print(f"skip_embed {exc.health}")
        adapter = None
    if adapter and adapter.health_state() not in {"disabled", "not_configured"}:
        texts = [document["excerpt"] for document in CURATED_DOCUMENTS]
        try:
            vectors = await adapter.embed_documents(texts)
        except VoyageError as exc:
            print(f"embed_failed {exc.health}")
            vectors = []
        if vectors:
            version = f"{adapter.config.embedding_model}:float:{len(vectors[0])}"
            for document, vector in zip(CURATED_DOCUMENTS, vectors, strict=True):
                chunk = next(
                    item for item in store.chunks.values() if item["document_id"] == document["document_id"]
                )
                store.upsert_embedding(
                    chunk["chunk_id"],
                    vector=vector,
                    model_name=adapter.config.embedding_model,
                    embedding_version=version,
                )
                store.record_job(
                    idempotency_key=document["document_hash"],
                    content_hash=document["document_hash"],
                    model_version=version,
                    state="completed",
                )
                embedded += 1
    else:
        for document in CURATED_DOCUMENTS:
            store.record_job(
                idempotency_key=document["document_hash"],
                content_hash=document["document_hash"],
                model_version="none",
                state="skipped_not_configured",
            )
    counts = await store.flush_mongo()
    print(f"upserted={counts} embedded={embedded} vector_search={probe}")
    await client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
