from __future__ import annotations

from typing import Any

from services.integrations.contracts import GenomicIncident, HarnessCandidatePatch
from services.runtime.harness.models import HarnessSpec, PolicyEnvelope

from .gepa_adapter import GepaProposerAdapter, gepa_package_status
from .search_adapter import MetaHarnessSearchAdapter


def scheduler_status() -> dict[str, Any]:
    gepa_status, gepa_detail = gepa_package_status()
    return {
        "gepa_status": gepa_status,
        "gepa_detail": gepa_detail,
        "primary_proposer": "DETERMINISTIC",
        "meta_harness_imported": False,
    }


class OptimizerRegistry:

    """
    Unified Optimizer Registry managing candidate proposers (Meta-Harness, GEPA, etc.).
    Ensures DIAMOND operates under a single coherent promotion authority:
    External optimizers act solely as candidate proposers, while DIAMOND's independent
    oracle adjudicates performance against held-out evidence.
    """

    def __init__(self, envelope: PolicyEnvelope | None = None):
        self.envelope = envelope or PolicyEnvelope()
        self._proposers: dict[str, Any] = {
            "meta_harness": MetaHarnessSearchAdapter(self.envelope),
            "gepa": GepaProposerAdapter(self.envelope),
        }

    def register_proposer(self, name: str, proposer: Any) -> None:
        self._proposers[name] = proposer

    def list_optimizers(self) -> list[str]:
        return list(self._proposers.keys())

    def propose_candidates(
        self,
        parent: HarnessSpec,
        incident: GenomicIncident | None = None,
        optimizers: list[str] | None = None,
    ) -> list[tuple[HarnessSpec, HarnessCandidatePatch]]:
        target_names = optimizers or list(self._proposers.keys())
        proposals: list[tuple[HarnessSpec, HarnessCandidatePatch]] = []
        seen_hashes: set[str] = set()

        for name in target_names:
            proposer = self._proposers.get(name)
            if not proposer:
                continue

            if name == "meta_harness" or hasattr(proposer, "generate_candidates"):
                mh_candidates = proposer.generate_candidates(parent=parent, incident=incident)
                for spec, patch in mh_candidates:
                    if patch.canonical_hash not in seen_hashes:
                        proposals.append((spec, patch))
                        seen_hashes.add(patch.canonical_hash)

            elif name == "gepa" or hasattr(proposer, "propose_reflective_candidate"):
                if incident:
                    gepa_cand = proposer.propose_reflective_candidate(parent=parent, incident=incident)
                    if gepa_cand:
                        spec, patch = gepa_cand
                        if patch.canonical_hash not in seen_hashes:
                            proposals.append((spec, patch))
                            seen_hashes.add(patch.canonical_hash)

        return proposals
