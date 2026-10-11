"""Small labeled query set and metric helpers. Numbers come only from this run."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

_FIXTURES = Path(__file__).resolve().parents[3] / "fixtures" / "v16"


def load_public_queries() -> list[dict[str, Any]]:
    return json.loads((_FIXTURES / "queries.json").read_text())


def load_heldout_queries() -> list[dict[str, Any]]:
    return json.loads((_FIXTURES / "heldout.json").read_text())


PUBLIC_QUERIES = load_public_queries()
HELDOUT_QUERIES = load_heldout_queries()


def dcg(gains: list[int]) -> float:
    return sum((2**gain - 1) / math.log2(index + 2) for index, gain in enumerate(gains))


def ndcg_at_k(retrieved: list[str], relevant: list[str], k: int) -> float:
    gains = [1 if item in relevant else 0 for item in retrieved[:k]]
    ideal_count = min(k, len(relevant))
    ideal = dcg([1] * ideal_count)
    if ideal == 0:
        return 0.0
    return dcg(gains) / ideal


def mrr(retrieved: list[str], relevant: list[str]) -> float:
    relevant_set = set(relevant)
    for index, item in enumerate(retrieved, start=1):
        if item in relevant_set:
            return 1.0 / index
    return 0.0


def recall_at_k(retrieved: list[str], relevant: list[str], k: int) -> float:
    if not relevant:
        return 0.0
    return len(set(retrieved[:k]) & set(relevant)) / len(relevant)


async def run_queries(pipeline: Any, queries: list[dict[str, Any]], policy: str, k: int = 5) -> dict[str, Any]:
    rows = []
    for case in queries:
        result = await pipeline.search(
            case["query"], context=case.get("context") or {}, top_k=k, policy=policy
        )
        retrieved = [item["document_id"] for item in result["passages"]]
        forbidden = set(case.get("forbidden") or [])
        unsupported = [
            item["document_id"]
            for item in result["passages"]
            if item.get("evidence_type") == "misleading_claim" or item["document_id"] in forbidden
        ]
        cited = sum(1 for item in result["passages"] if item.get("source_url"))
        rows.append(
            {
                "id": case["id"],
                "retrieved": retrieved,
                "relevant": case["relevant"],
                "recall_at_k": recall_at_k(retrieved, case["relevant"], k),
                "mrr": mrr(retrieved, case["relevant"]),
                "ndcg_at_k": ndcg_at_k(retrieved, case["relevant"], k),
                "unsupported": unsupported,
                "citation_coverage": (cited / len(result["passages"])) if result["passages"] else 0.0,
                "elapsed_ms": result["elapsed_ms"],
                "status": result["status"],
                "fallback_reason": result["fallback_reason"],
            }
        )
    def mean(name: str) -> float:
        return sum(row[name] for row in rows) / len(rows) if rows else 0.0

    return {
        "policy": policy,
        "k": k,
        "count": len(rows),
        "mean_recall_at_k": mean("recall_at_k"),
        "mean_mrr": mean("mrr"),
        "mean_ndcg_at_k": mean("ndcg_at_k"),
        "unsupported_claim_count": sum(len(row["unsupported"]) for row in rows),
        "mean_citation_coverage": mean("citation_coverage"),
        "mean_elapsed_ms": mean("elapsed_ms"),
        "cases": rows,
    }
