from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.api.app.routes import capabilities, investigations
from services.runtime.capabilities.registry import CapabilityRegistry

REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.chdir(REPO_ROOT)
    monkeypatch.setattr(capabilities, "registry", CapabilityRegistry())
    app = FastAPI()
    app.include_router(investigations.router)
    app.include_router(capabilities.router)
    return TestClient(app, raise_server_exceptions=False)


def test_investigate_known_fixture_ok(client):
    res = client.post("/api/runs/run-audit-1/investigate", json={})
    assert res.status_code == 200
    body = res.json()
    assert body["run_id"] == "run-audit-1"
    assert len(body["source_artifact_sha256"]) == 64


def test_investigate_allows_fixture_with_internal_dotdot_that_stays_inside_root(client):
    res = client.post(
        "/api/runs/run-audit-1/investigate",
        json={"vcf_path": "fixtures/invalid/../valid/valid_snvs.vcf"},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "resolved"


def test_investigate_rejects_vcf_outside_allowed_roots(client, tmp_path):
    outside = tmp_path / "outside.vcf"
    outside.write_text("##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\n")
    res = client.post("/api/runs/run-audit-1/investigate", json={"vcf_path": str(outside)})
    assert res.status_code == 400
    assert "source_artifact_sha256" not in res.text


def test_investigate_rejects_fasta_outside_allowed_roots(client, tmp_path):
    outside = tmp_path / "outside.fasta"
    outside.write_text(">chr22\nACGT\n")
    res = client.post("/api/runs/run-audit-1/investigate", json={"fasta_path": str(outside)})
    assert res.status_code == 400


def test_investigate_rejects_traversal_out_of_fixtures(client):
    res = client.post(
        "/api/runs/run-audit-1/investigate",
        json={"vcf_path": "fixtures/../pyproject.toml"},
    )
    assert res.status_code == 400


def test_investigate_directory_is_404_not_500(client):
    res = client.post("/api/runs/run-audit-1/investigate", json={"vcf_path": "fixtures/invalid"})
    assert res.status_code == 404
    res = client.post("/api/runs/run-audit-1/investigate", json={"fasta_path": "fixtures/references"})
    assert res.status_code == 404


def test_investigate_nul_byte_path_is_client_error(client):
    res = client.post("/api/runs/run-audit-1/investigate", json={"vcf_path": "fixtures/a\x00b"})
    assert res.status_code == 400


def test_investigate_missing_file_is_404(client):
    res = client.post(
        "/api/runs/run-audit-1/investigate",
        json={"vcf_path": "fixtures/invalid/does_not_exist.vcf"},
    )
    assert res.status_code == 404


def test_evolve_with_valid_finding(client):
    res = client.post(
        "/api/runs/run-audit-1/evolve",
        json={"failure_finding": {"code": "REF_MISMATCH", "details": "ref allele does not match"}},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["hypothesis"]["failure_type"] == "REF_ALLELE_MISMATCH"
    assert body["proposed_candidates_count"] >= 1


@pytest.mark.parametrize("finding", [{"details": 5}, {"details": None}, {"details": ["x"]}])
def test_evolve_rejects_non_string_details_with_422(client, finding):
    res = client.post("/api/runs/run-audit-1/evolve", json={"failure_finding": finding})
    assert res.status_code == 422


def test_capabilities_not_found_detail_has_no_repr_quotes(client):
    for method, path in (
        ("post", "/api/capabilities/nope/activate"),
        ("post", "/api/capabilities/nope/quarantine"),
        ("get", "/api/capabilities/nope"),
    ):
        res = getattr(client, method)(path)
        assert res.status_code == 404
        assert res.json()["detail"] == "Capability 'nope' not found."


def _macro(macro_id: str, tool: str = "inspect_vcf") -> dict:
    return {
        "macro": {
            "macro_id": macro_id,
            "name": "Audit macro",
            "description": "route audit",
            "steps": [{"step_id": "s1", "primitive_tool_id": tool, "argument_mapping": {"path": "vcf"}}],
            "required_primitives": [tool],
        }
    }


def test_capabilities_register_activate_quarantine_flow(client):
    res = client.post("/api/capabilities/register", json=_macro("audit-macro-1"))
    assert res.status_code == 200
    assert res.json()["status"] == "draft"

    res = client.post("/api/capabilities/audit-macro-1/activate")
    assert res.status_code == 200
    assert res.json()["status"] == "active"

    res = client.post("/api/capabilities/audit-macro-1/quarantine?reason=audit")
    assert res.status_code == 200
    assert res.json()["status"] == "quarantined"

    listed = client.get("/api/capabilities?status=quarantined").json()
    assert [c["capability_id"] for c in listed] == ["audit-macro-1"]


def test_capabilities_register_rejects_unauthorized_primitive(client):
    res = client.post("/api/capabilities/register", json=_macro("audit-macro-2", tool="rm_rf"))
    assert res.status_code == 400


def test_capabilities_register_rejects_unsafe_constructs(client):
    body = _macro("audit-macro-3")
    body["macro"]["steps"][0]["argument_mapping"] = {"cmd": "eval(x)"}
    res = client.post("/api/capabilities/register", json=body)
    assert res.status_code == 400
