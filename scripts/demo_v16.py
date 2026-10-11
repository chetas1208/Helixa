"""Lexical demo of V16 retrieval. Does not claim a live Voyage connection."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.integrations.voyage import VoyageAdapter, VoyageError  # noqa: E402
from services.runtime.research_evidence.benchmark import PUBLIC_QUERIES, run_queries  # noqa: E402
from services.runtime.retrieval.pipeline import ResearchPipeline  # noqa: E402
from services.runtime.retrieval.store import ResearchStore  # noqa: E402


async def main() -> int:
    store = ResearchStore()
    store.seed_curated()
    try:
        adapter = VoyageAdapter()
        health = adapter.health_state()
    except VoyageError as exc:
        adapter = None
        health = exc.health
    pipeline = ResearchPipeline(store, adapter)
    sample = await pipeline.search(
        "BRCA1 hereditary breast cancer association",
        context={"gene_id": "BRCA1", "task_type": "editor"},
        policy="exact_lexical",
    )
    report = await run_queries(pipeline, PUBLIC_QUERIES, policy="exact_lexical")
    out = Path("artifacts/milestones/v16")
    out.mkdir(parents=True, exist_ok=True)
    payload = {
        "voyage_health": health,
        "verified_live_call": False,
        "sample_status": sample["status"],
        "sample_document_ids": [item["document_id"] for item in sample["passages"]],
        "disclaimer": sample["disclaimer"],
        "lexical_benchmark": {
            "mean_recall_at_k": report["mean_recall_at_k"],
            "mean_mrr": report["mean_mrr"],
            "mean_ndcg_at_k": report["mean_ndcg_at_k"],
            "unsupported_claim_count": report["unsupported_claim_count"],
            "cases": report["cases"],
        },
        "vector_and_rerank": "not_run_without_authenticated_voyage",
    }
    (out / "demo.json").write_text(json.dumps(payload, indent=2))
    print(json.dumps({"health": health, "recall": report["mean_recall_at_k"], "wrote": str(out / "demo.json")}))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
