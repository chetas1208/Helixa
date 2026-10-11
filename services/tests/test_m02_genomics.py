from __future__ import annotations

import io
import tempfile
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from services.api.app.main import app
from services.runtime.genomics import (
    CheckStatus,
    DeterministicGenomicsValidator,
    compute_sha256,
)
from services.runtime.genomics.bcftools_adapter import (
    BcftoolsAdapter,
    UnsafeBcftoolsCommandError,
)
from services.runtime.genomics.ingestion import (
    FileIngestionService,
    IngestionLimitExceeded,
    InvalidGenomicFileError,
)
from services.runtime.genomics.oracle import IndependentGenomicsOracle
from services.runtime.genomics.orchestrator import DeterministicGenomicsOrchestrator

FIXTURES_DIR = Path("fixtures")
FASTA_PATH = FIXTURES_DIR / "references" / "ref_synthetic_chr22.fasta"


def test_pysam_coordinate_conversion_and_bounds():
    """Verify 1-based VCF to 0-based FASTA indexing conversion and bounds enforcement."""
    validator = DeterministicGenomicsValidator()
    report = validator.validate(FIXTURES_DIR / "valid" / "valid_snvs.vcf", FASTA_PATH)
    assert report.overall_status == CheckStatus.PASS
    assert report.total_records == 2

    # Check bounds rejection on invalid pos
    report_bounds = validator.validate(FIXTURES_DIR / "invalid" / "invalid_pos_bounds.vcf", FASTA_PATH)
    assert report_bounds.overall_status == CheckStatus.FAIL
    assert any(f.check_id == "contig_length_boundary_check" for f in report_bounds.findings)


