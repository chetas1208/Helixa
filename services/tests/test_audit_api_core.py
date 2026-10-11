from __future__ import annotations

import sys
import types

import pytest
from fastapi import APIRouter, FastAPI
from httpx import ASGITransport, AsyncClient

from services.api.app import main as api_main

SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
}

FIXTURES_MODULE = "services.api.app.routes.fixtures"
FINDINGS_MODULE = "services.api.app.routes.findings"
ANATOMY_MODULE = "services.api.app.routes.anatomy"
GENOME_EDIT_MODULE = "services.api.app.routes.genome_edit"


@pytest.mark.asyncio
async def test_unhandled_exception_response_carries_security_headers():
    async def boom():
        raise RuntimeError("audit-boom")

    api_main.app.add_api_route("/api/_audit_api_core_boom", boom, methods=["GET"])
    try:
        transport = ASGITransport(app=api_main.app, raise_app_exceptions=False)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/_audit_api_core_boom")
    finally:
        api_main.app.router.routes.pop()
    assert resp.status_code == 500
    assert resp.text == "Internal Server Error"
    assert "audit-boom" not in resp.text
    for name, value in SECURITY_HEADERS.items():
        assert resp.headers.get(name) == value


@pytest.mark.asyncio
async def test_not_found_response_carries_security_headers():
    transport = ASGITransport(app=api_main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/_audit_api_core_missing")
    assert resp.status_code == 404
    for name, value in SECURITY_HEADERS.items():
        assert resp.headers.get(name) == value


@pytest.mark.asyncio
async def test_cors_allows_only_local_frontend_origins():
    transport = ASGITransport(app=api_main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        ok = await client.options(
            "/api/runs",
            headers={
                "Origin": "http://127.0.0.1:5173",
                "Access-Control-Request-Method": "POST",
            },
        )
        bad = await client.options(
            "/api/runs",
            headers={
                "Origin": "http://evil.example",
                "Access-Control-Request-Method": "POST",
            },
        )
    assert ok.status_code == 200
    assert ok.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
    assert bad.status_code == 400
    assert "access-control-allow-origin" not in bad.headers


def _router_module(path: str, payload: str) -> types.ModuleType:
    module = types.ModuleType("audit_fake_router")
    router = APIRouter(prefix="/api")

    @router.get(path)
    async def handler():
        return {"ok": payload}

    module.router = router
    return module


@pytest.mark.asyncio
async def test_optional_routers_are_included_when_modules_import_cleanly(monkeypatch):
    monkeypatch.setitem(sys.modules, FIXTURES_MODULE, _router_module("/fixtures", "fixtures"))
    monkeypatch.setitem(
        sys.modules, FINDINGS_MODULE, _router_module("/runs/{run_id}/findings", "findings")
    )
    app = FastAPI()
    api_main.include_optional_routers(app)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/api/fixtures")).json() == {"ok": "fixtures"}
        assert (await client.get("/api/runs/r1/findings")).json() == {"ok": "findings"}


@pytest.mark.asyncio
async def test_optional_routers_missing_modules_are_skipped(monkeypatch):
    monkeypatch.setitem(sys.modules, FIXTURES_MODULE, None)
    monkeypatch.setitem(sys.modules, FINDINGS_MODULE, None)
    monkeypatch.setitem(sys.modules, ANATOMY_MODULE, None)
    monkeypatch.setitem(sys.modules, GENOME_EDIT_MODULE, None)
    app = FastAPI()
    api_main.include_optional_routers(app)
    assert [r.path for r in app.routes if r.path.startswith("/api")] == []


@pytest.mark.asyncio
async def test_optional_routers_broken_module_does_not_break_others(monkeypatch):
    real_import = api_main.importlib.import_module

    def fake_import(name, *args, **kwargs):
        if name == FIXTURES_MODULE:
            raise RuntimeError("broken at import")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(api_main.importlib, "import_module", fake_import)
    monkeypatch.setitem(
        sys.modules, FINDINGS_MODULE, _router_module("/runs/{run_id}/findings", "findings")
    )
    monkeypatch.setitem(sys.modules, ANATOMY_MODULE, None)
    monkeypatch.setitem(sys.modules, GENOME_EDIT_MODULE, None)
    app = FastAPI()
    api_main.include_optional_routers(app)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/api/runs/r1/findings")).json() == {"ok": "findings"}
        assert (await client.get("/api/fixtures")).status_code == 404


@pytest.mark.asyncio
async def test_optional_router_module_without_router_attribute_is_skipped(monkeypatch):
    monkeypatch.setitem(sys.modules, FIXTURES_MODULE, types.ModuleType("audit_no_router"))
    monkeypatch.setitem(sys.modules, FINDINGS_MODULE, None)
    monkeypatch.setitem(sys.modules, ANATOMY_MODULE, None)
    monkeypatch.setitem(sys.modules, GENOME_EDIT_MODULE, None)
    app = FastAPI()
    api_main.include_optional_routers(app)
    assert [r.path for r in app.routes if r.path.startswith("/api")] == []


@pytest.mark.asyncio
async def test_untrusted_origin_and_host_are_rejected():
    transport = ASGITransport(app=api_main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        evil = await client.post("/api/health", headers={"origin": "https://evil.example"})
        assert evil.status_code == 403
        allowed = await client.get("/api/health")
        assert allowed.status_code != 400
        rebinding = await client.get("/api/health", headers={"host": "attacker.example"})
        assert rebinding.status_code == 400
