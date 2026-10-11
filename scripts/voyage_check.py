"""One sanitized embedding call. Exit 2 when no key is active. Never invents connectivity."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.integrations.voyage import VoyageAdapter, VoyageError  # noqa: E402

PROBE = "Public research summary connectivity probe for DIAMOND."
RERANK_DOCS = [
    "BRCA1 is associated with DNA repair in public gene resources.",
    "A coordinate on GRCh37 is not a GRCh38 coordinate.",
]


async def main() -> int:
    try:
        adapter = VoyageAdapter()
    except VoyageError as exc:
        print(f"FAIL {exc.health}: {exc}")
        return 1
    health = adapter.health_state()
    if health == "disabled":
        print("NOT_CONFIGURED: VOYAGE_ENABLED is false. No request was sent.")
        return 2
    if health == "not_configured":
        print("NOT_CONFIGURED: VOYAGE_API_KEY is empty. No request was sent.")
        return 2
    print(f"endpoint_host={adapter.config.host} embedding_model={adapter.config.embedding_model}")
    try:
        vector = await adapter.embed_query(PROBE)
        ranked = await adapter.rerank(PROBE, RERANK_DOCS, top_k=2)
    except VoyageError as exc:
        print(f"FAIL {exc.health}: {exc}")
        return 1
    print(
        f"CONNECTED dimension={len(vector)} tokens={adapter.usage.embedding_tokens} "
        f"rerank_tokens={adapter.usage.rerank_tokens} rerank_top={ranked[0].index}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
