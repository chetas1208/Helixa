"""Characterization tests for services/api/app/routes/v8.py (audit unit route_v8)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.api.app.routes import v8


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(v8.router)
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def artifact_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    directory = tmp_path / "v8"
    directory.mkdir()
    monkeypatch.setattr(v8, "_artifact_dir", lambda: directory)
    return directory


def _receipt(**overrides) -> dict:
    receipt = {
        "receipt_id": "rcpt-test",
        "receipt_digest": "d" * 64,
        "run_id": "run-test",
        "decision": "PROMOTED",
        "dual_validator_agreement": "AGREE_FAIL",
        "created_at": "2026-01-01T00:00:00+00:00",
        "metadata": {
            "parent_version_id": "p1",
            "candidate_version_id": "c1",
            "score": "6/6",
            "parent_score": "4/6",
            "false_positive_count": 1,
            "negative_control_count": 4,
            "decision_reason": "because",
            "holdout_case_ids": ["h1"],
            "reference_artifact_sha256": "a" * 64,
            "raindrop_status": "NOT_CONFIGURED",
            "elevenlabs_status": "NOT_CONFIGURED",
        },
    }
    receipt.update(overrides)
    return receipt


def test_latest_not_run_when_receipt_missing(client: TestClient, artifact_dir: Path) -> None:
    (artifact_dir / "lineage.json").write_text(json.dumps({"nodes": []}))
    response = client.get("/api/v8/latest")
    assert response.status_code == 200
    assert response.json() == {"status": "NOT_RUN", "receipt": None, "lineage": None, "metrics": None}


def test_latest_maps_recorded_receipt_lineage_and_metrics(client: TestClient, artifact_dir: Path) -> None:
    (artifact_dir / "evidence_receipt.json").write_text(json.dumps(_receipt()))
    nodes = [
        {"id": "p1", "parent_id": None},
        {"id": "c1", "parent_id": "p1"},
        {"id": "c2", "parent_id": "p1"},
    ]
    (artifact_dir / "lineage.json").write_text(json.dumps({"nodes": nodes}))
    (artifact_dir / "runtime_metrics.json").write_text(json.dumps({"model_calls": 0}))
    (artifact_dir / "harness_diff.json").write_text(json.dumps({"changed": True}))

    body = client.get("/api/v8/latest").json()

    assert body["status"] == "RECORDED"
    view = body["receipt"]
    assert view["receipt_id"] == "rcpt-test"
    assert view["promoted"] is True
    assert view["false_positive_rate"] == 0.25
    assert view["adjudication"] == "AGREE_FAIL"
    assert view["optimizer_provenance"] == "DETERMINISTIC"
    assert body["lineage"]["edges"] == [
        {"source": "p1", "target": "c1"},
        {"source": "p1", "target": "c2"},
    ]
    assert body["metrics"] == {"model_calls": 0}
    assert body["diff"] == {"changed": True}


def test_latest_rejected_receipt_with_empty_metadata_uses_honest_defaults(
    client: TestClient, artifact_dir: Path
) -> None:
    (artifact_dir / "evidence_receipt.json").write_text(
        json.dumps(_receipt(decision="REJECTED", metadata={"score": None, "candidate_version_id": None}))
    )
    body = client.get("/api/v8/latest").json()
    view = body["receipt"]
    assert body["status"] == "RECORDED"
    assert view["promoted"] is False
    assert view["score"] == "0/0"
    assert view["candidate_version_id"] == ""
    assert view["false_positive_rate"] == 0.0
    assert view["decision_reason"] == "REJECTED"
    assert body["lineage"] == {"nodes": [], "edges": []}
    assert body["metrics"] is None
    assert body["diff"] is None


def test_latest_response_exposes_no_bson_keys(client: TestClient, artifact_dir: Path) -> None:
    (artifact_dir / "evidence_receipt.json").write_text(json.dumps(_receipt()))
    response = client.get("/api/v8/latest")
    assert "_id" not in response.json()["receipt"]
    assert "ObjectId" not in response.text


def test_latest_does_not_write_to_artifact_dir(client: TestClient, artifact_dir: Path) -> None:
    (artifact_dir / "evidence_receipt.json").write_text(json.dumps(_receipt()))
    before = sorted(p.name for p in artifact_dir.iterdir())
    client.get("/api/v8/latest")
    assert sorted(p.name for p in artifact_dir.iterdir()) == before


class _FakeEbi:
    def __init__(self, ok: bool) -> None:
        self._ok = ok

    def checksums_match(self) -> tuple[bool, str]:
        return self._ok, "detail"

    def get_version(self) -> str:
        return "0.10.2"


def test_health_reports_sponsors_not_configured_and_biomni_execution_disabled(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    for name in ("RAINDROP_ENABLED", "RAINDROP_WRITE_KEY", "ELEVENLABS_ENABLED", "ELEVENLABS_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(v8, "EbiVcfValidator", lambda: _FakeEbi(True))
    monkeypatch.setattr(v8, "gepa_package_status", lambda: ("INSTALLED_UNCONFIGURED", "d"))

    body = client.get("/api/v8/health").json()

    assert body["raindrop"] == {"status": "NOT_CONFIGURED"}
    assert body["elevenlabs"] == {"status": "NOT_CONFIGURED"}
    assert body["biomni"]["agent_execution"] == "DISABLED"
    assert body["proposer"] == "DETERMINISTIC"
    assert body["meta_harness_imported"] is False
    assert body["gepa"]["status"] == "INSTALLED_UNCONFIGURED"
    assert body["ebi_vcf_validator"] == {"status": "CONNECTED", "detail": "detail", "version": "0.10.2"}


def test_health_marks_ebi_failed_without_claiming_a_version(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(v8, "EbiVcfValidator", lambda: _FakeEbi(False))
    body = client.get("/api/v8/health").json()
    assert body["ebi_vcf_validator"]["status"] == "FAILED"
    assert body["ebi_vcf_validator"]["version"] == "unavailable"
