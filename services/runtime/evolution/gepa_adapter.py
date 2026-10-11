from __future__ import annotations

import copy
from typing import Any

from services.integrations.contracts import GenomicIncident, HarnessCandidatePatch
from services.runtime.harness.models import HarnessSpec, HarnessStatus, PolicyEnvelope


class GepaProposerAdapter:
    """
    Reflective proposer adapter inspired by GEPA (Genetic Pareto / reflective prompt mutation):
    Extracts causal failure traces and incident error signatures to formulate targeted
    hypothesis mutations rather than indiscriminate parameter exploration.
    """

    def __init__(self, envelope: PolicyEnvelope | None = None):
        self.envelope = envelope or PolicyEnvelope()

    def propose_reflective_candidate(
        self,
        parent: HarnessSpec,
        incident: GenomicIncident,
    ) -> tuple[HarnessSpec, HarnessCandidatePatch] | None:
        candidate = copy.deepcopy(parent)
        candidate.parent_version_id = parent.version_id
        candidate.status = HarnessStatus.CANDIDATE

        sig = incident.error_signature.lower()
        failing = incident.failing_check.lower()
        rationale_items: list[str] = []

        # 1. Genomic reference allele failure reflection
        if "reference" in sig or "allele" in failing:
            candidate.validation_policy.require_reference_allele_check = True
            candidate.context_policy.include_reference_metadata = True
            rationale_items.append("enforced reference allele verification and reference metadata retention")

        # 2. Contig or assembly mismatch reflection
        if "contig" in sig or "assembly" in sig or "contig" in failing:
            candidate.validation_policy.require_contig_compatibility = True
            candidate.validation_policy.require_assembly_declaration = True
            rationale_items.append("enforced contig header compatibility and assembly declaration checks")

        # 3. Dual validator disagreement reflection
        if incident.disagreement_detected or "disagree" in failing:
            candidate.validation_policy.require_reference_allele_check = True
            candidate.validation_policy.require_contig_compatibility = True
            candidate.validation_policy.require_normalization_check = True
            candidate.context_policy.include_prior_failures = True
            rationale_items.append("cross-validator divergence triggered defensive multi-engine validation envelope")

        # 4. Execution / timeout reflection
        if "timeout" in sig or "execution" in sig or "error" in failing:
            candidate.execution_policy.max_attempts = min(
                parent.execution_policy.max_attempts + 1, self.envelope.max_attempts_limit
            )
            candidate.execution_policy.checkpoint_every_steps = max(1, parent.execution_policy.checkpoint_every_steps - 1)
            rationale_items.append("elevated retry ceiling and tightened checkpoint frequency")

        # Fallback reflection if generic incident
        if not rationale_items:
            candidate.context_policy.include_prior_failures = True
            candidate.validation_policy.require_normalization_check = True
            rationale_items.append("retained failure trajectory in context and enabled normalization audit")

        candidate.version_id = candidate.stable_version_id("refl")

        # Validate against immutable envelope
        valid, msg = self.envelope.validate_candidate(candidate)
        if not valid:
            return None

        # Calculate spec hash and diff
        cand_hash = candidate.compute_spec_hash()
        diff = self._compute_diff(parent, candidate)

        rationale = f"GEPA reflective adaptation targeting incident '{incident.incident_id}': " + "; ".join(rationale_items) + "."

        patch = HarnessCandidatePatch(
            patch_id=f"patch-{candidate.version_id}",
            parent_version_id=parent.version_id,
            candidate_version_id=candidate.version_id,
            optimizer_source="DETERMINISTIC",
            policy_diff=diff,
            canonical_hash=cand_hash,
            rationale=rationale,
        )

        return candidate, patch

    def _compute_diff(self, parent: HarnessSpec, cand: HarnessSpec) -> dict[str, Any]:
        diff: dict[str, Any] = {}
        if parent.context_policy != cand.context_policy:
            diff["context_policy"] = {
                "before": parent.context_policy.model_dump(),
                "after": cand.context_policy.model_dump(),
            }
        if parent.validation_policy != cand.validation_policy:
            diff["validation_policy"] = {
                "before": parent.validation_policy.model_dump(),
                "after": cand.validation_policy.model_dump(),
            }
        if parent.execution_policy != cand.execution_policy:
            diff["execution_policy"] = {
                "before": parent.execution_policy.model_dump(),
                "after": cand.execution_policy.model_dump(),
            }
        return diff


def gepa_package_status() -> tuple[str, str]:
    """Report the installed GEPA package without calling optimize()."""
    try:
        from importlib.metadata import version

        import gepa  # noqa: F401
    except Exception as exc:
        return "DISABLED", f"gepa import failed: {exc}"
    return "INSTALLED_UNCONFIGURED", (
        f"gepa {version('gepa')} is installed. optimize() is not called; "
        "candidate text is produced by the deterministic proposer."
    )

