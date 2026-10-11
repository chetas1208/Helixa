from __future__ import annotations

import copy
import hashlib
import json

from services.runtime.harness.models import HarnessSpec, HarnessStatus, PolicyEnvelope
from services.runtime.optimization.reflection import FailureHypothesis


class BoundedCandidateSearch:
    """
    Controlled candidate branching engine (inspired by Meta-Harness & DGM principles).
    Generates 2-3 distinct, meaningful configuration candidates,
    strictly deduplicated by canonical JSON configuration hash.
    Never executes untrusted code on the host.
    """

    def __init__(self, envelope: PolicyEnvelope | None = None):
        self.envelope = envelope or PolicyEnvelope()

    def generate_candidate_branches(
        self,
        parent: HarnessSpec,
        hypothesis: FailureHypothesis,
        max_branches: int = 3,
    ) -> list[tuple[HarnessSpec, str]]:
        branches: list[tuple[HarnessSpec, str]] = []
        seen_hashes: set[str] = set()

        # Branch 1: Focused policy mitigation
        b1 = copy.deepcopy(parent)
        b1.parent_version_id = parent.version_id
        b1.status = HarnessStatus.CANDIDATE
        b1.version_id = f"{parent.version_id}-branch-focus"
        if hypothesis.recommended_policy_action == "enforce_strict_ref_checking":
            b1.validation_policy.require_reference_allele_check = True
        elif hypothesis.recommended_policy_action == "enforce_contig_compatibility":
            b1.validation_policy.require_contig_compatibility = True
        h1 = self._compute_hash(b1)
        if len(branches) < max_branches and h1 not in seen_hashes and self._within_envelope(b1):
            branches.append((b1, h1))
            seen_hashes.add(h1)

        # Branch 2: Defense-in-depth composite
        if len(branches) < max_branches:
            b2 = copy.deepcopy(parent)
            b2.parent_version_id = parent.version_id
            b2.status = HarnessStatus.CANDIDATE
            b2.version_id = f"{parent.version_id}-branch-composite"
            b2.validation_policy.require_reference_allele_check = True
            b2.validation_policy.require_contig_compatibility = True
            b2.validation_policy.require_normalization_check = True
            b2.validation_policy.require_assembly_declaration = True
            h2 = self._compute_hash(b2)
            if h2 not in seen_hashes and self._within_envelope(b2):
                branches.append((b2, h2))
                seen_hashes.add(h2)

        # Branch 3: Resilient retry policy under failure
        if len(branches) < max_branches:
            b3 = copy.deepcopy(parent)
            b3.parent_version_id = parent.version_id
            b3.status = HarnessStatus.CANDIDATE
            b3.version_id = f"{parent.version_id}-branch-retry"
            b3.validation_policy.require_reference_allele_check = True
            b3.execution_policy.max_attempts = min(parent.execution_policy.max_attempts + 1, self.envelope.max_attempts_limit)
            h3 = self._compute_hash(b3)
            if h3 not in seen_hashes and self._within_envelope(b3):
                branches.append((b3, h3))
                seen_hashes.add(h3)

        return branches

    def _compute_hash(self, spec: HarnessSpec) -> str:
        dump = spec.model_dump()
        # Exclude version_id from semantic hash to detect structural duplicates
        dump_no_id = {k: v for k, v in dump.items() if k != "version_id"}
        return hashlib.sha256(json.dumps(dump_no_id, sort_keys=True).encode("utf-8")).hexdigest()

    def _within_envelope(self, spec: HarnessSpec) -> bool:
        ok, _ = self.envelope.validate_candidate(spec)
        return ok
