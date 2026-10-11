from __future__ import annotations

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from services.api.app.dependencies import get_harness_repo
from services.api.app.routes.harnesses import router
from services.integrations.mongodb import HarnessRepository, MongoDBClient
from services.integrations.mongodb.models import HarnessStatus, HarnessVersionModel

AUDIT_DB = "diamond_audit_route_harnesses"


@pytest.fixture
async def api():
    mongo = MongoDBClient(db_name=AUDIT_DB)
    repo = HarnessRepository(mongo=mongo)
    await mongo.db.harness_versions.delete_many({})
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_harness_repo] = lambda: repo
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, repo
    await mongo.db.harness_versions.delete_many({})
    await mongo.close()


async def _seed(repo: HarnessRepository) -> None:
    await repo.save_version(
        HarnessVersionModel(version_id="h-root", status=HarnessStatus.BASELINE)
    )
    await repo.save_version(
        HarnessVersionModel(
            version_id="h-child", parent_version_id="h-root", status=HarnessStatus.CANDIDATE
        )
    )


async def test_list_and_get_harness(api):
    client, repo = api
    await _seed(repo)
    listed = await client.get("/api/harnesses")
    assert listed.status_code == 200
    assert [h["version_id"] for h in listed.json()["harnesses"]] == ["h-root", "h-child"]
    assert "_id" not in listed.json()["harnesses"][0]

    got = await client.get("/api/harnesses/h-child")
    assert got.status_code == 200
    assert got.json()["parent_version_id"] == "h-root"

    missing = await client.get("/api/harnesses/does-not-exist")
    assert missing.status_code == 404


async def test_lineage_known_root_returns_persisted_graph(api):
    client, repo = api
    await _seed(repo)
    resp = await client.get("/api/harnesses/h-root/lineage")
    assert resp.status_code == 200
    body = resp.json()
    assert body["root_version_id"] == "h-root"
    assert {n["id"] for n in body["nodes"]} == {"h-root", "h-child"}
    assert body["edges"] == [{"source": "h-root", "target": "h-child", "label": "policy_mutation"}]


async def test_lineage_unknown_root_is_404_not_invented_root(api):
    client, repo = api
    await _seed(repo)
    resp = await client.get("/api/harnesses/no-such-version/lineage")
    assert resp.status_code == 404
