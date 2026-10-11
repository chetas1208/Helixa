from __future__ import annotations

import json
from pathlib import Path

from services.runtime.genomics.contracts import CheckStatus
from services.runtime.genomics.validator import DeterministicGenomicsValidator, ValidationPolicy


def test_v7_manifest_partition_disjointness():
    manifests_dir = Path("fixtures/v7/manifests").resolve()
    dev_cases = {c["case_id"] for c in json.loads((manifests_dir / "dev_manifest.json").read_text())}
    reg_cases = {c["case_id"] for c in json.loads((manifests_dir / "regression_manifest.json").read_text())}
    holdout_cases = {c["case_id"] for c in json.loads((manifests_dir / "sealed_holdout_manifest.json").read_text())}

    # Verify disjointness
    assert dev_cases.isdisjoint(reg_cases), "Data leakage between dev and regression sets!"
    assert dev_cases.isdisjoint(holdout_cases), "Data leakage between dev and holdout sets!"
    assert reg_cases.isdisjoint(holdout_cases), "Data leakage between regression and holdout sets!"

    all_cases = dev_cases | reg_cases | holdout_cases
    assert len(all_cases) == 16, f"Expected 16 distinct cases, found {len(all_cases)}"


def test_v7_genomics_validator_scenarios():
    cases_dir = Path("fixtures/v7/cases").resolve()
    ref_fasta = Path("fixtures/references/ref_synthetic_chr22.fasta").resolve()

    validator = DeterministicGenomicsValidator(
        policy=ValidationPolicy(
            require_reference_allele_check=True,
            require_contig_compatibility=True,
            require_assembly_declaration=True,
        )
    )

    # 1. Correct SNV -> PASS
    res1 = validator.validate(cases_dir / "01_correct_snv.vcf", ref_fasta)
    assert res1.overall_status == CheckStatus.PASS
    assert not any(f.status != CheckStatus.PASS for f in res1.findings)

    # 2. REF mismatch -> FAIL
    res2 = validator.validate(cases_dir / "02_ref_mismatch.vcf", ref_fasta)
    assert res2.overall_status == CheckStatus.FAIL
    assert any(f.check_id in ("reference_ref_allele_match", "reference_allele_match") for f in res2.findings)

    # 3. Missing contig (chrX against chr22 FASTA) -> FAIL
    res4 = validator.validate(cases_dir / "04_missing_contig.vcf", ref_fasta)
    assert res4.overall_status == CheckStatus.FAIL
    assert any(f.check_id == "contig_compatibility_check" for f in res4.findings)

    # 4. Prompt injection attempt in header -> Validator must not be tricked into passing
    res14 = validator.validate(cases_dir / "14_untrusted_header_injection.vcf", ref_fasta)
    assert res14.overall_status == CheckStatus.FAIL, "Prompt injection in VCF header breached validation logic!"
    assert any(f.check_id in ("reference_ref_allele_match", "reference_allele_match") for f in res14.findings)
