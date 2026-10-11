from __future__ import annotations

from typing import Any

from services.runtime.evaluation.models import EvaluationResult, EvidenceReceipt
from services.runtime.harness.models import HarnessSpec, PolicyEnvelope


class PromotionGateError(RuntimeError):
    pass


class PromotionAuthority:
    """
    Independent gatekeeper and atomic promotion authority.
    Only promotes candidates that satisfy all hard safety gates:
    1. Policy envelope validation passes
    2. Zero regressions on negative control fixtures
    3. Transfer performance satisfied on held-out test sets
    4. Candidate score >= Parent score
    5. Evaluation evidence is bound to the exact candidate spec
    """

    def __init__(self, envelope: PolicyEnvelope | None = None, mongo_harness_repo: Any | None = None):
        self.envelope = envelope or PolicyEnvelope()
        self.harness_repo = mongo_harness_repo
        self.active_version_id: str = "harness-v1-baseline"

    async def evaluate_and_promote(
        self,
        candidate_spec: HarnessSpec,
        eval_result: EvaluationResult,
        receipt: EvidenceReceipt,
    ) -> bool:
        # Hard Gate 1: Policy Envelope
        envelope_ok, envelope_reason = self.envelope.validate_candidate(candidate_spec)
        if not envelope_ok:
            raise PromotionGateError(f"Rejected at Gate 1 (Policy Envelope): {envelope_reason}")

        # Hard Gate 2: Evaluator promotion determination
        if not eval_result.promoted:
            return False

        # Hard Gate 3: Negative control zero-regression
        for case in eval_result.test_results:
            if case.category == "negative_control" and not case.candidate_passed:
                raise PromotionGateError(
                    f"Rejected at Gate 3 (Negative Control Regression): '{case.test_id}' failed"
                )

        # Hard Gate 4: Held-out transfer check (absent held-out evidence fails closed)
        heldout_cases = [c for c in eval_result.test_results if c.category == "heldout_transfer"]
        if not heldout_cases:
            raise PromotionGateError("Rejected at Gate 4 (Held-Out Transfer Failure): no held-out evidence")
        for case in heldout_cases:
            if not case.candidate_passed:
                raise PromotionGateError(
                    f"Rejected at Gate 4 (Held-Out Transfer Failure): '{case.test_id}' failed"
                )

        # Hard Gate 5: Candidate score must not fall below the parent score
        if (
            eval_result.score_numerator * eval_result.parent_score_denominator
            < eval_result.parent_score_numerator * eval_result.score_denominator
        ):
            raise PromotionGateError(
                f"Rejected at Gate 5 (Score Regression): {eval_result.candidate_score_str} "
                f"< parent {eval_result.parent_score_str}"
            )

        # Hard Gate 6: Evidence must be bound to the exact spec being promoted
        if (
            eval_result.candidate_version_id != candidate_spec.version_id
            or receipt.candidate_version_id != candidate_spec.version_id
            or receipt.candidate_spec_hash != candidate_spec.compute_spec_hash()
        ):
            raise PromotionGateError(
                f"Rejected at Gate 6 (Evidence Binding): evaluation does not cover '{candidate_spec.version_id}'"
            )

        # Execute atomic CAS promotion
        if self.harness_repo:
            await self.harness_repo.promote_version(candidate_spec.version_id)

        self.active_version_id = candidate_spec.version_id
        return True
