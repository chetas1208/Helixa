from __future__ import annotations

from pathlib import Path

import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from services.api.app.dependencies import get_mongo_client
from services.api.app.routes.findings import router
from services.integrations.mongodb import (
    EventRepository,
    EvidenceReceiptModel,
    EvidenceRepository,
    MongoDBClient,
    RunModel,
    RunRepository,
)
from services.runtime.genomics.orchestrator import DeterministicGenomicsOrchestrator

AUDIT_DB = "diamond_audit_new_findings_endpoint"
REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest_asyncio.fixture
async def mongo():
    client = MongoDBClient(db_name=AUDIT_DB)
    await client.client.drop_database(AUDIT_DB)
    yield client
    await client.client.drop_database(AUDIT_DB)
    await client.close()


@pytest_asyncio.fixture
async def http(mongo):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_mongo_client] = lambda: mongo
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


def _finding_doc(check_id: str, **overrides):
    doc = {
        "check_id": check_id,
        "status": "FAIL",
        "severity": "HIGH",
        "message": f"{check_id} message",
        "source_artifact_sha256": "a" * 64,
    }
    doc.update(overrides)
    return doc


async def test_unknown_run_is_404(http):
    resp = await http.get("/api/runs/run-does-not-exist/findings")
    assert resp.status_code == 404


async def test_run_without_findings_returns_empty_list(http, mongo):
    await RunRepository(mongo=mongo).create_run(RunModel(run_id="run-agent-1", task_id="task-1"))
    await EventRepository(mongo=mongo).append_event("run-agent-1", "run.created")

    resp = await http.get("/api/runs/run-agent-1/findings")

    assert resp.status_code == 200
    assert resp.json() == {"run_id": "run-agent-1", "findings": []}


async def test_findings_read_from_run_document_in_order_with_ui_shape(http, mongo):
    locus = {"chrom": "chr22", "pos": 101, "ref": "A", "alt": ["G", "T"], "id": "rs1"}
    await mongo.db.runs.insert_one(
        {
            "run_id": "run-val-1",
            "status": "FAIL",
            "findings": [
                _finding_doc(
                    "reference_ref_allele_match",
                    locus=locus,
                    observed_value="A",
                    expected_value="C",
                    metadata={"k": "v"},
                ),
                _finding_doc("declared_assembly_check", status="PASS", severity="INFO"),
            ],
        }
    )

    resp = await http.get("/api/runs/run-val-1/findings")

    assert resp.status_code == 200
    body = resp.json()
    assert body["run_id"] == "run-val-1"
    assert body["findings"] == [
        {
            "check_id": "reference_ref_allele_match",
            "status": "FAIL",
            "severity": "HIGH",
            "message": "reference_ref_allele_match message",
            "locus": {"chrom": "chr22", "pos": 101, "ref": "A", "alt": ["G", "T"]},
            "metadata": {"k": "v", "observed_value": "A", "expected_value": "C"},
        },
        {
            "check_id": "declared_assembly_check",
            "status": "PASS",
            "severity": "INFO",
            "message": "declared_assembly_check message",
        },
    ]
    assert '"_id"' not in resp.text


async def test_findings_read_from_event_payloads_across_pages(http, mongo):
    events = EventRepository(mongo=mongo)
    for i in range(205):
        await events.append_event("run-ev-1", "tick", payload={"i": i})
    await events.append_event(
        "run-ev-1",
        "run.validation.findings",
        payload={"findings": [_finding_doc("late_event_finding", status="WARNING", severity="MEDIUM")]},
    )

    resp = await http.get("/api/runs/run-ev-1/findings")

    assert resp.status_code == 200
    assert [f["check_id"] for f in resp.json()["findings"]] == ["late_event_finding"]
    assert resp.json()["findings"][0]["status"] == "WARNING"


async def test_run_document_findings_take_precedence_over_events(http, mongo):
    await mongo.db.runs.insert_one({"run_id": "run-both", "findings": [_finding_doc("from_run")]})
    await EventRepository(mongo=mongo).append_event(
        "run-both", "x", payload={"findings": [_finding_doc("from_event")]}
    )

    resp = await http.get("/api/runs/run-both/findings")

    assert [f["check_id"] for f in resp.json()["findings"]] == ["from_run"]


