"""Route-level contract guard for the endpoints the V12 UI binds to (store tests alone missed a dropped decorator)."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.api.app.routes import v10
from services.runtime.genome_workspace.store import WorkspaceStore


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(v10, "_store", WorkspaceStore(tmp_path / "state.json"))
    app = FastAPI()
    app.include_router(v10.router)
    return TestClient(app)


def _routes(client):
    paths = client.get("/openapi.json").json()["paths"]
    return {(method.upper(), path) for path, ops in paths.items() for method in ops}


def test_ui_bound_routes_are_mounted(client):
    mounted = _routes(client)
    required = {
        ("GET", "/api/v10/genome/baselines"),
        ("GET", "/api/v10/genome/window"),
        ("GET", "/api/v10/genome/workspaces"),
        ("POST", "/api/v10/genome/workspaces"),
        ("GET", "/api/v10/genome/workspaces/{workspace_id}"),
        ("POST", "/api/v10/genome/workspaces/{workspace_id}/select"),
        ("POST", "/api/v10/genome/workspaces/{workspace_id}/branch"),
        ("POST", "/api/v10/genome/workspaces/{workspace_id}/proposals"),
        ("POST", "/api/v10/genome/workspaces/{workspace_id}/commit"),
        ("GET", "/api/v10/genome/workspaces/{workspace_id}/intelligence"),
        ("GET", "/api/v10/evolution/parameters"),
        ("GET", "/api/v10/evolution/environments"),
        ("POST", "/api/v10/evolution/simulations"),
        ("GET", "/api/v10/evolution/simulations/{simulation_id}"),
    }
    assert required <= mounted, sorted(required - mounted)


def test_propose_then_commit_over_http(client):
    ws = client.post("/api/v10/genome/workspaces", json={"name": "contract"}).json()
    wid = ws["workspace_id"]
    prop = client.post(f"/api/v10/genome/workspaces/{wid}/proposals", json={"position": 4, "alt": "A"})
    assert prop.status_code == 200 and prop.json()["status"] == "READY"
    done = client.post(
        f"/api/v10/genome/workspaces/{wid}/commit",
        json={"proposal_id": prop.json()["proposal_id"], "expected_counter": ws["revision_counter"]},
    )
    assert done.status_code == 200 and done.json()["edit_count"] == 1
    stale = client.post(
        f"/api/v10/genome/workspaces/{wid}/commit",
        json={"proposal_id": prop.json()["proposal_id"], "expected_counter": ws["revision_counter"]},
    )
    assert stale.status_code in {400, 409}
