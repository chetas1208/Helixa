from __future__ import annotations

import importlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import PlainTextResponse, Response

from services.integrations.mongodb import MongoDBClient

from .config import config
from .routes import (
    capabilities,
    datasets,
    evidence,
    harnesses,
    health,
    investigations,
    runs,
    scene,
    seals,
    v8,
    v10,
    v16_research,
    v18_research,
    validation,
    voice,
)

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("diamond.api")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Lifespan: scoped MongoDBClient and connection pool
    logger.info("Initializing lifespan MongoDB client and verifying schemas...")
    mongo = MongoDBClient(
        uri=config.mongodb_uri,
        db_name=config.mongodb_database,
        app_name=config.mongodb_app_name,
        server_selection_timeout_ms=config.mongodb_server_selection_timeout_ms,
        connect_timeout_ms=config.mongodb_connect_timeout_ms,
        min_pool_size=config.mongodb_min_pool_size,
        max_pool_size=config.mongodb_max_pool_size,
        require_atlas=config.mongodb_require_atlas,
    )
    app.state.mongo = mongo
    try:
        await mongo.init_indexes()
        logger.info(f"MongoDB indexes verified successfully (mode: {mongo.deployment_mode}).")
    except Exception as e:
        logger.warning(f"Could not connect to MongoDB on startup (will retry on requests): {e}")

    yield

    logger.info("Shutting down API and closing MongoDB connection pool...")
    if app.state.mongo:
        await app.state.mongo.close()

app = FastAPI(
    title="HELIXA",
    description="HELIXA research API. Stable service id remains diamond-genome-api. Historical records may say DIAMOND Genome.",
    version="0.5.0",
    lifespan=lifespan,
)

# Strict CORS: local frontend origin only
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

_ALLOWED_ORIGINS = {"http://127.0.0.1:5173", "http://localhost:5173"}
_ALLOWED_HOSTS = {"127.0.0.1", "localhost", "testserver", "test"}


def _host_name(value: str) -> str:
    host = value.split(",")[0].strip()
    if host.startswith("["):
        return host[1:].split("]")[0]
    return host.split(":")[0]


@app.middleware("http")
async def reject_untrusted_origin_and_host(request: Request, call_next):
    host = _host_name(request.headers.get("host", ""))
    if host and host not in _ALLOWED_HOSTS:
        return _apply_security_headers(PlainTextResponse("Untrusted host", status_code=400))
    origin = request.headers.get("origin")
    if request.method not in {"GET", "HEAD", "OPTIONS"} and origin and origin not in _ALLOWED_ORIGINS:
        return _apply_security_headers(PlainTextResponse("Untrusted origin", status_code=403))
    return _apply_security_headers(await call_next(request))


# Mandatory Security Headers Middleware
def _apply_security_headers(response: Response) -> Response:
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response

@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    return _apply_security_headers(await call_next(request))

# Unhandled errors are answered outside user middleware, so headers are applied here.
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    return _apply_security_headers(PlainTextResponse("Internal Server Error", status_code=500))

# Include all route routers
app.include_router(health.router)
app.include_router(datasets.router)
app.include_router(runs.router)
app.include_router(harnesses.router)
app.include_router(evidence.router)
app.include_router(validation.router)
app.include_router(scene.router)
app.include_router(voice.router)
app.include_router(capabilities.router)
app.include_router(investigations.router)
app.include_router(seals.router)
app.include_router(v8.router)
app.include_router(v10.router)
app.include_router(v16_research.router)
app.include_router(v18_research.router)

def include_optional_routers(target: FastAPI) -> None:
    """Include routers from optional route modules only if they import cleanly."""
    for name in ("fixtures", "findings", "anatomy", "genome_edit"):
        module_name = f"{__package__}.routes.{name}"
        try:
            module = importlib.import_module(module_name)
        except ModuleNotFoundError as e:
            if e.name != module_name:
                logger.warning(f"Skipping optional router '{name}': {e}")
            continue
        except Exception as e:
            logger.warning(f"Skipping optional router '{name}': {e}")
            continue
        router = getattr(module, "router", None)
        if router is None:
            logger.warning(f"Skipping optional router '{name}': module exports no router")
            continue
        target.include_router(router)

include_optional_routers(app)
