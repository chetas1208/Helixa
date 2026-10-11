from __future__ import annotations

import gzip
import hashlib
import io
import threading
from datetime import datetime
from pathlib import Path

import pytest

from services.runtime.genomics import ingestion as ingestion_mod
from services.runtime.genomics.ingestion import (
    FileIngestionService,
    IngestionLimitExceeded,
    InvalidGenomicFileError,
)

VCF = (
    b"##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\n"
    b"chr22\t10001\trs1\tA\tG\t50\tPASS\t.\n"
)
REPO_ROOT = Path(__file__).resolve().parents[2]


def _service(tmp_path, **kw):
    return FileIngestionService(cas_root=tmp_path / "cas", **kw)


def test_truncated_gzip_is_invalid_genomic_file(tmp_path):
    svc = _service(tmp_path)
    blob = gzip.compress(VCF * 200)
    with pytest.raises(InvalidGenomicFileError):
        svc.stream_and_persist(io.BytesIO(blob[: len(blob) // 2]), "t.vcf.gz")
    assert list(svc.tmp_dir.iterdir()) == []
    assert [p for p in svc.cas_root.iterdir() if p.is_file()] == []


def test_gzip_magic_with_garbage_body_is_invalid_genomic_file(tmp_path):
    svc = _service(tmp_path)
    with pytest.raises(InvalidGenomicFileError):
        svc.stream_and_persist(io.BytesIO(b"\x1f\x8b" + b"not really gzip data" * 10), "g.vcf.gz")
    assert list(svc.tmp_dir.iterdir()) == []


def test_repo_truncated_fixture_is_invalid_genomic_file(tmp_path):
    svc = _service(tmp_path)
    fixture = REPO_ROOT / "fixtures" / "invalid" / "truncated.vcf.gz"
    with fixture.open("rb") as fh, pytest.raises(InvalidGenomicFileError):
        svc.stream_and_persist(fh, "truncated.vcf.gz")


def test_gzip_of_non_genomic_content_is_rejected(tmp_path):
    svc = _service(tmp_path)
    blob = gzip.compress(b"INVALID RAW DATA NOT VCF OR FASTA\n" * 20)
    with pytest.raises(InvalidGenomicFileError):
        svc.stream_and_persist(io.BytesIO(blob), "bad.vcf.gz")
    assert [p for p in svc.cas_root.iterdir() if p.is_file()] == []


def test_valid_gzip_vcf_still_ingests(tmp_path):
    svc = _service(tmp_path)
    blob = gzip.compress(VCF)
    art, manifest = svc.stream_and_persist(io.BytesIO(blob), "ok.vcf.gz")
    assert art.file_format == "vcf.gz" and art.is_compressed
    assert art.artifact_sha256 == hashlib.sha256(blob).hexdigest()
    assert Path(art.storage_path).read_bytes() == blob
    assert manifest.artifact_sha256 == art.artifact_sha256


def test_gzip_bomb_still_raises_limit_exceeded(tmp_path):
    svc = _service(tmp_path, max_decompressed_mb=1)
    blob = gzip.compress(VCF + b"#" * (3 * 1024 * 1024))
    with pytest.raises(IngestionLimitExceeded):
        svc.stream_and_persist(io.BytesIO(blob), "bomb.vcf.gz")
    assert list(svc.tmp_dir.iterdir()) == []


def test_concurrent_uploads_with_identical_clock_do_not_share_tmp_file(tmp_path, monkeypatch):
    class FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 1, 1, 0, 0, 0, tzinfo=tz)

    monkeypatch.setattr(ingestion_mod, "datetime", FrozenDatetime)
    svc = _service(tmp_path)

    first_chunk_read = threading.Event()
    release = threading.Event()
    body_a = VCF + b"chr22\t10002\trs2\tC\tT\t50\tPASS\t.\n" * 50

    class BlockingStream:
        def __init__(self, data):
            self._parts = [data[:100], data[100:]]
            self._i = 0

        def read(self, n=-1):
            if self._i == 1:
                first_chunk_read.set()
                assert release.wait(timeout=10)
            if self._i >= len(self._parts):
                return b""
            part = self._parts[self._i]
            self._i += 1
            return part

    results = {}
    errors = {}

    def run_a():
        try:
            results["a"] = svc.stream_and_persist(BlockingStream(body_a), "a.vcf")
        except Exception as exc:  # noqa: BLE001
            errors["a"] = exc

    thread = threading.Thread(target=run_a)
    thread.start()
    assert first_chunk_read.wait(timeout=10)
    body_b = VCF + b"chr22\t20001\trs9\tG\tA\t50\tPASS\t.\n"
    art_b, _ = svc.stream_and_persist(io.BytesIO(body_b), "b.vcf")
    release.set()
    thread.join(timeout=10)

    stored_b = Path(art_b.storage_path).read_bytes()
    assert stored_b == body_b
    assert hashlib.sha256(stored_b).hexdigest() == art_b.artifact_sha256
    if "a" in results:
        art_a = results["a"][0]
        assert hashlib.sha256(Path(art_a.storage_path).read_bytes()).hexdigest() == art_a.artifact_sha256
    assert list(svc.tmp_dir.iterdir()) == []


@pytest.mark.parametrize(
    "name", ["", "../x.vcf", "a/b.vcf", "a\\b.vcf", "a\x00.vcf", "  ", "..", None]
)
def test_sanitize_filename_rejects_unsafe(name):
    with pytest.raises(ValueError):
        FileIngestionService.sanitize_filename(name)


def test_sanitize_filename_accepts_plain_names():
    assert FileIngestionService.sanitize_filename(" sample-1.vcf.gz ") == "sample-1.vcf.gz"


def test_empty_upload_rejected_and_cleaned(tmp_path):
    svc = _service(tmp_path)
    with pytest.raises(InvalidGenomicFileError):
        svc.stream_and_persist(io.BytesIO(b""), "empty.vcf")
    assert list(svc.tmp_dir.iterdir()) == []


def test_exact_limit_accepted_one_over_rejected(tmp_path):
    svc = FileIngestionService(cas_root=tmp_path / "cas", max_upload_mb=1)
    svc.max_upload_bytes = len(VCF)
    art, _ = svc.stream_and_persist(io.BytesIO(VCF), "x.vcf")
    assert art.byte_size == len(VCF)
    with pytest.raises(IngestionLimitExceeded):
        svc.stream_and_persist(io.BytesIO(VCF + b"x"), "y.vcf")


def test_fasta_and_dedup_and_short_reads(tmp_path):
    svc = _service(tmp_path)

    class OneByteStream:
        def __init__(self, data):
            self._buf = io.BytesIO(data)

        def read(self, n=-1):
            return self._buf.read(1)

    fasta = b">chr22\nACGTACGT\n"
    art, _ = svc.stream_and_persist(OneByteStream(fasta), "r.fa", dataset_id="my-ds")
    assert art.file_format == "fasta" and art.dataset_id == "my-ds"
    art2, _ = svc.stream_and_persist(io.BytesIO(fasta), "r2.fa")
    assert art2.storage_path == art.storage_path
    assert art2.artifact_sha256 == hashlib.sha256(fasta).hexdigest()
