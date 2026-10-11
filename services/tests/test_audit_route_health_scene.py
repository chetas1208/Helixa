from __future__ import annotations

import json
import time

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from services.api.app.dependencies import get_mongo_client
from services.api.app.routes import health, scene
from services.integrations.mongodb import MongoDBClient

AUDIT_DB = "diamond_audit_route_health_scene"
SECRET_URI = "mongodb://audituser:s3cretpw@127.0.0.1:27017"


class StubMongo(MongoDBClient):
    def __init__(self, ping_ok: bool, status: str, uri: str = SECRET_URI):
        super().__init__(uri=uri, db_name=AUDIT_DB, require_atlas=False)
        self._ping_ok = ping_ok
        self._status = status

    async def ping(self) -> bool:
        return self._ping_ok

    async def verify_write(self) -> bool:
        return self._status == "WRITE_VERIFIED"


def _app(mongo: MongoDBClient) -> FastAPI:
    app = FastAPI()
    app.include_router(health.router)
    app.include_router(scene.router)
    app.dependency_overrides[get_mongo_client] = lambda: mongo
    return app


def _client(mongo: MongoDBClient) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=_app(mongo)), base_url="http://test")


async def test_health_degraded_when_ping_fails():
    async with _client(StubMongo(False, "INACCESSIBLE")) as c:
        resp = await c.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "DEGRADED"
    assert body["database"] == "INACCESSIBLE"


async def test_health_healthy_when_ping_ok():
    async with _client(StubMongo(True, "WRITE_VERIFIED")) as c:
        resp = await c.get("/api/health")
    body = resp.json()
    assert body["status"] == "HEALTHY"
    assert body["database"] == "CONNECTED"
    assert "s3cretpw" not in resp.text


async def test_ready_503_when_unreachable():
    async with _client(StubMongo(False, "INACCESSIBLE")) as c:
        resp = await c.get("/api/health/ready")
    assert resp.status_code == 503
    body = resp.json()
    assert body["ready"] is False
    assert body["status"] == "NOT_READY"
    assert body["database"]["status"] == "INACCESSIBLE"
    assert "s3cretpw" not in resp.text


async def test_ready_503_when_write_probe_fails():
    async with _client(StubMongo(True, "AUTHENTICATED")) as c:
        resp = await c.get("/api/health/ready")
    assert resp.status_code == 503
    assert resp.json()["database"]["status"] == "AUTHENTICATED"


async def test_ready_200_when_write_verified():
    async with _client(StubMongo(True, "WRITE_VERIFIED")) as c:
        resp = await c.get("/api/health/ready")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ready"] is True
    assert body["status"] == "READY"
    assert "s3cretpw" not in resp.text


async def test_integrations_status_unconfigured_and_masks_mongo_credentials(monkeypatch):
    for key in ("RAINDROP_ENABLED", "RAINDROP_WRITE_KEY", "ELEVENLABS_ENABLED", "ELEVENLABS_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    async with _client(StubMongo(True, "WRITE_VERIFIED")) as c:
        resp = await c.get("/api/integrations/status")
    assert resp.status_code == 200
    body = resp.json()
    assert "s3cretpw" not in resp.text
    assert body["mongodb"]["uri"] == "mongodb://audituser:****@127.0.0.1:27017"
    assert body["mongodb"]["status"] == "WRITE_VERIFIED"
    assert body["raindrop"] == {"status": "NOT_CONFIGURED", "endpoint": None}
    assert body["elevenlabs"] == {"status": "NOT_CONFIGURED", "voice_id": None}
    assert body["model_provider"]["status"] == "CONFIGURED"


async def test_integrations_status_does_not_leak_sponsor_secrets(monkeypatch):
    monkeypatch.setenv("RAINDROP_ENABLED", "true")
    monkeypatch.setenv("RAINDROP_WRITE_KEY", "rd-write-key-SECRET")
    monkeypatch.setenv("ELEVENLABS_ENABLED", "true")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "el-api-key-SECRET")
    async with _client(StubMongo(False, "INACCESSIBLE")) as c:
        resp = await c.get("/api/integrations/status")
    body = resp.json()
    assert body["raindrop"]["status"] == "CONFIGURED"
    assert body["elevenlabs"]["status"] == "CONFIGURED"
    assert body["mongodb"]["status"] == "INACCESSIBLE"
    assert body["mongodb"]["write_verified"] is False
    assert "SECRET" not in resp.text
    assert "s3cretpw" not in resp.text


async def test_integrations_status_not_configured_mongo_reports_honestly():
    mongo = StubMongo(False, "INACCESSIBLE", uri="mongodb://")
    mongo.uri = ""
    async with _client(mongo) as c:
        resp = await c.get("/api/integrations/status")
    assert resp.status_code == 200
    assert resp.json()["mongodb"]["status"] == "NOT_CONFIGURED"


async def test_health_ready_real_local_mongo_audit_db():
    mongo = MongoDBClient(db_name=AUDIT_DB)
    try:
        async with _client(mongo) as c:
            resp = await c.get("/api/health/ready")
        assert resp.status_code == 200
        assert resp.json()["database"]["database"] == AUDIT_DB
    finally:
        await mongo.client.drop_database(AUDIT_DB)
        await mongo.close()


async def test_scene_state_shape_and_invariants():
    async with _client(StubMongo(True, "WRITE_VERIFIED")) as c:
        resp = await c.get("/api/scene/state")
    assert resp.status_code == 200
    s = resp.json()
    assert s["epoch"] == scene.SCENE_EPOCH
    assert s["cycle_duration"] == 300.0
    assert 0.0 <= s["cycle_phase"] < 1.0
    assert s["cycle_index"] == int(s["elapsed_seconds"] // 300.0)
    assert s["is_transitioning"] == (s["cycle_phase"] >= 0.85)
    assert s["current_style"] != s["next_style"]
    for style in (s["current_style"], s["next_style"]):
        assert set(style) == {"name", "palette", "emissive_intensity", "radius"}
        assert len(style["palette"]) == 2
    json.dumps(s)


@pytest.mark.parametrize("now_offset", [-10_000.0, 0.0, 299.999, 300.0, 1234.5])
async def test_scene_state_deterministic_for_fixed_clock(monkeypatch, now_offset):
    fixed = scene.SCENE_EPOCH + now_offset
    monkeypatch.setattr(time, "time", lambda: fixed)
    async with _client(StubMongo(True, "WRITE_VERIFIED")) as c:
        a = (await c.get("/api/scene/state")).json()
        b = (await c.get("/api/scene/state")).json()
    assert a == b
    expected_elapsed = max(0.0, fixed - scene.SCENE_EPOCH)
    assert a["elapsed_seconds"] == expected_elapsed
    assert a["cycle_index"] == int(expected_elapsed // 300.0)
    assert a["cycle_phase"] == (expected_elapsed % 300.0) / 300.0


async def test_scene_state_style_rotation_wraps(monkeypatch):
    names = []
    for idx in range(6):
        monkeypatch.setattr(time, "time", lambda idx=idx: scene.SCENE_EPOCH + idx * 300.0 + 1.0)
        async with _client(StubMongo(True, "WRITE_VERIFIED")) as c:
            s = (await c.get("/api/scene/state")).json()
        assert s["cycle_index"] == idx
        names.append(s["current_style"]["name"])
    assert names[0] == names[5]
    assert len(set(names[:5])) == 5
    assert s["next_style"]["name"] == names[1]
