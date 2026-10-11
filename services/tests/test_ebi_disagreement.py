from pathlib import Path

from services.runtime.evaluation.paired_scientific_eval import PairedScientificEvaluator
from services.runtime.genomics.contracts import ValidationPolicy
from services.runtime.genomics.validator import DeterministicGenomicsValidator

ROOT = Path(__file__).resolve().parents[2]
FASTA = ROOT / "fixtures/references/ref_synthetic_chr22.fasta"


def test_valid_snv_tools_agree_pass_without_claiming_build_identity():
    report = PairedScientificEvaluator().adjudicate(ROOT / "fixtures/valid/valid_snvs.vcf", FASTA)
    assert report.verdict.value == "AGREE_PASS"
    assert report.ebi_report["assembly_valid"] is True


def test_ref_mismatch_is_agree_fail():
    vcf = ROOT / "fixtures/invalid/ref_mismatch.vcf"
    before = vcf.read_bytes()
    report = PairedScientificEvaluator().adjudicate(vcf, FASTA)
    assert vcf.read_bytes() == before
    assert report.verdict.value == "AGREE_FAIL"
    mismatches = [item for item in report.ebi_report["checks"] if item["check_id"] == "reference_allele_mismatch"]
    assert mismatches
    assert "105002" in mismatches[0]["message"]


def test_missing_fasta_is_inconclusive():
    report = PairedScientificEvaluator().adjudicate(ROOT / "fixtures/valid/valid_snvs.vcf", None)
    assert report.verdict.value == "INCONCLUSIVE"


def test_invalid_syntax_is_not_forced_to_pass(tmp_path: Path):
    bad = tmp_path / "bad_syntax.vcf"
    bad.write_text("not a vcf\nchr1\tfoo\n")
    report = PairedScientificEvaluator().adjudicate(bad, None)
    assert report.verdict.value != "AGREE_PASS"
    assert report.ebi_status == "FAIL"


def test_policy_without_ref_check_disagrees_with_ebi():
    native = DeterministicGenomicsValidator(
        policy=ValidationPolicy(
            require_reference_allele_check=False,
            require_contig_compatibility=True,
            require_normalization_check=True,
            require_assembly_declaration=True,
        )
    )
    report = PairedScientificEvaluator(native_validator=native).adjudicate(
        ROOT / "fixtures/invalid/ref_mismatch.vcf",
        FASTA,
    )
    assert report.verdict.value == "DISAGREE"
    assert report.diverging_checks
