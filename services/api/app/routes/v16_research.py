"""V16 research retrieval routes. Similarity is not scientific validation."""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.integrations.mongodb import MongoDBClient
from services.integrations.raindrop.adapter import RaindropAdapter, ToolEvent
from services.integrations.voyage import VoyageAdapter, VoyageError
from services.runtime.research_evidence.policy import ALLOWED_RETRIEVAL_POLICIES
from services.runtime.research_evidence.tool import search_research_evidence
from services.runtime.retrieval.pipeline import DISCLAIMER, ResearchPipeline
from services.runtime.retrieval.store import ResearchStore
from services.runtime.retrieval.vector_capability import probe_vector_search

router = APIRouter(prefix="/api/v16/research", tags=["v16-research"])

_store = ResearchStore()
_store.seed_curated()
_probe: dict[str, Any] = {"at": 0.0, "value": {"supported": False, "active": False, "reason": "not_probed"}}


class SearchContext(BaseModel):
    workspace_id: str | None = None
    gene_id: str | None = None
    anatomy_id: str | None = None
    organ: str | None = None
    tissue: str | None = None
    assembly: str | None = None
    task_type: str | None = None
    run_id: str | None = None
    harness_id: str | None = None
    organism: str | None = None


class SearchBody(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    context: SearchContext = Field(default_factory=SearchContext)
    top_k: int = Field(default=4, ge=1, le=8)
    policy: str = "exact_vector_rerank"


def get_store() -> ResearchStore:
    return _store


async def _vector_probe() -> dict[str, Any]:
    now = time.time()
    if now - float(_probe["at"]) < 30 and _probe["value"].get("reason") != "not_probed":
        return _probe["value"]
    value: dict[str, Any]
    client: MongoDBClient | None = None
    try:
        client = MongoDBClient()
        if await client.ping():
            value = await probe_vector_search(client.db)
        else:
            value = {"supported": False, "active": False, "reason": "mongodb_unreachable"}
    except Exception as exc:
        value = {"supported": False, "active": False, "reason": type(exc).__name__}
    finally:
        if client is not None:
            await client.close()
    _probe["at"] = now
    _probe["value"] = value
    return value


async def _persist(result: dict[str, Any]) -> str:
    client: MongoDBClient | None = None
    try:
        client = MongoDBClient()
        if not await client.ping():
            return "memory_only"
        _store.db = client.db
        await _store.ensure_indexes()
        if _store.runs:
            run = {key: value for key, value in _store.runs[-1].items() if key != "_id"}
            await client.db.retrieval_runs.insert_one(run)
        return "mongodb"
    except Exception:
        return "memory_only"
    finally:
        if client is not None:
            await client.close()


@router.get("/status")
async def research_status() -> dict[str, Any]:
    try:
        adapter = VoyageAdapter()
    except VoyageError as exc:
        return {
            "health": exc.health,
            "legacy_status": "NOT_CONFIGURED",
            "embedding_model": None,
            "fast_model": None,
            "rerank_model": None,
            "base_host": None,
            "verified": False,
            "documents": len(_store.documents),
            "vector_search": {"supported": False, "active": False, "reason": exc.health},
            "disclaimer": DISCLAIMER,
            "external_research_text": False,
        }
    probe = await _vector_probe()
    configured = adapter.status == "CONFIGURED"
    return {
        "health": adapter.health_state(),
        "legacy_status": adapter.status,
        "embedding_model": adapter.config.embedding_model if configured else None,
        "fast_model": adapter.config.fast_model if configured else None,
        "rerank_model": adapter.config.rerank_model if configured else None,
        "base_host": adapter.config.host,
        "verified": adapter.health_state() == "connected",
        "documents": len(_store.documents),
        "vector_search": probe,
        "disclaimer": DISCLAIMER,
        "external_research_text": adapter.config.allow_external_research_text,
    }


@router.post("/search")
async def research_search(body: SearchBody) -> dict[str, Any]:
    if body.policy not in ALLOWED_RETRIEVAL_POLICIES:
        raise HTTPException(status_code=400, detail="unknown retrieval policy")
    try:
        adapter = VoyageAdapter()
    except VoyageError as exc:
        raise HTTPException(status_code=409, detail=exc.health) from exc
    pipeline = ResearchPipeline(_store, adapter)
    pipeline.vector_search = await _vector_probe()
    result = await search_research_evidence(
        pipeline,
        body.query,
        body.context.model_dump(),
        top_k=body.top_k,
        policy=body.policy,
    )
    # The tool returns citations. Also keep the trace fields operators need.
    raw = pipeline.store.runs[-1] if pipeline.store.runs else {}
    persistence = await _persist(result)
    raindrop_sent = False
    try:
        raindrop = RaindropAdapter()
        raindrop_sent = await raindrop.record_tool(
            ToolEvent(
                run_id=str(result.get("status") or "research"),
                tool_name="search_research_evidence",
                runtime_ms=float(raw.get("elapsed_ms") or 0),
                exit_code=0 if result["status"] != "refused" else 1,
            )
        )
    except Exception:
        raindrop_sent = False
    result["persistence"] = persistence
    result["raindrop_recorded"] = raindrop_sent
    result["index"] = {
        "mode": raw.get("index_mode"),
        "vector_search_supported": bool(pipeline.vector_search.get("supported")),
        "vector_search_active": bool(pipeline.vector_search.get("active")),
    }
    return result
