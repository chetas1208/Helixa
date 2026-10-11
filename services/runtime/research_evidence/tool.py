"""Bounded research-evidence tool. Returned text is untrusted citation data."""

from __future__ import annotations

from typing import Any

from services.runtime.retrieval.pipeline import DISCLAIMER, ResearchPipeline

TOOL_NAME = "search_research_evidence"


async def search_research_evidence(
    pipeline: ResearchPipeline,
    query: str,
    context: dict[str, Any] | None = None,
    *,
    top_k: int = 4,
    policy: str = "exact_vector_rerank",
) -> dict[str, Any]:
    """Return citations and evidence metadata. Never returns tool instructions."""
    result = await pipeline.search(query, context=context, top_k=top_k, policy=policy)
    passages = []
    for passage in result["passages"]:
        passages.append(
            {
                "document_id": passage["document_id"],
                "source_url": passage["source_url"],
                "title": passage["title"],
                "excerpt": passage["text"],
                "evidence_type": passage["evidence_type"],
                "source_type": passage["source_type"],
                "provenance": passage["provenance"],
                "gene_ids": passage["gene_ids"],
                "untrusted": True,
            }
        )
    return {
        "tool": TOOL_NAME,
        "untrusted": True,
        "disclaimer": DISCLAIMER,
        "status": result["status"],
        "health": result["health"],
        "fallback_reason": result["fallback_reason"],
        "citations": passages,
        "exact_matches": result["exact_matches"],
        "model": result["model"],
    }