async def test_malformed_recorded_findings_are_skipped(http, mongo):
    await mongo.db.runs.insert_one(
        {
            "run_id": "run-bad",
            "findings": [
                "not-a-dict",
                {"message": "missing check_id"},
                _finding_doc("bad_status", status="EXPLODED"),
                _finding_doc("good"),
            ],
        }
    )

    resp = await http.get("/api/runs/run-bad/findings")

    assert resp.status_code == 200
    assert [f["check_id"] for f in resp.json()["findings"]] == ["good"]


async def test_findings_field_of_wrong_type_yields_empty_list(http, mongo):
    await mongo.db.runs.insert_one({"run_id": "run-weird", "findings": {"check_id": "x"}})

    resp = await http.get("/api/runs/run-weird/findings")

    assert resp.status_code == 200
    assert resp.json()["findings"] == []


async def test_run_known_only_by_evidence_receipt_is_empty_not_404(http, mongo):
    await EvidenceRepository(mongo=mongo).save_receipt(
        EvidenceReceiptModel(
            receipt_id="rcpt-1",
            receipt_digest="d" * 64,
            run_id="run-rcpt-only",
            candidate_version_id="harness-v2",
            score="6/6",
            promoted=True,
        )
    )

    resp = await http.get("/api/runs/run-rcpt-only/findings")

    assert resp.status_code == 200
    assert resp.json() == {"run_id": "run-rcpt-only", "findings": []}


async def test_other_runs_findings_are_not_leaked(http, mongo):
    await mongo.db.runs.insert_one({"run_id": "run-a", "findings": [_finding_doc("only_a")]})
    await mongo.db.runs.insert_one({"run_id": "run-b", "findings": [_finding_doc("only_b")]})

    resp = await http.get("/api/runs/run-a/findings")

    assert [f["check_id"] for f in resp.json()["findings"]] == ["only_a"]


async def test_query_operator_in_run_id_is_treated_as_literal(http, mongo):
    await mongo.db.runs.insert_one({"run_id": "run-a", "findings": [_finding_doc("only_a")]})

    resp = await http.get("/api/runs/%7B%22%24ne%22%3A%22x%22%7D/findings")

    assert resp.status_code == 404


async def test_oversized_run_id_is_rejected(http):
    resp = await http.get(f"/api/runs/{'r' * 257}/findings")

    assert resp.status_code == 422


async def test_real_pipeline_findings_round_trip(http, mongo, tmp_path):
    orchestrator = DeterministicGenomicsOrchestrator(
        cas_root=tmp_path / "cas",
        scratch_root=tmp_path / "scratch",
        mongo_client=mongo,
    )
    run, _receipt = await orchestrator.execute_pipeline(
        vcf_path=REPO_ROOT / "fixtures" / "invalid" / "ref_mismatch.vcf",
        fasta_path=REPO_ROOT / "fixtures" / "references" / "ref_synthetic_chr22.fasta",
        run_id="run-val-real",
    )
    assert run.findings

    resp = await http.get("/api/runs/run-val-real/findings")

    assert resp.status_code == 200
    got = resp.json()["findings"]
    assert [f["check_id"] for f in got] == [f.check_id for f in run.findings]
    assert [f["status"] for f in got] == [f.status.value for f in run.findings]
    assert [f["severity"] for f in got] == [f.severity.value for f in run.findings]
    assert [f["message"] for f in got] == [f.message for f in run.findings]
    mismatch = [f for f in got if f["status"] == "FAIL" and "locus" in f]
    assert mismatch
    assert set(mismatch[0]["locus"]) == {"chrom", "pos", "ref", "alt"}
    assert isinstance(mismatch[0]["locus"]["alt"], list)
    allowed_keys = {"check_id", "status", "severity", "message", "locus", "metadata"}
    assert all(set(f) <= allowed_keys for f in got)