def test_content_addressed_storage_ingestion():
    """Verify streaming SHA-256 computation, atomic persistence in CAS, and limits."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        ingestion = FileIngestionService(cas_root=tmp_dir, max_upload_mb=1)

        sample_vcf = b"##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\nchr22\t10001\trs1\tA\tG\t50\tPASS\t.\n"
        stream = io.BytesIO(sample_vcf)

        art, manifest = ingestion.stream_and_persist(stream, "sample.vcf")
        assert art.file_format == "vcf"
        assert not art.is_compressed
        assert Path(art.storage_path).exists()
        assert compute_sha256(art.storage_path) == art.artifact_sha256
        assert manifest.dataset_id.startswith("ds-")

        # Test limit enforcement
        large_stream = io.BytesIO(b"A" * (2 * 1024 * 1024))
        with pytest.raises(IngestionLimitExceeded):
            ingestion.stream_and_persist(large_stream, "oversize.vcf")

        # Test format rejection
        bad_stream = io.BytesIO(b"INVALID RAW DATA NOT VCF OR FASTA")
        with pytest.raises(InvalidGenomicFileError):
            ingestion.stream_and_persist(bad_stream, "bad.txt")


def test_bcftools_adapter_safety_and_checkref():
    """Verify allowlist enforcement, prohibition of '--check-ref s', and read-only execution."""
    adapter = BcftoolsAdapter()

    # Reject forbidden silent mutation flag
    with pytest.raises(UnsafeBcftoolsCommandError):
        adapter._execute("norm", ["--check-ref", "s"], [])

    # Reject unauthorized subcommand
    with pytest.raises(UnsafeBcftoolsCommandError):
        adapter._execute("reheader", [], [])

    # Execute read-only reference check
    valid_vcf = FIXTURES_DIR / "valid" / "valid_snvs.vcf"
    receipt = adapter.check_ref(valid_vcf, FASTA_PATH)
    assert receipt.exit_code == 0
    assert len(receipt.argv) > 0
    assert "--check-ref" in receipt.argv


def test_non_destructive_normalization_preserves_source_bytes():
    """Verify that normalization produces a separate derived artifact while keeping original byte-identical."""
    adapter = BcftoolsAdapter()
    indel_vcf = FIXTURES_DIR / "valid" / "normalization_indel.vcf"

    pre_sha = compute_sha256(indel_vcf)

    with tempfile.TemporaryDirectory() as tmp_dir:
        out_vcf = Path(tmp_dir) / "derived_norm.vcf"
        receipt, derived_record = adapter.normalize(indel_vcf, FASTA_PATH, out_vcf)

        post_sha = compute_sha256(indel_vcf)
        assert pre_sha == post_sha, "Original VCF must remain strictly byte-identical!"
        assert derived_record.is_derived is True
        assert derived_record.parent_artifact_sha256 == pre_sha
        assert out_vcf.exists()
        assert compute_sha256(out_vcf) == derived_record.artifact_sha256


def test_scientific_truth_invariants_and_ambiguous_assembly():
    """Verify that missing declared assembly emits WARNING or INCONCLUSIVE, not unproven PASS."""
    validator = DeterministicGenomicsValidator()
    report = validator.validate(FIXTURES_DIR / "invalid" / "ambiguous_assembly.vcf", FASTA_PATH)

    assert report.overall_status in (CheckStatus.WARNING, CheckStatus.INCONCLUSIVE)
    assert any(f.check_id == "declared_assembly_check" for f in report.findings)


def test_symbolic_and_structural_variants_classification():
    """Verify symbolic SVs (<DEL>, breakends) are classified as INCONCLUSIVE without crashing."""
    validator = DeterministicGenomicsValidator()
    report = validator.validate(FIXTURES_DIR / "invalid" / "symbolic_structural.vcf", FASTA_PATH)

    assert any(f.check_id == "symbolic_allele_check" and f.status == CheckStatus.INCONCLUSIVE for f in report.findings)


def test_independent_oracle_full_suite_and_metamorphic():
    """Verify oracle evaluation suite achieves 100% score and all metamorphic properties hold."""
    oracle = IndependentGenomicsOracle()
    validator = DeterministicGenomicsValidator()

    eval_report = oracle.evaluate(validator)
    assert eval_report.score_percentage == 100.0
    assert eval_report.passed_cases == eval_report.total_cases
    assert len(eval_report.metamorphic_results) == 3
    assert all(m.satisfied for m in eval_report.metamorphic_results)


@pytest.mark.asyncio
async def test_deterministic_pipeline_orchestrator_phases():
    """Verify 7-phase execution and cryptographic evidence receipt creation."""
    orchestrator = DeterministicGenomicsOrchestrator()
    vcf_path = FIXTURES_DIR / "valid" / "valid_snvs.vcf"

    run, receipt = await orchestrator.execute_pipeline(vcf_path, FASTA_PATH)
    assert run.status == CheckStatus.PASS
    assert receipt.overall_status == CheckStatus.PASS
    assert len(receipt.receipt_digest) == 64
    assert receipt.tool_chain["pysam"] == "0.24.1"
    assert receipt.tool_chain["bcftools"] == "1.24"


@pytest.mark.asyncio
async def test_api_validation_endpoints():
    """Verify /api/validation/run, /api/validation/{id}, and /api/datasets/upload via ASGI client."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Dataset upload
        sample_vcf = b"##fileformat=VCFv4.2\n##reference=GRCh38\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\nchr22\t10001\trs1\tA\tG\t50\tPASS\t.\n"
        upload_resp = await client.post(
            "/api/datasets/upload",
            files={"file": ("test_upload.vcf", io.BytesIO(sample_vcf), "text/plain")},
        )
        assert upload_resp.status_code == 200
        upload_data = upload_resp.json()
        assert upload_data["status"] == "INGESTED"
        assert "artifact_sha256" in upload_data["artifact"]

        # 2. Run validation
        val_resp = await client.post(
            "/api/validation/run",
            json={
                "dataset_id": "test_ds",
                "vcf_filename": "valid_snvs.vcf",
                "fasta_filename": "ref_synthetic_chr22.fasta",
            },
        )
        assert val_resp.status_code == 200
        val_data = val_resp.json()
        assert val_data["status"] == "PASS"
        assert "evidence_digest" in val_data
        run_id = val_data["run_id"]

        # 3. Retrieve validation run
        get_resp = await client.get(f"/api/validation/{run_id}")
        assert get_resp.status_code == 200
        assert get_resp.json()["run_id"] == run_id

        # 4. Retrieve evidence receipt
        ev_resp = await client.get(f"/api/validation/{run_id}/evidence")
        assert ev_resp.status_code == 200
        assert ev_resp.json()["run_id"] == run_id
