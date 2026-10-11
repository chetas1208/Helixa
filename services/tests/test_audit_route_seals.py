from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.api.app.routes import seals
from services.runtime.evaluation.seal import EvidenceSealV1


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(seals, "SEALS_DIR", tmp_path)
    app = FastAPI()
    app.include_router(seals.router)
    return TestClient(app, raise_server_exceptions=False)


def _stored_seal(seal_id: str) -> EvidenceSealV1:
    return EvidenceSealV1.create(
        seal_id=seal_id,
        run_id="run-audit",
        parent_harness_id="h-parent",
        candidate_harness_id="h-cand",
        mutation_hash="a" * 64,
        input_manifest_hash="b" * 64,
        suite_hash="c" * 64,
        environment_manifest_hash="d" * 64,
        case_result_ids=["case-1"],
        safety_gate_results={"gate": True},
        metric_summary={"score": "1/1"},
        decision="PROMOTED",
        decision_reason="audit fixture",
    )


def test_unknown_seal_is_not_fabricated(client):
    resp = client.get("/api/evidence-seals/never-recorded")
    assert resp.status_code == 404


def test_unknown_seal_never_verifies_as_authentic(client):
    resp = client.get("/api/evidence-seals/never-recorded/verify")
    assert resp.status_code == 404


def test_overlong_seal_id_is_not_found_not_server_error(client):
    resp = client.get("/api/evidence-seals/" + "a" * 300)
    assert resp.status_code == 404


def test_encoded_traversal_seal_id_is_not_found(client, tmp_path):
    outside = tmp_path.parent / "outside_seal.json"
    outside.write_text(_stored_seal("outside_seal").model_dump_json(), encoding="utf-8")
    try:
        resp = client.get("/api/evidence-seals/..%2Foutside_seal")
        assert resp.status_code == 404
    finally:
        outside.unlink()


def test_recorded_seal_roundtrip_verifies(client, tmp_path):
    seal = _stored_seal("seal-ok")
    (tmp_path / "seal-ok.json").write_text(seal.model_dump_json(), encoding="utf-8")

    got = client.get("/api/evidence-seals/seal-ok")
    assert got.status_code == 200
    assert got.json()["seal_hash"] == seal.seal_hash

    ver = client.get("/api/evidence-seals/seal-ok/verify")
    assert ver.status_code == 200
    body = ver.json()
    assert body["is_valid"] is True
    assert body["stored_seal_hash"] == body["recomputed_hash"] == seal.seal_hash


def test_tampered_recorded_seal_reports_invalid(client, tmp_path):
    seal = _stored_seal("seal-bad")
    data = json.loads(seal.model_dump_json())
    data["decision"] = "REJECTED"
    (tmp_path / "seal-bad.json").write_text(json.dumps(data), encoding="utf-8")

    body = client.get("/api/evidence-seals/seal-bad/verify").json()
    assert body["is_valid"] is False
    assert body["stored_seal_hash"] != body["recomputed_hash"]


def test_experiments_v7_matches_manifests(client, monkeypatch):
    monkeypatch.chdir(Path(__file__).resolve().parents[2])
    resp = client.get("/api/experiments/v7")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_scenario_families"] == len(body["cases"])
    parts = body["partitions"]
    assert parts["dev_count"] + parts["regression_count"] + parts["sealed_holdout_count"] == len(body["cases"])
