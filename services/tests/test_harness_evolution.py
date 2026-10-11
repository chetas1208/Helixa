from services.runtime.evaluation import IndependentEvaluator
from services.runtime.harness import (
    PolicyEnvelope,
    create_candidate_mutation,
    get_baseline_harness,
)


def test_baseline_harness_structure():
    baseline = get_baseline_harness()
    assert baseline.version_id == "harness-v1"
    assert baseline.validation_policy.require_reference_allele_check is False
    hash_val = baseline.compute_spec_hash()
    assert len(hash_val) == 64

def test_candidate_mutation():
    baseline = get_baseline_harness()
    candidate = create_candidate_mutation(baseline, version_id="harness-v2-candidate")

    assert candidate.version_id == "harness-v2-candidate"
    assert candidate.parent_version_id == "harness-v1"
    assert candidate.validation_policy.require_reference_allele_check is True
    assert candidate.context_policy.include_reference_metadata is True
    assert candidate.compute_spec_hash() != baseline.compute_spec_hash()

def test_policy_envelope_rejects_unauthorized_tools():
    baseline = get_baseline_harness()
    envelope = PolicyEnvelope()

    # Tampering candidate attempting arbitrary command execution
    tampered_candidate = create_candidate_mutation(baseline, version_id="harness-malicious")
    tampered_candidate.allowed_tools.append("arbitrary_shell_exec")

    ok, msg = envelope.validate_candidate(tampered_candidate)
    assert ok is False
    assert "Unauthorized tool" in msg

def test_independent_evaluator_promotion():
    baseline = get_baseline_harness()
    candidate = create_candidate_mutation(baseline, version_id="harness-v2-candidate")
    evaluator = IndependentEvaluator()

    eval_result, receipt = evaluator.evaluate(baseline, candidate, run_id="run-exp-001")

    # Verify scores with explicit denominators
    assert eval_result.parent_score_numerator == 4
    assert eval_result.parent_score_denominator == 6
    assert eval_result.parent_score_str == "4/6"

    assert eval_result.score_numerator == 6
    assert eval_result.score_denominator == 6
    assert eval_result.candidate_score_str == "6/6"

    # Verify zero false positive inflation on valid controls
    assert eval_result.false_positive_rate == 0.0

    # Verify promotion
    assert eval_result.promoted is True
    assert "Candidate promoted" in eval_result.decision_reason

    # Verify receipt digest
    assert len(receipt.receipt_digest) == 64
    assert receipt.promoted is True
    assert receipt.score == "6/6"
    assert receipt.parent_score == "4/6"
