from __future__ import annotations

import gzip
import uuid

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from services.api.app.dependencies import get_dataset_repo, get_mongo_client
from services.api.app.routes import datasets as datasets_route
from services.integrations.mongodb import DatasetModel, DatasetRepository, MongoDBClient
from services.runtime.genomics.ingestion import FileIngestionService

VCF_NO_ASSEMBLY = (
    b"##fileformat=VCFv4.2\n"
    b"#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\n"
    b"chr22\t10001\trs1\tA\tG\t50\tPASS\t.\n"
)
VCF_GRCH37 = VCF_NO_ASSEMBLY.replace(b"VCFv4.2\n", b"VCFv4.2\n##reference=GRCh37\n")


@pytest_asyncio.fixture
async def ctx(tmp_path, monkeypatch):
    db_name = f"diamond_audit_route_datasets_{uuid.uuid4().hex[:10]}"
    mongo = MongoDBClient(db_name=db_name)
    cas_root = tmp_path / "cas"

    def make_service() -> FileIngestionService:
        return FileIngestionService(cas_root=cas_root, max_upload_mb=1)

    monkeypatch.setattr(datasets_route, "FileIngestionService", make_service)
    app = FastAPI()
    app.include_router(datasets_route.router)
    app.dependency_overrides[get_mongo_client] = lambda: mongo
    app.dependency_overrides[get_dataset_repo] = lambda: DatasetRepository(mongo=mongo)
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield client, mongo, cas_root
    finally:
        await mongo.client.drop_database(db_name)
        await mongo.client.close()


async def _upload(client, name, body):
    return await client.post("/api/datasets/upload", files={"file": (name, body, "application/octet-stream")})


@pytest.mark.asyncio
async def test_upload_roundtrip_and_get(ctx):
    client, _, cas_root = ctx
    resp = await _upload(client, "ok.vcf", VCF_NO_ASSEMBLY)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "INGESTED"
    sha = body["artifact"]["artifact_sha256"]
    assert (cas_root / f"{sha}.vcf").read_bytes() == VCF_NO_ASSEMBLY
    got = await client.get(f"/api/datasets/{body['dataset_id']}")
    assert got.status_code == 200
    assert "_id" not in got.json()
    listing = await client.get("/api/datasets")
    assert body["dataset_id"] in [d["dataset_id"] for d in listing.json()["datasets"]]


@pytest.mark.asyncio
async def test_get_unknown_dataset_is_404(ctx, monkeypatch):
    client, _, _ = ctx
    monkeypatch.chdir("/")
    resp = await client.get("/api/datasets/does-not-exist-xyz")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_list_reports_fixtures_count(ctx):
    client, mongo, _ = ctx
    await DatasetRepository(mongo=mongo).upsert_dataset(
        DatasetModel(dataset_id="ds-list", fixtures={"a": "x", "b": "y"})
    )
    listing = (await client.get("/api/datasets")).json()["datasets"]
    assert [d for d in listing if d["dataset_id"] == "ds-list"][0]["fixtures_count"] == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("name", ["../evil.vcf", "a/b.vcf", "a\\b.vcf", "x..vcf"])
async def test_upload_rejects_unsafe_filenames(ctx, name):
    client, _, cas_root = ctx
    resp = await _upload(client, name, VCF_NO_ASSEMBLY)
    assert resp.status_code == 400
    assert not list(cas_root.glob("*.vcf"))


@pytest.mark.asyncio
async def test_upload_unknown_format_is_400(ctx):
    client, _, cas_root = ctx
    resp = await _upload(client, "x.txt", b"hello world\n")
    assert resp.status_code == 400
    assert not list((cas_root / "tmp").glob("*"))


@pytest.mark.asyncio
async def test_upload_over_limit_is_413_and_cleans_tmp(ctx):
    client, _, cas_root = ctx
    resp = await _upload(client, "big.vcf", b"##fileformat=VCFv4.2\n" + b"#" * (1024 * 1024 + 1))
    assert resp.status_code == 413
    assert not list((cas_root / "tmp").glob("*"))


@pytest.mark.asyncio
async def test_upload_gzip_bomb_is_413(ctx, tmp_path):
    client, _, _ = ctx
    payload = gzip.compress(b"A" * (101 * 1024 * 1024), compresslevel=9)
    assert len(payload) < 1024 * 1024
    resp = await _upload(client, "bomb.vcf.gz", payload)
    assert resp.status_code == 413


@pytest.mark.asyncio
async def test_undeclared_assembly_is_not_fabricated_as_grch38(ctx):
    """ADR-006: missing assembly metadata must not be recorded as a GRCh38 declaration."""
    client, mongo, _ = ctx
    resp = await _upload(client, "noasm.vcf", VCF_NO_ASSEMBLY)
    assert resp.status_code == 200
    ds_id = resp.json()["dataset_id"]
    stored = await mongo.db.datasets.find_one({"dataset_id": ds_id}, {"_id": 0})
    assert stored["declared_assembly"] != "GRCh38"
    assert (await client.get(f"/api/datasets/{ds_id}")).json()["declared_assembly"] != "GRCh38"


@pytest.mark.asyncio
async def test_upload_corrupt_gzip_is_client_error_not_500(ctx):
    client, _, cas_root = ctx
    resp = await _upload(client, "bad.vcf.gz", b"\x1f\x8b" + b"not a real gzip stream" * 4)
    assert resp.status_code == 400
    assert not list((cas_root / "tmp").glob("*"))


@pytest.mark.asyncio
async def test_upload_truncated_gzip_is_client_error_not_500(ctx):
    client, _, _ = ctx
    full = gzip.compress(VCF_GRCH37 * 50)
    resp = await _upload(client, "trunc.vcf.gz", full[: len(full) // 2])
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_internal_error_detail_does_not_leak_paths(ctx, monkeypatch):
    client, _, _ = ctx
    secret = "/srv/private/diamond/artifacts/cas/tmp/upload_1.tmp"

    def boom(self, stream, original_filename, dataset_id=None):
        raise OSError(28, "No space left on device", secret)

    monkeypatch.setattr(FileIngestionService, "stream_and_persist", boom)
    monkeypatch.setattr(datasets_route, "FileIngestionService", FileIngestionService)
    resp = await _upload(client, "ok.vcf", VCF_NO_ASSEMBLY)
    assert resp.status_code == 500
    assert secret not in resp.text
    assert "/srv/" not in resp.text
