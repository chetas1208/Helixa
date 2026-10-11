from __future__ import annotations

from pathlib import Path

import pytest

from services.runtime.evaluation import IndependentEvaluator
from services.runtime.evaluation import evaluator as evaluator_module
from services.runtime.harness import create_candidate_mutation, get_baseline_harness

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


@pytest.fixture(scope="module")
def evaluator() -> IndependentEvaluator:
    return IndependentEvaluator(fixtures_dir=FIXTURES)


def test_receipt_ids_unique_within_same_second(evaluator, monkeypatch):
    # Receipts are upserted by receipt_id, so a collision overwrites another run's evidence.
    monkeypatch.setattr(evaluator_module.time, "time", lambda: 1_800_000_000.0)
    baseline = get_baseline_harness()
    candidate = create_candidate_mutation(baseline, version_id="harness-v2-candidate")

    _, first = evaluator.evaluate(baseline, candidate, run_id="run-a")
    _, second = evaluator.evaluate(baseline, candidate, run_id="run-b")

    assert first.receipt_id != second.receipt_id
    assert first.receipt_id.startswith("receipt-harness-v2-candidate-")


def test_baseline_to_candidate_promotes(evaluator):
    baseline = get_baseline_harness()
    candidate = create_candidate_mutation(baseline, version_id="harness-v2-candidate")

    result, receipt = evaluator.evaluate(baseline, candidate, run_id="run-promote")

    assert result.promoted is True
    assert (result.score_numerator, result.score_denominator) == (6, 6)
    assert (result.parent_score_numerator, result.parent_score_denominator) == (4, 6)
    assert result.false_positive_rate == 0.0
    assert receipt.promoted is True
    assert receipt.run_id == "run-promote"
    assert len(receipt.input_hashes) == 6
    assert receipt.input_hashes[-1] == evaluator.evaluator_digest


def test_identical_parent_and_candidate_not_promoted(evaluator):
    baseline = get_baseline_harness()

    result, _ = evaluator.evaluate(baseline, baseline, run_id="run-same")

    assert result.promoted is False
    assert result.score_numerator == result.parent_score_numerator


def test_envelope_violation_blocks_promotion(evaluator):
    baseline = get_baseline_harness()
    candidate = create_candidate_mutation(baseline, version_id="harness-tampered")
    candidate.allowed_tools.append("arbitrary_shell_exec")

    result, receipt = evaluator.evaluate(baseline, candidate, run_id="run-envelope")

    assert result.envelope_compliance is False
    assert result.promoted is False
    assert receipt.promoted is False
    assert result.test_results[0].test_id == "policy_envelope_compliance"
    assert result.test_results[0].candidate_passed is False


def test_weakened_candidate_not_promoted_and_flagged_false_negative(evaluator):
    baseline = get_baseline_harness()
    candidate = create_candidate_mutation(baseline, version_id="harness-weak")
    candidate.validation_policy.require_reference_allele_check = False

    result, _ = evaluator.evaluate(baseline, candidate, run_id="run-weak")

    assert result.promoted is False
    by_id = {t.test_id: t for t in result.test_results}
    assert by_id["incident_target_ref_mismatch"].candidate_passed is False
    assert by_id["heldout_transfer_unseen_mismatch"].candidate_passed is False


def test_receipt_binds_spec_hashes(evaluator):
    baseline = get_baseline_harness()
    candidate = create_candidate_mutation(baseline, version_id="harness-v2-candidate")

    _, receipt = evaluator.evaluate(baseline, candidate, run_id="run-digest")

    assert len(receipt.receipt_digest) == 64
    assert receipt.parent_spec_hash == baseline.compute_spec_hash()
    assert receipt.candidate_spec_hash == candidate.compute_spec_hash()


def test_missing_reference_fails_closed(tmp_path):
    with pytest.raises(FileNotFoundError):
        IndependentEvaluator(fixtures_dir=tmp_path)
