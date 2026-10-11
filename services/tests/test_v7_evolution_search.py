from __future__ import annotations

import pytest

from services.runtime.evaluation import IndependentEvaluator
from services.runtime.evaluation.models import EvaluationResult, EvidenceReceipt, TestCaseResult
from services.runtime.evolution import (
    BoundedCandidateSearch,
    PromotionAuthority,
    PromotionGateError,
)
from services.runtime.harness.baseline import get_baseline_harness
from services.runtime.optimization.reflection import FailureHypothesis


def test_bounded_candidate_search_and_deduplication():
    search = BoundedCandidateSearch()
    parent = get_baseline_harness()

    hypothesis = FailureHypothesis(
        failure_type="REF_ALLELE_MISMATCH",
        target_locus="chr22:105002",
        observed_discrepancy="REF mismatch",
        recommended_policy_action="enforce_strict_ref_checking",
        rationale="Harness bypassed reference check",
    )

    branches = search.generate_candidate_branches(parent, hypothesis, max_branches=3)
    assert len(branches) in (2, 3)

    # Check deduplication by canonical hash
    hashes = [h for _, h in branches]
    assert len(hashes) == len(set(hashes)), "Duplicate candidate branch hash detected!"

    for spec, c_hash in branches:
        assert len(c_hash) == 64
        assert spec.validation_policy.require_reference_allele_check is True


@pytest.mark.asyncio
async def test_promotion_authority_hard_safety_gates():
    authority = PromotionAuthority()
    parent = get_baseline_harness()

    eval_res_pass = EvaluationResult(
        candidate_version_id="candidate-1",
        parent_version_id=parent.version_id,
        score_numerator=6,
        score_denominator=6,
        parent_score_numerator=5,
        parent_score_denominator=6,
        false_positive_rate=0.0,
        envelope_compliance=True,
        promoted=True,
        decision_reason="Passed",
        test_results=[],
    )

    receipt = EvidenceReceipt.create(
        receipt_id="rcpt-test",
        run_id="run-test",
        eval_result=eval_res_pass,
        parent_hash="a" * 64,
        candidate_hash="b" * 64,
        evaluator_hash="c" * 64,
        input_hashes=[],
        timestamp="2026-10-11T00:00:00Z",
    )

    # Gate 1 test: Candidate violating envelope (e.g. 999 context items)
    bad_spec = parent.model_copy(deep=True)
    bad_spec.context_policy.max_context_items = 999

    with pytest.raises(PromotionGateError, match="Rejected at Gate 1"):
        await authority.evaluate_and_promote(bad_spec, eval_res_pass, receipt)

    # Gate 3 test: Negative control regression
    valid_spec = parent.model_copy(deep=True)
    eval_res_regression = EvaluationResult(
        candidate_version_id="candidate-1",
        parent_version_id=parent.version_id,
        score_numerator=5,
        score_denominator=6,
        parent_score_numerator=5,
        parent_score_denominator=6,
        false_positive_rate=0.0,
        envelope_compliance=True,
        promoted=True,
        decision_reason="Regression",
        test_results=[
            TestCaseResult(
                test_id="valid_snvs_case",
                description="Valid SNVs",
                category="negative_control",
                parent_passed=True,
                candidate_passed=False,  # Regression!
                details="False positive rejection",
            )
        ],
    )
    with pytest.raises(PromotionGateError, match="Rejected at Gate 3"):
        await authority.evaluate_and_promote(valid_spec, eval_res_regression, receipt)


@pytest.mark.asyncio
async def test_promotion_authority_promotes_qualified_candidate():
    evaluator = IndependentEvaluator(fixtures_dir="fixtures")
    authority = PromotionAuthority()
    parent = get_baseline_harness()

    candidate = parent.model_copy(deep=True)
    candidate.version_id = "harness-v2-qualified"
    candidate.validation_policy.require_reference_allele_check = True

    eval_res, receipt = evaluator.evaluate(parent, candidate)
    promoted = await authority.evaluate_and_promote(candidate, eval_res, receipt)

    assert promoted is True
    assert authority.active_version_id == "harness-v2-qualified"
