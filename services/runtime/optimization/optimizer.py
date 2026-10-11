from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import dataclass
from typing import Any, Protocol

from services.runtime.harness.models import HarnessSpec, HarnessStatus
from services.runtime.optimization.budgets import BudgetTracker, OptimizationBudget
from services.runtime.optimization.reflection import FailureHypothesis, FailureTraceReflector


@dataclass(frozen=True)
class ProposedCandidate:
    candidate_id: str
    parent_version_id: str
    harness_spec: HarnessSpec
    hypothesis: FailureHypothesis
    canonical_hash: str


class HarnessOptimizer(Protocol):
    def propose_candidates(
        self,
        parent: HarnessSpec,
        failure_finding: dict[str, Any],
        budget: OptimizationBudget,
    ) -> list[ProposedCandidate]:
        ...


class ReflectiveHarnessOptimizer:
    """
    Reflective, evidence-guided harness optimizer.
    Generates deterministic, bounded candidate mutations from failure traces
    while strictly preserving PolicyEnvelope boundaries.
    """

    def __init__(self, reflector: FailureTraceReflector | None = None):
        self.reflector = reflector or FailureTraceReflector()

    def propose_candidates(
        self,
        parent: HarnessSpec,
        failure_finding: dict[str, Any],
        budget: OptimizationBudget | None = None,
    ) -> list[ProposedCandidate]:
        tracker = BudgetTracker(budget=budget or OptimizationBudget())
        hypothesis = self.reflector.reflect_on_discrepancy(failure_finding)

        candidates: list[ProposedCandidate] = []
        if not tracker.can_propose():
            return candidates

        # Candidate 1: Targeted policy toggle derived from failure hypothesis
        cand1_spec = copy.deepcopy(parent)
        cand1_spec.version_id = f"{parent.version_id}-refl-1"
        cand1_spec.parent_version_id = parent.version_id
        cand1_spec.status = HarnessStatus.CANDIDATE

        if hypothesis.recommended_policy_action == "enforce_strict_ref_checking":
            cand1_spec.validation_policy.require_reference_allele_check = True
        elif hypothesis.recommended_policy_action == "enforce_contig_compatibility":
            cand1_spec.validation_policy.require_contig_compatibility = True
        elif hypothesis.recommended_policy_action == "enforce_boundary_guards":
            cand1_spec.validation_policy.require_normalization_check = True

        h1_hash = hashlib.sha256(
            json.dumps(cand1_spec.model_dump(), sort_keys=True).encode("utf-8")
        ).hexdigest()
        candidates.append(
            ProposedCandidate(
                candidate_id=cand1_spec.version_id,
                parent_version_id=parent.version_id,
                harness_spec=cand1_spec,
                hypothesis=hypothesis,
                canonical_hash=h1_hash,
            )
        )
        tracker.record_proposal()

        # Candidate 2: Conservative composite candidate with reordered safe validation tools
        if tracker.can_propose():
            cand2_spec = copy.deepcopy(cand1_spec)
            cand2_spec.version_id = f"{parent.version_id}-refl-composite"
            cand2_spec.validation_policy.require_reference_allele_check = True
            cand2_spec.validation_policy.require_contig_compatibility = True
            cand2_spec.validation_policy.require_assembly_declaration = True
            # Reorder allowed tools to put inspect_reference before run_validation
            reordered_tools = [
                t for t in cand2_spec.allowed_tools if t != "inspect_reference"
            ]
            reordered_tools.insert(0, "inspect_reference")
            cand2_spec.allowed_tools = reordered_tools

            h2_hash = hashlib.sha256(
                json.dumps(cand2_spec.model_dump(), sort_keys=True).encode("utf-8")
            ).hexdigest()
            candidates.append(
                ProposedCandidate(
                    candidate_id=cand2_spec.version_id,
                    parent_version_id=parent.version_id,
                    harness_spec=cand2_spec,
                    hypothesis=hypothesis,
                    canonical_hash=h2_hash,
                )
            )
            tracker.record_proposal()

        return candidates
