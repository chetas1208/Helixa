from __future__ import annotations

from services.runtime.harness.baseline import get_baseline_harness
from services.runtime.harness.models import PolicyEnvelope
from services.runtime.optimization import (
    BudgetTracker,
    FailureTraceReflector,
    OptimizationBudget,
    ReflectiveHarnessOptimizer,
)


def test_failure_trace_reflector_hypotheses():
    reflector = FailureTraceReflector()

    # Test REF mismatch discrepancy
    finding_ref = {
        "status": "FAIL",
        "code": "REF_MISMATCH",
        "chrom": "chr22",
        "pos": 105002,
        "details": "REF allele mismatch at POS 105002: expected A, got C",
    }
    h_ref = reflector.reflect_on_discrepancy(finding_ref)
    assert h_ref.failure_type == "REF_ALLELE_MISMATCH"
    assert h_ref.target_locus == "chr22:105002"
    assert h_ref.recommended_policy_action == "enforce_strict_ref_checking"

    # Test contig mismatch discrepancy
    finding_contig = {
        "status": "FAIL",
        "code": "CONTIG_MISMATCH",
        "chrom": "chrX",
        "pos": 10001,
        "details": "Unknown contig chrX",
    }
    h_contig = reflector.reflect_on_discrepancy(finding_contig)
    assert h_contig.failure_type == "CONTIG_NOT_FOUND"
    assert h_contig.recommended_policy_action == "enforce_contig_compatibility"

    # Test coordinate out of bounds
    finding_oob = {
        "status": "FAIL",
        "code": "COORDINATE_OUT_OF_BOUNDS",
        "chrom": "chr22",
        "pos": 9999999,
        "details": "Coordinate out of bounds",
    }
    h_oob = reflector.reflect_on_discrepancy(finding_oob)
    assert h_oob.failure_type == "COORDINATE_OVERFLOW"
    assert h_oob.recommended_policy_action == "enforce_boundary_guards"


def test_optimization_budget_enforcement():
    budget = OptimizationBudget(max_proposals=2, max_evaluator_calls=3)
    tracker = BudgetTracker(budget=budget)

    assert tracker.can_propose()
    tracker.record_proposal()
    assert tracker.can_propose()
    tracker.record_proposal()
    assert not tracker.can_propose()
    assert "Exceeded max_proposals" in tracker.stopped_reason

    assert tracker.can_evaluate()
    tracker.record_evaluator_call()
    tracker.record_evaluator_call()
    tracker.record_evaluator_call()
    assert not tracker.can_evaluate()
    assert "Exceeded max_evaluator_calls" in tracker.stopped_reason


def test_reflective_optimizer_candidate_generation():
    envelope = PolicyEnvelope()
    parent = get_baseline_harness()
    optimizer = ReflectiveHarnessOptimizer()

    finding = {
        "status": "FAIL",
        "code": "REF_MISMATCH",
        "chrom": "chr22",
        "pos": 105002,
        "details": "REF allele mismatch at POS 105002",
    }

    candidates = optimizer.propose_candidates(
        parent=parent,
        failure_finding=finding,
        budget=OptimizationBudget(max_proposals=3),
    )

    assert len(candidates) >= 1
    for cand in candidates:
        assert cand.parent_version_id == parent.version_id
        assert len(cand.canonical_hash) == 64
        # Validate that candidate stays within PolicyEnvelope limits
        ok, reason = envelope.validate_candidate(cand.harness_spec)
        assert ok, f"Candidate violated envelope: {reason}"
        # Candidate must have turned on reference check
        assert cand.harness_spec.validation_policy.require_reference_allele_check is True
