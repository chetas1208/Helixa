from __future__ import annotations

from pathlib import Path

from services.runtime.genomics.validator import ValidationPolicy
from services.runtime.incidents import IncidentInvestigator


def test_incident_investigator_reproduces_failure():
    investigator = IncidentInvestigator()
    fixtures_dir = Path("fixtures").resolve()
    vcf_mismatch = fixtures_dir / "invalid" / "ref_mismatch.vcf"
    fasta_ref = fixtures_dir / "references" / "ref_synthetic_chr22.fasta"

    # Run investigation with reference allele check turned on
    record = investigator.investigate_run_failure(
        run_id="run-incident-test-01",
        vcf_path=vcf_mismatch,
        fasta_path=fasta_ref,
        harness_version_id="harness-v1-baseline",
        policy=ValidationPolicy(require_reference_allele_check=True),
    )

    assert record.incident_id.startswith("inc-")
    assert record.status == "quarantined"
    assert "REF_ALLELE_MISMATCH" in record.error_signature
    assert len(record.source_artifact_sha256) == 64
    assert len(record.reference_sha256) == 64
    assert len(record.causal_chain) >= 3

    # Verify reproducibility bundle is sanitized (no raw sequence body)
    bundle = record.reproducibility_bundle
    assert bundle["sanitized"] is True
    assert bundle["vcf_sha256"] == record.source_artifact_sha256
    assert "raw_data" not in bundle
    assert "sequence" not in bundle


def test_incident_investigator_resolves_clean_run():
    investigator = IncidentInvestigator()
    fixtures_dir = Path("fixtures").resolve()
    vcf_valid = fixtures_dir / "valid" / "valid_snvs.vcf"
    fasta_ref = fixtures_dir / "references" / "ref_synthetic_chr22.fasta"

    record = investigator.investigate_run_failure(
        run_id="run-incident-test-clean",
        vcf_path=vcf_valid,
        fasta_path=fasta_ref,
        harness_version_id="harness-v1-baseline",
    )

    assert record.status == "resolved"
    assert record.error_signature == "NO_ERROR"
