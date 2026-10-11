from __future__ import annotations

import os

from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse

from services.api.app.dependencies import get_mongo_client
from services.integrations.elevenlabs import ElevenLabsAdapter
from services.integrations.mongodb import MongoDBClient
from services.integrations.raindrop import RaindropAdapter
from services.integrations.voyage import VoyageAdapter, VoyageError


def _voyage_status() -> dict[str, object]:
    """Key presence is not connectivity. `verified` is true only after a successful call."""
    try:
        adapter = VoyageAdapter()
    except VoyageError as exc:
        return {
            "status": "NOT_CONFIGURED",
            "health": exc.health,
            "model": None,
            "verified": False,
        }
    configured = adapter.status == "CONFIGURED"
    return {
        "status": adapter.status,
        "health": adapter.health_state(),
        "model": adapter.config.embedding_model if configured else None,
        "rerank_model": adapter.config.rerank_model if configured else None,
        "base_host": adapter.config.host,
        "verified": adapter.health_state() == "connected",
    }


router = APIRouter(tags=["health"])


def _model_provider_status() -> dict[str, str]:
    provider = os.getenv("MODEL_PROVIDER", "deterministic")
    name = os.getenv("MODEL_NAME", "")
    key = os.getenv("MODEL_API_KEY", "")
    if provider == "openai-compatible" and key and name:
        return {"status": "CONFIGURED", "provider": name}
    return {"status": "CONFIGURED", "provider": "deterministic-research-proposer"}

def _product_display_name() -> str:
    """User-facing name. Does not rename the service id or the database."""
    return os.getenv("HELIXA_DISPLAY_NAME") or os.getenv("HELIXA_APP_NAME") or "HELIXA"


@router.get("/api/health")
async def get_health(mongo: MongoDBClient = Depends(get_mongo_client)):
    """Liveness probe: verifies process is alive and database is reachable."""
    mongo_ok = await mongo.ping()
    return {
        "status": "HEALTHY" if mongo_ok else "DEGRADED",
        "service": "diamond-genome-api",
        "product_display_name": _product_display_name(),
        "version": "0.5.0",
        "database": "CONNECTED" if mongo_ok else "INACCESSIBLE",
        "mode": mongo.deployment_mode,
    }

@router.get("/api/health/ready")
async def get_health_ready(mongo: MongoDBClient = Depends(get_mongo_client)):
    """
    Readiness probe: verifies database ping AND active write permissions.
    Returns 200 OK when ready to accept traffic, 503 SERVICE UNAVAILABLE when degraded.
    """
    db_status = await mongo.check_status()
    is_ready = db_status["status"] == "WRITE_VERIFIED"

    payload = {
        "ready": is_ready,
        "status": "READY" if is_ready else "NOT_READY",
        "service": "diamond-genome-api",
        "product_display_name": _product_display_name(),
        "database": db_status,
    }

    if not is_ready:
        return JSONResponse(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, content=payload)
    return payload

@router.get("/api/integrations/status")
async def get_integrations_status(mongo: MongoDBClient = Depends(get_mongo_client)):
    """
    Diagnostic status of all third-party and backing services.
    Never fabricates live connectivity; distinguishes local vs Atlas sandbox.
    """
    mongo_diag = await mongo.check_status()
    raindrop = RaindropAdapter()
    eleven = ElevenLabsAdapter()

    return {
        "mongodb": {
            "status": mongo_diag["status"],
            "mode": mongo_diag["mode"],
            "is_atlas": mongo_diag["is_atlas"],
            "uri": mongo_diag["sanitized_uri"],
            "database": mongo_diag["database"],
            "write_verified": mongo_diag["write_verified"],
            "require_atlas": mongo.require_atlas,
            "error": mongo_diag["error"],
        },
        "raindrop": {
            "status": raindrop.status,
            "endpoint": raindrop.endpoint if raindrop.status == "CONFIGURED" else None,
        },
        "elevenlabs": {
            "status": eleven.status,
            "voice_id": eleven.voice_id if eleven.status == "CONFIGURED" else None,
        },
        "voyage": _voyage_status(),
        "model_provider": _model_provider_status(),
    }
