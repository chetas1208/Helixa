from __future__ import annotations

from pathlib import Path

from services.runtime.genomics.contracts import CheckStatus
from services.runtime.genomics.oracle import IndependentGenomicsOracle
from services.runtime.genomics.validator import DeterministicGenomicsValidator

REPO_ROOT = Path(__file__).resolve().parents[2]


class _MisattributingValidator:
    """Delegates to the real validator but reports the expected check as PASS for one fixture,
    as if the overall FAIL had been caused by some other check."""

    def __init__(self, fixture_name: str, check_id: str):
        self._inner = DeterministicGenomicsValidator()
        self._fixture_name = fixture_name
        self._check_id = check_id

    def validate(self, vcf_path, fasta_path=None, *args, **kwargs):
        report = self._inner.validate(vcf_path, fasta_path, *args, **kwargs)
        if Path(vcf_path).name != self._fixture_name:
            return report
        findings = [
            f.model_copy(update={"status": CheckStatus.PASS}) if f.check_id == self._check_id else f
            for f in report.findings
        ]
        return report.model_copy(update={"findings": findings})


def test_summary_digest_is_deterministic_across_evaluations():
    oracle = IndependentGenomicsOracle(base_dir=REPO_ROOT)
    validator = DeterministicGenomicsValidator()

    first = oracle.evaluate(validator)
    second = oracle.evaluate(validator)

    assert first.score_percentage == second.score_percentage == 100.0
    assert first.summary_digest == second.summary_digest


def test_expected_check_must_carry_the_expected_status():
    oracle = IndependentGenomicsOracle(base_dir=REPO_ROOT)
    validator = _MisattributingValidator("ref_mismatch.vcf", "reference_ref_allele_match")

    report = oracle.evaluate(validator)

    by_id = {r.test_id: r for r in report.case_results}
    assert by_id["ref_mismatch_incident_oracle"].passed is False
    assert by_id["valid_snvs_oracle"].passed is True


def test_oracle_baseline_still_scores_full_marks():
    oracle = IndependentGenomicsOracle(base_dir=REPO_ROOT)
    report = oracle.evaluate(DeterministicGenomicsValidator())

    assert report.score_percentage == 100.0
    assert report.total_cases == 13
