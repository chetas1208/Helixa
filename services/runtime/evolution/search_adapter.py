from __future__ import annotations

import copy
from typing import Any

from services.integrations.contracts import GenomicIncident, HarnessCandidatePatch
from services.runtime.harness.models import HarnessSpec, HarnessStatus, PolicyEnvelope


class MetaHarnessSearchAdapter:
    """
    Candidate search adapter following Meta-Harness principles:
    Systematic parameter exploration within immutable policy envelope bounds.
    Generates distinct candidate variations and produces deterministic patches.
    """

    def __init__(self, envelope: PolicyEnvelope | None = None):
        self.envelope = envelope or PolicyEnvelope()

    def generate_candidates(
        self,
        parent: HarnessSpec,
        incident: GenomicIncident | None = None,
        max_candidates: int = 3,
    ) -> list[tuple[HarnessSpec, HarnessCandidatePatch]]:
        candidates: list[tuple[HarnessSpec, HarnessCandidatePatch]] = []
        seen_hashes: set[str] = set()

        # Variant 1: Checkpoint cadence & context expansion
        c1 = copy.deepcopy(parent)
        c1.parent_version_id = parent.version_id
        c1.status = HarnessStatus.CANDIDATE
        c1.execution_policy.checkpoint_every_steps = max(1, parent.execution_policy.checkpoint_every_steps - 1)
        c1.context_policy.max_context_items = min(parent.context_policy.max_context_items + 2, self.envelope.max_context_items_limit)
        c1.version_id = c1.stable_version_id("mh-cadence")

        h1 = c1.compute_spec_hash()
        if len(candidates) < max_candidates and h1 not in seen_hashes and self._is_valid(c1):
            diff1 = self._compute_diff(parent, c1)
            patch1 = HarnessCandidatePatch(
                patch_id=f"patch-{c1.version_id}",
                parent_version_id=parent.version_id,
                candidate_version_id=c1.version_id,
                optimizer_source="DETERMINISTIC",
                policy_diff=diff1,
                canonical_hash=h1,
                rationale="Meta-Harness parameter search: tightened checkpoint cadence and expanded context budget.",
            )
            candidates.append((c1, patch1))
            seen_hashes.add(h1)

        # Variant 2: Resilience retry elevation
        if len(candidates) < max_candidates:
            c2 = copy.deepcopy(parent)
            c2.parent_version_id = parent.version_id
            c2.status = HarnessStatus.CANDIDATE
            c2.execution_policy.max_attempts = min(parent.execution_policy.max_attempts + 1, self.envelope.max_attempts_limit)
            c2.context_policy.include_prior_failures = True
            c2.version_id = c2.stable_version_id("mh-resilience")

            h2 = c2.compute_spec_hash()
            if h2 not in seen_hashes and self._is_valid(c2):
                diff2 = self._compute_diff(parent, c2)
                patch2 = HarnessCandidatePatch(
                    patch_id=f"patch-{c2.version_id}",
                    parent_version_id=parent.version_id,
                    candidate_version_id=c2.version_id,
                    optimizer_source="DETERMINISTIC",
                    policy_diff=diff2,
                    canonical_hash=h2,
                    rationale="Meta-Harness resilience search: increased execution retry headroom and enforced failure history retention.",
                )
                candidates.append((c2, patch2))
                seen_hashes.add(h2)

        # Variant 3: Comprehensive policy hardening (if incident observed)
        if len(candidates) < max_candidates and incident:
            c3 = copy.deepcopy(parent)
            c3.parent_version_id = parent.version_id
            c3.status = HarnessStatus.CANDIDATE
            c3.validation_policy.require_reference_allele_check = True
            c3.validation_policy.require_contig_compatibility = True
            c3.validation_policy.require_normalization_check = True
            c3.validation_policy.require_assembly_declaration = True
            c3.version_id = c3.stable_version_id("mh-hardened")

            h3 = c3.compute_spec_hash()
            if h3 not in seen_hashes and self._is_valid(c3):
                diff3 = self._compute_diff(parent, c3)
                patch3 = HarnessCandidatePatch(
                    patch_id=f"patch-{c3.version_id}",
                    parent_version_id=parent.version_id,
                    candidate_version_id=c3.version_id,
                    optimizer_source="DETERMINISTIC",
                    policy_diff=diff3,
                    canonical_hash=h3,
                    rationale=f"Meta-Harness hardening: full validation policy enforcement triggered by incident '{incident.incident_id}'.",
                )
                candidates.append((c3, patch3))
                seen_hashes.add(h3)

        return candidates

    def _is_valid(self, spec: HarnessSpec) -> bool:
        ok, _ = self.envelope.validate_candidate(spec)
        return ok

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
