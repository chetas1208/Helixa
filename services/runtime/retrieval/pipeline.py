"""Hybrid research retrieval. Similarity never replaces an exact identifier or a validator."""

from __future__ import annotations

import hashlib
import math
import time
from typing import Any

from services.integrations.voyage.errors import VoyageError
from services.integrations.voyage.sanitize import assert_safe_for_remote, neutralize_source_text
from services.integrations.voyage.types import (
    MODEL_DIMENSIONS,
    embedding_version,
    versions_compatible,
)
from services.runtime.retrieval.lexical import score_text
from services.runtime.retrieval.store import ResearchStore

DISCLAIMER = (
    "Retrieved passages are citations with provenance. They do not establish causation, "
    "genotype-to-phenotype certainty, or a reason to change a simulation parameter."
)


def _cosine(left: list[float], right: list[float]) -> float:
    if len(left) != len(right) or not left:
        return 0.0
    dot = sum(a * b for a, b in zip(left, right, strict=True))
    na = math.sqrt(sum(a * a for a in left))
    nb = math.sqrt(sum(b * b for b in right))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _query_hash(query: str, filters: dict[str, Any]) -> str:
    raw = query + "|" + repr(sorted(filters.items()))
    return hashlib.sha256(raw.encode()).hexdigest()


class ResearchPipeline:
    def __init__(self, store: ResearchStore, model: Any | None = None) -> None:
        self.store = store
        self.model = model
        self.vector_search = {"supported": False, "active": False, "reason": "not_probed"}

    def _approved(self, document: dict[str, Any], filters: dict[str, Any]) -> bool:
        if document.get("review_status") != "approved":
            return False
        if document.get("source_type") == "misleading":
            return False
        if filters.get("organism") and document.get("organism") != filters["organism"]:
            return False
        if filters.get("assembly") and document.get("assembly") not in {None, filters["assembly"]}:
            return False
        if filters.get("tissue") and filters["tissue"] not in (document.get("tissue") or []):
            return False
        if filters.get("evidence_type") and document.get("evidence_type") != filters["evidence_type"]:
            return False
        if filters.get("license") and document.get("license") != filters["license"]:
            return False
        return True

    def _exact(self, query: str, filters: dict[str, Any]) -> list[dict[str, Any]]:
        needles = {query.strip(), str(filters.get("gene_id") or "")}
        needles = {item for item in needles if item}
        hits = []
        for document in self.store.documents.values():
            if not self._approved(document, filters):
                continue
            ids = set(document.get("gene_ids") or [])
            if ids & needles:
                hits.append(document)
        return hits

    def _lexical(self, query: str, filters: dict[str, Any]) -> list[tuple[float, dict[str, Any], dict[str, Any]]]:
        ranked = []
        for chunk in self.store.chunks.values():
            document = self.store.documents.get(chunk["document_id"])
            if not document or not self._approved(document, filters):
                continue
            score = score_text(query, chunk["text"] + " " + document.get("title", ""))
            if filters.get("gene_id") and filters["gene_id"] in (chunk.get("gene_ids") or []):
                score += 5.0
            if score > 0:
                ranked.append((score, document, chunk))
        ranked.sort(key=lambda item: item[0], reverse=True)
        return ranked

    def _vector(
        self, query_vector: list[float], version: str, filters: dict[str, Any]
    ) -> list[tuple[float, dict[str, Any], dict[str, Any]]]:
        ranked = []
        for chunk in self.store.chunks.values():
            document = self.store.documents.get(chunk["document_id"])
            vector = chunk.get("embedding")
            chunk_version = chunk.get("embedding_version")
            if not document or not vector or not chunk_version:
                continue
            if not self._approved(document, filters):
                continue
            if not versions_compatible(version, chunk_version):
                continue
            ranked.append((_cosine(query_vector, vector), document, chunk))
        ranked.sort(key=lambda item: item[0], reverse=True)
        return ranked

    async def search(
        self,
        query: str,
        *,
        context: dict[str, Any] | None = None,
        top_k: int = 5,
        policy: str = "exact_vector_rerank",
    ) -> dict[str, Any]:
        started = time.perf_counter()
        context = dict(context or {})
        filters = {
            "organism": context.get("organism") or "Homo sapiens",
            "assembly": context.get("assembly"),
            "tissue": context.get("tissue"),
            "evidence_type": context.get("evidence_type"),
            "license": context.get("license"),
            "gene_id": context.get("gene_id"),
        }
        filters = {key: value for key, value in filters.items() if value}
        if not query.strip():
            return self._empty("empty_query", filters, started)
        try:
            assert_safe_for_remote(query)
        except VoyageError as exc:
            return self._empty(exc.health if exc.health == "refused" else "refused", filters, started, reason=exc.reason if hasattr(exc, "reason") else "unsafe_query")

        exact = self._exact(query, filters)
        lexical = self._lexical(query, filters)
        vector_hits: list[tuple[float, dict[str, Any], dict[str, Any]]] = []
        fallback = None
        embed_version = None
        model_name = None
        rerank_model = None
        health = "disabled"
        if self.model is not None:
            health = self.model.health_state()
        use_vector = policy in {"exact_vector", "exact_vector_rerank"} and health not in {"disabled", "not_configured"}
        if policy in {"exact_vector", "exact_vector_rerank"} and not use_vector:
            fallback = health
        if use_vector and self.model is not None:
            try:
                query_vector = await self.model.embed_query(query)
                version = getattr(self.model, "last_embedding_version", None)
                if version is None:
                    dimension = len(query_vector)
                    model_name = self.model.config.embedding_model
                    version = embedding_version(model_name, dimension)
                    expected = MODEL_DIMENSIONS.get(model_name)
                    if expected and dimension != expected:
                        raise VoyageError("unavailable", "Query embedding dimension mismatch.")
                else:
                    model_name = version.split(":")[0]
                self.model.last_embedding_version = version
                embed_version = version
                if self.vector_search.get("active"):
                    index_mode = "atlas_vector"
                else:
                    index_mode = "local_cosine"
                vector_hits = self._vector(query_vector, version, filters)
            except VoyageError as exc:
                fallback = exc.health
                health = exc.health
                index_mode = "lexical"
            else:
                health = self.model.health_state()
        else:
            index_mode = "lexical"

        merged = self._merge(exact, lexical, vector_hits)
        passages = merged[: max(top_k * 2, top_k)]
        if policy == "exact_vector_rerank" and passages and self.model is not None and fallback is None and health == "connected":
            try:
                reranked = await self.model.rerank(query, [item["text"] for item in passages], top_k)
                order = {item.index: item.relevance_score for item in reranked}
                for passage in passages:
                    if passage["candidate_index"] in order:
                        passage["rerank_score"] = order[passage["candidate_index"]]
                passages.sort(key=lambda item: item.get("rerank_score", 0.0), reverse=True)
                rerank_model = self.model.config.rerank_model
                status = "hybrid_reranked" if vector_hits else "lexical_reranked"
            except VoyageError as exc:
                fallback = exc.health
                status = "lexical_fallback" if not vector_hits else "hybrid"
        elif vector_hits:
            status = "hybrid"
        elif health in {"disabled", "not_configured"} or fallback:
            status = "lexical_fallback"
            fallback = fallback or health
        else:
            status = "lexical"

        passages = passages[:top_k]
        for passage in passages:
            passage["text"] = neutralize_source_text(passage["text"])
            passage.pop("candidate_index", None)
        elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
        result = {
            "status": status,
            "health": health,
            "fallback_reason": fallback,
            "disclaimer": DISCLAIMER,
            "query_hash": _query_hash(query, filters),
            "filters": filters,
            "index": {
                "mode": index_mode,
                "vector_search_supported": bool(self.vector_search.get("supported")),
                "vector_search_active": bool(self.vector_search.get("active")),
                "vector_search_reason": self.vector_search.get("reason"),
            },
            "model": {
                "embedding": model_name,
                "embedding_version": embed_version if isinstance(embed_version, str) else None,
                "rerank": rerank_model,
            },
            "exact_matches": [
                {"document_id": document["document_id"], "gene_ids": document.get("gene_ids")}
                for document in exact
            ],
            "passages": passages,
            "elapsed_ms": elapsed_ms,
            "context": {
                "workspace_id": context.get("workspace_id"),
                "task_type": context.get("task_type"),
                "run_id": context.get("run_id"),
                "harness_id": context.get("harness_id"),
            },
        }
        self.store.record_run(
            {
                "query_hash": result["query_hash"],
                "filters": filters,
                "index_mode": index_mode,
                "embedding_version": result["model"]["embedding_version"],
                "candidate_ids": [item["document_id"] for item in passages],
                "rerank_model": rerank_model,
                "elapsed_ms": elapsed_ms,
                "fallback_reason": fallback,
                "citations": [item["source_url"] for item in passages],
                "workspace_id": context.get("workspace_id"),
                "run_id": context.get("run_id"),
                "harness_id": context.get("harness_id"),
                "status": status,
            }
        )
        return result

    def _merge(self, exact, lexical, vector_hits) -> list[dict[str, Any]]:
        by_key: dict[str, dict[str, Any]] = {}

        def add(document, chunk, *, lexical_score=0.0, vector_score=0.0, exact_hit=False, index=0):
            key = f"{document['document_id']}:{chunk['text_hash']}"
            current = by_key.get(key)
            if current:
                current["lexical_score"] = max(current["lexical_score"], lexical_score)
                current["vector_score"] = max(current["vector_score"], vector_score)
                current["exact"] = current["exact"] or exact_hit
                return
            by_key[key] = {
                "candidate_index": index,
                "document_id": document["document_id"],
                "chunk_id": chunk["chunk_id"],
                "title": document["title"],
                "text": chunk["text"],
                "source_url": document["source_url"],
                "doi": document.get("doi"),
                "license": document.get("license"),
                "source_type": document.get("source_type"),
                "evidence_type": document.get("evidence_type"),
                "provenance": document.get("provenance"),
                "gene_ids": document.get("gene_ids") or [],
                "lexical_score": lexical_score,
                "vector_score": vector_score,
                "exact": exact_hit,
                "untrusted": True,
            }

        index = 0
        for document in exact:
            chunk = next(c for c in self.store.chunks.values() if c["document_id"] == document["document_id"])
            add(document, chunk, exact_hit=True, index=index)
            index += 1
        for score, document, chunk in lexical:
            add(document, chunk, lexical_score=score, index=index)
            index += 1
        for score, document, chunk in vector_hits:
            add(document, chunk, vector_score=score, index=index)
            index += 1
        rows = list(by_key.values())
        rows.sort(key=lambda item: (item["exact"], item["vector_score"], item["lexical_score"]), reverse=True)
        for position, row in enumerate(rows):
            row["candidate_index"] = position
        return rows

    def _empty(self, status: str, filters: dict[str, Any], started: float, reason: str | None = None) -> dict[str, Any]:
        return {
            "status": status,
            "health": self.model.health_state() if self.model else "disabled",
            "fallback_reason": reason or status,
            "disclaimer": DISCLAIMER,
            "query_hash": _query_hash("", filters),
            "filters": filters,
            "index": {"mode": "none", "vector_search_supported": False, "vector_search_active": False},
            "model": {"embedding": None, "embedding_version": None, "rerank": None},
            "exact_matches": [],
            "passages": [],
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 3),
            "context": {},
        }
