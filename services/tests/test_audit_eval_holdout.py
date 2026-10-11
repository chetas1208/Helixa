import shutil
from pathlib import Path
from types import SimpleNamespace

import pytest

from services.integrations.contracts import AdjudicationVerdict, GenomicIncident
from services.runtime.evaluation.holdout import (
    HoldoutLeakError,
    SealedHoldoutEvaluator,
    assert_proposer_inputs_exclude_holdout,
)
from services.runtime.harness.baseline import create_candidate_mutation, get_baseline_harness

REPO_FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


class _AgreePaired:
    def adjudicate(self, **_kwargs):
        return SimpleNamespace(verdict=AdjudicationVerdict.AGREE_PASS)


def _incident() -> GenomicIncident:
    return GenomicIncident(
        incident_id="audit-holdout-incident",
        run_id="audit-holdout-run",
        dataset_sha256="abc",
        reference_sha256="def",
        failing_check="reference_allele_mismatch",
        error_signature="REF allele does not match",
    )


def _fixtures_copy(tmp_path: Path, omit: tuple[str, ...] = ()) -> Path:
    root = tmp_path / "fixtures"
    for sub in ("valid", "invalid", "heldout", "references"):
        if sub not in omit:
            shutil.copytree(REPO_FIXTURES / sub, root / sub)
    return root


def _evaluate(fixtures_dir: Path, candidate_ref_check: bool = True):
    parent = get_baseline_harness()
    candidate = create_candidate_mutation(parent, enable_ref_check=candidate_ref_check)
    evaluator = SealedHoldoutEvaluator(fixtures_dir=fixtures_dir, paired_evaluator=_AgreePaired())
    return evaluator.evaluate_candidate(parent, candidate, _incident(), run_id="audit-holdout-run")


def _gates(eval_run) -> dict[str, bool]:
    return {gate.gate_id: gate.passed for gate in eval_run.safety_gates}


def test_good_candidate_promoted_on_real_fixtures(tmp_path):
    eval_run, receipt = _evaluate(_fixtures_copy(tmp_path))
    assert eval_run.promoted is True
    assert receipt.decision == "PROMOTED"
    assert eval_run.candidate_score == "2/2"


def test_candidate_score_is_zero_when_nothing_passes(tmp_path):
    eval_run, _receipt = _evaluate(_fixtures_copy(tmp_path), candidate_ref_check=False)
    gates = _gates(eval_run)
    assert gates["incident_addressed"] is False
    assert gates["heldout_transfer_passed"] is False
    assert eval_run.promoted is False
    assert eval_run.candidate_score == "0/2"


def test_missing_heldout_fixtures_do_not_pass_transfer_gate(tmp_path):
    eval_run, receipt = _evaluate(_fixtures_copy(tmp_path, omit=("heldout",)))
    assert _gates(eval_run)["heldout_transfer_passed"] is False
    assert eval_run.promoted is False
    assert receipt.decision == "REJECTED"


def test_missing_negative_controls_do_not_pass_regression_gate(tmp_path):
    root = _fixtures_copy(tmp_path)
    (root / "valid" / "valid_snvs.vcf").unlink()
    (root / "valid" / "benign_header_variant.vcf").unlink()
    eval_run, receipt = _evaluate(root)
    assert _gates(eval_run)["zero_negative_control_regressions"] is False
    assert eval_run.promoted is False
    assert receipt.decision == "REJECTED"


def test_guard_rejects_holdout_ids():
    with pytest.raises(HoldoutLeakError):
        assert_proposer_inputs_exclude_holdout(["heldout_contig_mismatch"], [])


@pytest.mark.parametrize(
    "path",
    [
        "fixtures/heldout/unseen_mismatch.vcf",
        "/abs/repo/fixtures/heldout/heldout_contig_mismatch.vcf",
        "fixtures\\heldout\\unseen_mismatch.vcf",
        "heldout/unseen_mismatch.vcf",
        "./heldout/heldout_contig_mismatch.vcf",
        "fixtures/./heldout/unseen_mismatch.vcf",
        "fixtures//heldout/unseen_mismatch.vcf",
        "fixtures/valid/../heldout/unseen_mismatch.vcf",
    ],
)
def test_guard_rejects_holdout_path_spellings(path):
    with pytest.raises(HoldoutLeakError):
        assert_proposer_inputs_exclude_holdout([], [path])


@pytest.mark.parametrize("ids,paths", [("heldout_contig_mismatch", []), ([], "fixtures/heldout/unseen_mismatch.vcf")])
def test_guard_rejects_bare_string_arguments(ids, paths):
    with pytest.raises(HoldoutLeakError):
        assert_proposer_inputs_exclude_holdout(ids, paths)


def test_guard_allows_unrelated_inputs():
    assert_proposer_inputs_exclude_holdout(
        ["incident_target_ref_mismatch"],
        ["fixtures/invalid/ref_mismatch.vcf", "fixtures/valid/valid_snvs.vcf", "inc-123", "myheldout/unseen_mismatch.vcf"],
    )
    assert_proposer_inputs_exclude_holdout([], [])
