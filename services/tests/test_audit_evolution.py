from __future__ import annotations

import pytest

from services.integrations.contracts import GenomicIncident
from services.runtime.evaluation.models import EvaluationResult, EvidenceReceipt, TestCaseResult
from services.runtime.evolution import (
    BoundedCandidateSearch,
    MetaHarnessSearchAdapter,
    PromotionAuthority,
    PromotionGateError,
)
from services.runtime.harness.baseline import get_baseline_harness
from services.runtime.harness.models import HarnessSpec, HarnessStatus
from services.runtime.optimization.reflection import FailureHypothesis

HYPOTHESIS = FailureHypothesis(
    failure_type="REF_ALLELE_MISMATCH",
    target_locus="chr22:105002",
    observed_discrepancy="REF mismatch",
    recommended_policy_action="enforce_strict_ref_checking",
    rationale="Harness bypassed reference check",
)


def _incident() -> GenomicIncident:
    return GenomicIncident(
        incident_id="audit-incident",
        run_id="audit-run",
        dataset_sha256="a",
        reference_sha256="b",
        failing_check="reference_allele_mismatch",
        error_signature="REF allele does not match",
    )


def _case(test_id: str, category: str, candidate_passed: bool = True) -> TestCaseResult:
    return TestCaseResult(
        test_id=test_id,
        description=test_id,
        category=category,
        parent_passed=True,
        candidate_passed=candidate_passed,
        details="",
    )


def _eval(
    candidate: HarnessSpec,
    *,
    score: tuple[int, int] = (6, 6),
    parent_score: tuple[int, int] = (4, 6),
    cases: list[TestCaseResult] | None = None,
    promoted: bool = True,
) -> tuple[EvaluationResult, EvidenceReceipt]:
    if cases is None:
        cases = [
            _case("negative_control_valid_snvs", "negative_control"),
            _case("heldout_transfer_unseen_mismatch", "heldout_transfer"),
        ]
    result = EvaluationResult(
        candidate_version_id=candidate.version_id,
        parent_version_id="harness-v1",
        score_numerator=score[0],
        score_denominator=score[1],
        parent_score_numerator=parent_score[0],
        parent_score_denominator=parent_score[1],
        false_positive_rate=0.0,
        envelope_compliance=True,
        promoted=promoted,
        decision_reason="audit",
        test_results=cases,
    )
    receipt = EvidenceReceipt.create(
        receipt_id="rcpt-audit",
        run_id="run-audit",
        eval_result=result,
        parent_hash="a" * 64,
        candidate_hash=candidate.compute_spec_hash(),
        evaluator_hash="c" * 64,
        input_hashes=[],
        timestamp="2026-10-11T00:00:00Z",
    )
    return result, receipt


def _candidate() -> HarnessSpec:
    cand = get_baseline_harness().model_copy(deep=True)
    cand.version_id = "harness-v2-audit"
    cand.parent_version_id = "harness-v1"
    cand.status = HarnessStatus.CANDIDATE
    cand.validation_policy.require_reference_allele_check = True
    return cand


# BoundedCandidateSearch


def test_branches_record_lineage_and_candidate_status():
    parent = get_baseline_harness()
    branches = BoundedCandidateSearch().generate_candidate_branches(parent, HYPOTHESIS)
    assert branches
    for spec, _hash in branches:
        assert spec.parent_version_id == parent.version_id
        assert spec.status == HarnessStatus.CANDIDATE
    assert parent.parent_version_id is None
    assert parent.status == HarnessStatus.BASELINE


@pytest.mark.parametrize("limit", [0, -1])
def test_bounded_search_honors_non_positive_max_branches(limit):
    branches = BoundedCandidateSearch().generate_candidate_branches(
        get_baseline_harness(), HYPOTHESIS, max_branches=limit
    )
    assert branches == []


def test_bounded_search_honors_max_branches_of_one():
    branches = BoundedCandidateSearch().generate_candidate_branches(
        get_baseline_harness(), HYPOTHESIS, max_branches=1
    )
    assert len(branches) == 1


# MetaHarnessSearchAdapter


@pytest.mark.parametrize("limit", [0, -1])
def test_meta_harness_honors_non_positive_max_candidates(limit):
    out = MetaHarnessSearchAdapter().generate_candidates(
        get_baseline_harness(), _incident(), max_candidates=limit
    )
    assert out == []


def test_meta_harness_honors_max_candidates_of_one():
    out = MetaHarnessSearchAdapter().generate_candidates(
        get_baseline_harness(), _incident(), max_candidates=1
    )
    assert len(out) == 1


# PromotionAuthority


@pytest.mark.asyncio
async def test_promotion_rejects_evaluation_of_a_different_candidate():
    cand = _candidate()
    result, receipt = _eval(cand)
    other = cand.model_copy(deep=True)
    other.version_id = "harness-v2-other"
    authority = PromotionAuthority()
    with pytest.raises(PromotionGateError):
        await authority.evaluate_and_promote(other, result, receipt)
    assert authority.active_version_id == "harness-v1-baseline"


@pytest.mark.asyncio
async def test_promotion_rejects_spec_that_differs_from_evaluated_spec():
    cand = _candidate()
    result, receipt = _eval(cand)
    tampered = cand.model_copy(deep=True)
    tampered.execution_policy.max_attempts = 4
    authority = PromotionAuthority()
    with pytest.raises(PromotionGateError):
        await authority.evaluate_and_promote(tampered, result, receipt)
    assert authority.active_version_id == "harness-v1-baseline"


@pytest.mark.asyncio
async def test_promotion_rejects_score_below_parent_even_if_flag_set():
    cand = _candidate()
    result, receipt = _eval(cand, score=(3, 6), parent_score=(4, 6))
    authority = PromotionAuthority()
    with pytest.raises(PromotionGateError):
        await authority.evaluate_and_promote(cand, result, receipt)
    assert authority.active_version_id == "harness-v1-baseline"


@pytest.mark.asyncio
async def test_promotion_requires_heldout_evidence():
    cand = _candidate()
    result, receipt = _eval(cand, cases=[_case("negative_control_valid_snvs", "negative_control")])
    authority = PromotionAuthority()
    with pytest.raises(PromotionGateError, match="Gate 4"):
        await authority.evaluate_and_promote(cand, result, receipt)
    assert authority.active_version_id == "harness-v1-baseline"


@pytest.mark.asyncio
async def test_promotion_accepts_fully_bound_evidence():
    cand = _candidate()
    result, receipt = _eval(cand)
    authority = PromotionAuthority()
    assert await authority.evaluate_and_promote(cand, result, receipt) is True
    assert authority.active_version_id == cand.version_id


@pytest.mark.asyncio
async def test_unpromoted_result_returns_false_without_pointer_change():
    cand = _candidate()
    result, receipt = _eval(cand, promoted=False)
    authority = PromotionAuthority()
    assert await authority.evaluate_and_promote(cand, result, receipt) is False
    assert authority.active_version_id == "harness-v1-baseline"
