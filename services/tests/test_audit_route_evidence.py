from __future__ import annotations

import uuid

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from services.api.app.dependencies import get_evidence_repo
from services.api.app.routes import evidence
from services.integrations.mongodb import EvidenceRepository, MongoDBClient
from services.integrations.mongodb.models import EvidenceReceiptModel
from services.runtime.genomics.contracts import CheckStatus, ScientificEvidenceReceipt


@pytest.fixture
async def ctx():
    mongo = MongoDBClient(db_name=f"diamond_audit_route_evidence_{uuid.uuid4().hex[:8]}")
    repo = EvidenceRepository(mongo=mongo)
    app = FastAPI()
    app.include_router(evidence.router)
    app.dependency_overrides[get_evidence_repo] = lambda: repo
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield client, repo, mongo
    finally:
        await mongo.client.drop_database(mongo.db_name)
        await mongo.close()


def _model_receipt() -> EvidenceReceiptModel:
    tag = uuid.uuid4().hex[:8]
    return EvidenceReceiptModel(
        receipt_id=f"rcpt-{tag}",
        receipt_digest=f"digest-{tag}",
        run_id=f"run-{tag}",
        candidate_version_id="cand-1",
        score="5/6",
        promoted=True,
    )


async def _scientific_receipt(repo: EvidenceRepository) -> ScientificEvidenceReceipt:
    tag = uuid.uuid4().hex[:8]
    receipt = ScientificEvidenceReceipt.create(
        receipt_id=f"ev-rcpt-{tag}",
        run_id=f"run-sci-{tag}",
        source_sha256="a" * 64,
        declared_ref="GRCh38",
        selected_fasta_sha256="b" * 64,
        tool_chain={"pysam": "0.24.1"},
        findings_summary={"PASS": 1},
        overall_status=CheckStatus.PASS,
    )
    await repo.db.evidence_receipts.replace_one(
        {"receipt_id": receipt.receipt_id}, receipt.model_dump(mode="json"), upsert=True
    )
    return receipt


async def test_lookup_by_id_digest_and_run(ctx):
    client, repo, _ = ctx
    model = _model_receipt()
    await repo.save_receipt(model)
    for key in (model.receipt_id, model.receipt_digest, model.run_id):
        resp = await client.get(f"/api/evidence/{key}")
        assert resp.status_code == 200
        assert resp.json()["receipt_id"] == model.receipt_id
        assert "_id" not in resp.json()


async def test_unknown_id_is_404(ctx):
    client, _, _ = ctx
    resp = await client.get("/api/evidence/does-not-exist")
    assert resp.status_code == 404


async def test_scientific_receipt_is_served_not_500(ctx):
    client, repo, _ = ctx
    receipt = await _scientific_receipt(repo)
    for key in (receipt.receipt_id, receipt.receipt_digest, receipt.run_id):
        resp = await client.get(f"/api/evidence/{key}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["receipt_id"] == receipt.receipt_id
        assert body["receipt_digest"] == receipt.receipt_digest
        assert "_id" not in body
