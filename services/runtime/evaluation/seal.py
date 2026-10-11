from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field


class EvidenceSealV1(BaseModel):
    schema_version: int = 1
    type: str = "diamond-genome-harness-evaluation"
    seal_id: str
    run_id: str
    parent_harness_id: str
    candidate_harness_id: str
    mutation_hash: str
    input_manifest_hash: str
    suite_hash: str
    environment_manifest_hash: str
    case_result_ids: list[str] = Field(default_factory=list)
    safety_gate_results: dict[str, bool] = Field(default_factory=dict)
    metric_summary: dict[str, Any] = Field(default_factory=dict)
    decision: str  # PROMOTED or REJECTED
    decision_reason: str
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    seal_hash: str = ""

    def compute_canonical_hash(self) -> str:
        dump = self.model_dump()
        dump.pop("seal_hash", None)
        canonical_bytes = json.dumps(dump, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
        return hashlib.sha256(canonical_bytes).hexdigest()

    @classmethod
    def create(
        cls,
        seal_id: str,
        run_id: str,
        parent_harness_id: str,
        candidate_harness_id: str,
        mutation_hash: str,
        input_manifest_hash: str,
        suite_hash: str,
        environment_manifest_hash: str,
        case_result_ids: list[str],
        safety_gate_results: dict[str, bool],
        metric_summary: dict[str, Any],
        decision: str,
        decision_reason: str,
    ) -> EvidenceSealV1:
        instance = cls(
            seal_id=seal_id,
            run_id=run_id,
            parent_harness_id=parent_harness_id,
            candidate_harness_id=candidate_harness_id,
            mutation_hash=mutation_hash,
            input_manifest_hash=input_manifest_hash,
            suite_hash=suite_hash,
            environment_manifest_hash=environment_manifest_hash,
            case_result_ids=case_result_ids,
            safety_gate_results=safety_gate_results,
            metric_summary=metric_summary,
            decision=decision,
            decision_reason=decision_reason,
            seal_hash="",
        )
        instance.seal_hash = instance.compute_canonical_hash()
        return instance


def verify_evidence_seal(seal: EvidenceSealV1) -> tuple[bool, str]:
    """
    Independently verifies an Evidence Seal without modifying records.
    Validates canonical SHA-256 hash identity and mandatory safety gates.
    """
    try:
        computed = seal.compute_canonical_hash()
    except ValueError:
        return False, "Tamper detected! Seal contents are not canonically hashable (non-finite number)."
    if computed != seal.seal_hash:
        return (
            False,
            f"Tamper detected! Stored seal_hash ({seal.seal_hash[:16]}...) does not match recomputed digest ({computed[:16]}...)",
        )

    if seal.decision not in ("PROMOTED", "REJECTED"):
        return False, f"Integrity violation! Unrecognized seal decision '{seal.decision}'."

    # Check mandatory safety gates
    for gate, passed in seal.safety_gate_results.items():
        if not passed and seal.decision == "PROMOTED":
            return (
                False,
                f"Integrity violation! Seal claims PROMOTED, but mandatory safety gate '{gate}' failed.",
            )

    return True, "Evidence seal is authentic, untampered, and structurally verified."
