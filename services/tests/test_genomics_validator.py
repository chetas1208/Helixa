from pathlib import Path

from services.runtime.genomics import (
    CheckStatus,
    DeterministicGenomicsValidator,
    ValidationPolicy,
    compute_sha256,
)

FIXTURES_DIR = Path("fixtures")
FASTA_PATH = FIXTURES_DIR / "references" / "ref_synthetic_chr22.fasta"

def test_valid_snvs_passes():
    vcf_path = FIXTURES_DIR / "valid" / "valid_snvs.vcf"
    validator = DeterministicGenomicsValidator(policy=ValidationPolicy())
    report = validator.validate(vcf_path, FASTA_PATH)

    assert report.overall_status == CheckStatus.PASS
    assert report.total_records == 2
    assert any(f.check_id == "reference_ref_allele_match" and f.status == CheckStatus.PASS for f in report.findings)

def test_multiallelic_snvs_passes():
    vcf_path = FIXTURES_DIR / "valid" / "multiallelic_snvs.vcf"
    validator = DeterministicGenomicsValidator(policy=ValidationPolicy())
    report = validator.validate(vcf_path, FASTA_PATH)

    assert report.overall_status == CheckStatus.PASS
    assert report.total_records == 1
    assert any(f.check_id == "multiallelic_site_check" for f in report.findings)

def test_normalization_indel_passes():
    vcf_path = FIXTURES_DIR / "valid" / "normalization_indel.vcf"
    validator = DeterministicGenomicsValidator(policy=ValidationPolicy())
    report = validator.validate(vcf_path, FASTA_PATH)

    assert report.overall_status == CheckStatus.PASS
    assert report.total_records == 1
    assert any(f.check_id == "indel_normalization_check" for f in report.findings)

def test_ref_mismatch_incident_detected():
    vcf_path = FIXTURES_DIR / "invalid" / "ref_mismatch.vcf"
    validator = DeterministicGenomicsValidator(policy=ValidationPolicy())
    report = validator.validate(vcf_path, FASTA_PATH)

    assert report.overall_status == CheckStatus.FAIL
    mismatch_findings = [f for f in report.findings if f.check_id == "reference_ref_allele_match" and f.status == CheckStatus.FAIL]
    assert len(mismatch_findings) == 1
    assert mismatch_findings[0].locus.pos == 105002
    assert mismatch_findings[0].metadata["declared_ref"] == "G"
    assert mismatch_findings[0].metadata["fasta_ref"] == "T"

def test_deficient_baseline_harness_misses_ref_mismatch():
    """
    Demonstrates that a baseline policy with require_reference_allele_check=False
    omits the reference verification, illustrating the harness-level gap.
    """
    vcf_path = FIXTURES_DIR / "invalid" / "ref_mismatch.vcf"
    deficient_policy = ValidationPolicy(require_reference_allele_check=False)
    validator = DeterministicGenomicsValidator(policy=deficient_policy)
    report = validator.validate(vcf_path, FASTA_PATH)

    # In deficient policy, ref mismatch is NOT checked, so overall passes or has no ref failure
    assert not any(f.check_id == "reference_ref_allele_match" for f in report.findings)
    assert report.overall_status == CheckStatus.PASS

def test_absent_assembly_emits_warning():
    vcf_path = FIXTURES_DIR / "invalid" / "absent_assembly.vcf"
    validator = DeterministicGenomicsValidator(policy=ValidationPolicy())
    report = validator.validate(vcf_path, FASTA_PATH)

    assert report.overall_status == CheckStatus.WARNING
    assert any(f.check_id == "declared_assembly_check" and f.status == CheckStatus.WARNING for f in report.findings)

def test_unsupported_contig_fails():
    vcf_path = FIXTURES_DIR / "invalid" / "unsupported_contig.vcf"
    validator = DeterministicGenomicsValidator(policy=ValidationPolicy())
    report = validator.validate(vcf_path, FASTA_PATH)

    assert report.overall_status == CheckStatus.FAIL
    assert any(f.check_id == "contig_compatibility_check" and f.status == CheckStatus.FAIL for f in report.findings)

def test_malformed_record_emits_error():
    vcf_path = FIXTURES_DIR / "invalid" / "malformed_record.vcf"
    validator = DeterministicGenomicsValidator(policy=ValidationPolicy())
    report = validator.validate(vcf_path, FASTA_PATH)

    assert report.overall_status == CheckStatus.ERROR
    assert any(f.check_id == "vcf_syntax_check" and f.status == CheckStatus.ERROR for f in report.findings)

def test_length_mismatch_fails():
    vcf_path = FIXTURES_DIR / "invalid" / "length_mismatch.vcf"
    validator = DeterministicGenomicsValidator(policy=ValidationPolicy())
    report = validator.validate(vcf_path, FASTA_PATH)

    assert report.overall_status == CheckStatus.FAIL
    assert any(f.check_id == "contig_length_boundary_check" and f.status == CheckStatus.FAIL for f in report.findings)

def test_heldout_transfer_case_detected():
    vcf_path = FIXTURES_DIR / "heldout" / "unseen_mismatch.vcf"
    validator = DeterministicGenomicsValidator(policy=ValidationPolicy())
    report = validator.validate(vcf_path, FASTA_PATH)

    assert report.overall_status == CheckStatus.FAIL
    mismatch_findings = [f for f in report.findings if f.check_id == "reference_ref_allele_match" and f.status == CheckStatus.FAIL]
    assert len(mismatch_findings) == 1
    assert mismatch_findings[0].locus.pos == 110000

def test_sha256_reproducibility():
    hash1 = compute_sha256(FASTA_PATH)
    hash2 = compute_sha256(FASTA_PATH)
    assert hash1 == hash2
    assert len(hash1) == 64
