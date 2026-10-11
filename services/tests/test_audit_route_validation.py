from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from services.api.app.dependencies import get_mongo_client
from services.api.app.routes import validation
from services.api.app.routes.validation import resolve_fixture_path
from services.integrations.mongodb import MongoDBClient


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    """CWD with a fixtures tree plus files outside the allowed roots."""
    (tmp_path / "fixtures" / "valid").mkdir(parents=True)
    (tmp_path / "fixtures" / "valid" / "ok.vcf").write_text("x")
    (tmp_path / "fixtures" / "valid" / "weird[1].vcf").write_text("x")
    (tmp_path / "artifacts" / "cas").mkdir(parents=True)
    (tmp_path / "artifacts" / "cas" / "blob.vcf").write_text("x")
    (tmp_path / "secret.txt").write_text("secret")
    outside = tmp_path.parent / f"outside_{uuid.uuid4().hex[:8]}.txt"
    outside.write_text("secret")
    monkeypatch.chdir(tmp_path)
    yield tmp_path, outside
    outside.unlink(missing_ok=True)


def test_resolve_finds_known_names(sandbox):
    root, _ = sandbox
    assert resolve_fixture_path("ok.vcf") == (root / "fixtures/valid/ok.vcf").resolve()
    assert resolve_fixture_path("weird[1].vcf") == (root / "fixtures/valid/weird[1].vcf").resolve()
    assert resolve_fixture_path("blob.vcf") == (root / "artifacts/cas/blob.vcf").resolve()
    assert resolve_fixture_path("fixtures/valid/ok.vcf") == (root / "fixtures/valid/ok.vcf").resolve()


def test_resolve_rejects_absolute_path_outside_roots(sandbox):
    _, outside = sandbox
    with pytest.raises(FileNotFoundError):
        resolve_fixture_path(str(outside))


def test_resolve_rejects_parent_traversal(sandbox):
    _, outside = sandbox
    with pytest.raises(FileNotFoundError):
        resolve_fixture_path(f"../{outside.name}")
    with pytest.raises(FileNotFoundError):
        resolve_fixture_path("fixtures/valid/../../secret.txt")


def test_resolve_rejects_cwd_file_outside_roots(sandbox):
    with pytest.raises(FileNotFoundError):
        resolve_fixture_path("secret.txt")


@pytest.mark.parametrize("name", ["", ".", "..", "valid", "fixtures"])
def test_resolve_never_returns_directory(sandbox, name):
    with pytest.raises(FileNotFoundError):
        resolve_fixture_path(name)


def test_resolve_does_not_expand_wildcards(sandbox):
    for name in ("*.vcf", "ok.v?f", "[o]k.vcf", "**"):
        with pytest.raises(FileNotFoundError):
            resolve_fixture_path(name)


def test_resolve_duplicate_basename_is_deterministic(sandbox, monkeypatch):
    root, _ = sandbox
    for d in ("a_first", "z_last"):
        (root / "fixtures" / d).mkdir()
        (root / "fixtures" / d / "dup.vcf").write_text(d)
    original = Path.glob
    monkeypatch.setattr(Path, "glob", lambda self, pat: iter(reversed(list(original(self, pat)))))
    assert resolve_fixture_path("dup.vcf") == (root / "fixtures/a_first/dup.vcf").resolve()


@pytest.fixture
async def ctx():
    mongo = MongoDBClient(db_name=f"diamond_audit_route_validation_{uuid.uuid4().hex[:8]}")
    app = FastAPI()
    app.include_router(validation.router)
    app.dependency_overrides[get_mongo_client] = lambda: mongo
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client, mongo
    finally:
        await mongo.client.drop_database(mongo.db_name)
        await mongo.close()


async def test_run_endpoint_rejects_outside_path(ctx, tmp_path):
    client, _ = ctx
    secret = tmp_path / "secret.vcf"
    secret.write_text("secret")
    resp = await client.post("/api/validation/run", json={"vcf_filename": str(secret)})
    assert resp.status_code == 404
    resp = await client.post("/api/validation/run", json={"vcf_filename": "../../../etc/passwd"})
    assert resp.status_code == 404


async def test_stream_rejects_outside_path(ctx, tmp_path):
    client, _ = ctx
    secret = tmp_path / "secret.vcf"
    secret.write_text("secret")
    resp = await client.get("/api/validation/new-id/stream", params={"vcf_filename": str(secret)})
    assert resp.status_code == 404


async def test_stream_refuses_to_overwrite_recorded_run(ctx):
    client, mongo = ctx
    await mongo.db.runs.insert_one({"run_id": "recorded-run", "marker": "original"})
    resp = await client.get("/api/validation/recorded-run/stream", params={"vcf_filename": "valid_snvs.vcf"})
    assert resp.status_code == 409
    doc = await mongo.db.runs.find_one({"run_id": "recorded-run"}, {"_id": 0})
    assert doc == {"run_id": "recorded-run", "marker": "original"}
    assert await mongo.db.evidence_receipts.count_documents({"run_id": "recorded-run"}) == 0


async def test_stream_refuses_run_id_with_recorded_receipt(ctx):
    client, mongo = ctx
    await mongo.db.evidence_receipts.insert_one({"run_id": "receipt-run", "receipt_id": "r1", "marker": "original"})
    resp = await client.get("/api/validation/receipt-run/stream", params={"vcf_filename": "valid_snvs.vcf"})
    assert resp.status_code == 409
    assert await mongo.db.evidence_receipts.count_documents({"run_id": "receipt-run"}) == 1
    assert await mongo.db.runs.count_documents({"run_id": "receipt-run"}) == 0


async def test_stream_new_run_id_runs_and_persists(ctx):
    client, mongo = ctx
    resp = await client.get("/api/validation/fresh-run/stream", params={"vcf_filename": "valid_snvs.vcf"})
    assert resp.status_code == 200
    assert "EVIDENCE_COMMITTED" in resp.text
    assert (await mongo.db.runs.find_one({"run_id": "fresh-run"}))["status"] == "PASS"
    again = await client.get("/api/validation/fresh-run/stream", params={"vcf_filename": "valid_snvs.vcf"})
    assert again.status_code == 409


async def test_get_endpoints_404_and_no_object_id(ctx):
    client, mongo = ctx
    assert (await client.get("/api/validation/nope")).status_code == 404
    assert (await client.get("/api/validation/nope/evidence")).status_code == 404
    await mongo.db.runs.insert_one({"run_id": "r-1", "status": "PASS"})
    await mongo.db.evidence_receipts.insert_one({"run_id": "r-0", "receipt_id": "rc-1", "x": 1})
    assert (await client.get("/api/validation/r-1")).json() == {"run_id": "r-1", "status": "PASS"}
    by_receipt = await client.get("/api/validation/rc-1/evidence")
    assert by_receipt.status_code == 200 and "_id" not in by_receipt.json()
