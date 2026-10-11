"""Retrieval-policy candidates for PCHE. The evaluator and fixtures are not editable here."""

from __future__ import annotations

from typing import Any

EVALUATOR_VERSION = "v16-retrieval-oracle-1"
ALLOWED_RETRIEVAL_POLICIES = ("exact_lexical", "exact_vector", "exact_vector_rerank")


def propose_retrieval_policy(name: str) -> str:
    """A harness candidate may select a retrieval policy and nothing else."""
    if name not in ALLOWED_RETRIEVAL_POLICIES:
        raise PermissionError("retrieval policy is outside the permission ceiling")
    if name == EVALUATOR_VERSION:
        raise PermissionError("candidates cannot replace the evaluator")
    return name


def recall_at_k(retrieved: list[str], relevant: list[str], k: int) -> float:
    if not relevant:
        return 0.0
    hit = set(retrieved[:k]) & set(relevant)
    return len(hit) / len(relevant)


async def evaluate_policy(
    pipeline: Any,
    policy: str,
    cases: list[dict[str, Any]],
    *,
    k: int = 5,
) -> dict[str, Any]:
    """Score a policy on caller-supplied held-out cases. Does not accept a new oracle."""
    chosen = propose_retrieval_policy(policy)
    rows = []
    for case in cases:
        result = await pipeline.search(
            case["query"],
            context=case.get("context") or {},
            top_k=k,
            policy=chosen,
        )
        retrieved = [item["document_id"] for item in result["passages"]]
        forbidden = [item for item in retrieved if item in set(case.get("forbidden") or [])]
        rows.append(
            {
                "id": case["id"],
                "retrieved": retrieved,
                "relevant": case["relevant"],
                "recall": recall_at_k(retrieved, case["relevant"], k),
                "forbidden_hits": forbidden,
            }
        )
    mean_recall = sum(row["recall"] for row in rows) / len(rows) if rows else 0.0
    return {
        "evaluator_version": EVALUATOR_VERSION,
        "policy": chosen,
        "mean_recall": mean_recall,
        "cases": rows,
        "contamination": sum(len(row["forbidden_hits"]) for row in rows),
    }


def judge_promotion(baseline: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    """Persist the comparison. A lower recall is a regression and is not promoted."""
    improved = candidate["mean_recall"] >= baseline["mean_recall"] and candidate["contamination"] == 0
    return {
        "evaluator_version": EVALUATOR_VERSION,
        "baseline_policy": baseline["policy"],
        "candidate_policy": candidate["policy"],
        "baseline_recall": baseline["mean_recall"],
        "candidate_recall": candidate["mean_recall"],
        "promoted": improved,
        "regression": not improved,
    }
