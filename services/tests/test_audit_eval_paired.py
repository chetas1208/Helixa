from pathlib import Path

import pytest

from services.integrations.ebi_vcf.validator import EbiValidationReport, EbiVcfValidator
from services.runtime.evaluation.paired_scientific_eval import PairedScientificEvaluator

ROOT = Path(__file__).resolve().parents[2]
FASTA = ROOT / "fixtures/references/ref_synthetic_chr22.fasta"
VALID_VCF = ROOT / "fixtures/valid/valid_snvs.vcf"


class _AssemblyUnchecked(EbiVcfValidator):
    """EBI stand-in that passes syntax but never ran the assembly (REF) checker."""

    def validate(self, vcf_path, fasta_path=None, validation_level="warning"):
        return EbiValidationReport(
            is_valid=True,
            overall_status="PASS",
            syntax_valid=True,
            assembly_valid=None,
        )


@pytest.mark.parametrize("fasta", [lambda tmp: tmp / "absent.fasta", lambda tmp: ""])
def test_unusable_fasta_path_cannot_yield_agree_pass(tmp_path: Path, fasta):
    report = PairedScientificEvaluator().adjudicate(VALID_VCF, fasta(tmp_path))
    assert report.verdict.value == "INCONCLUSIVE"
    assert report.reference_sha256 is None


def test_directory_vcf_is_tool_error_not_exception(tmp_path: Path):
    report = PairedScientificEvaluator().adjudicate(tmp_path, None)
    assert report.verdict.value == "TOOL_ERROR"
    assert report.requires_quarantine is True
    assert report.incident is not None
    assert report.incident.status == "QUARANTINED"


def test_agree_pass_requires_ebi_assembly_confirmation():
    evaluator = PairedScientificEvaluator(ebi_validator=_AssemblyUnchecked())
    report = evaluator.adjudicate(VALID_VCF, FASTA)
    assert report.native_status == "PASS"
    assert report.ebi_status == "PASS"
    assert report.verdict.value == "INCONCLUSIVE"
    assert report.is_concordant is False


def test_supplied_fasta_with_assembly_confirmation_still_agrees_pass():
    report = PairedScientificEvaluator().adjudicate(VALID_VCF, FASTA)
    assert report.verdict.value == "AGREE_PASS"
    assert report.reference_sha256 is not None
    assert report.incident is None


def test_missing_vcf_is_quarantined_tool_error(tmp_path: Path):
    report = PairedScientificEvaluator().adjudicate(tmp_path / "gone.vcf", FASTA, run_id="r-1")
    assert report.verdict.value == "TOOL_ERROR"
    assert report.dataset_sha256 == "MISSING"
    assert report.incident is not None and report.incident.run_id == "r-1"


def test_both_engines_failing_the_same_contig_case_agree():
    heldout = ROOT / "fixtures/heldout/heldout_contig_mismatch.vcf"
    report = PairedScientificEvaluator().adjudicate(heldout, FASTA)
    assert report.verdict.value == "AGREE_FAIL"
    assert report.diverging_checks == []
    assert report.is_concordant is True
