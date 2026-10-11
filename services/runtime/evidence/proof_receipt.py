"""Deterministic evidence fingerprint and V8 proof receipt generation."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from services.integrations.contracts import AdjudicationVerdict, EvidenceReceiptV8

STABLE_FIELDS = (
    "schema_version",
    "run_id",
    "parent_version_id",
    "candidate_version_id",
    "optimizer_provenance",
    "promoted",
    "decision_reason",
    "parent_passed",
    "parent_total",
    "candidate_passed",
    "candidate_total",
    "false_positive_count",
    "negative_control_count",
    "holdout_case_ids",
    "adjudication",
    "reference_artifact_sha256",
    "configuration_hashes",
    "raindrop_status",
    "elevenlabs_status",
)

V8_STABLE_FIELDS = (
    "run_id",
    "incident_id",
    "candidate_hash",
    "dual_validator_agreement",
    "safety_gates",
    "decision",
)


def canonical_body(receipt: dict[str, Any]) -> dict[str, Any]:
    body = {key: receipt.get(key) for key in STABLE_FIELDS}
    body["holdout_case_ids"] = sorted(body.get("holdout_case_ids") or [])
    return body


def fingerprint_receipt(receipt: dict[str, Any]) -> str:
    encoded = json.dumps(canonical_body(receipt), sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def compute_v8_receipt_digest(
    run_id: str,
    incident_id: str,
    candidate_hash: str,
    dual_validator_agreement: str,
    safety_gates: dict[str, bool],
    decision: str,
) -> str:
    canonical = {
        "run_id": run_id,
        "incident_id": incident_id,
        "candidate_hash": candidate_hash,
        "dual_validator_agreement": str(getattr(dual_validator_agreement, "value", dual_validator_agreement)),
        "safety_gates": dict(sorted(safety_gates.items())),
        "decision": decision,
    }
    encoded = json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def mint_v8_receipt(
    run_id: str,
    incident_id: str,
    candidate_hash: str,
    dual_validator_agreement: AdjudicationVerdict | str,
    safety_gates: dict[str, bool],
    decision: str,
    metadata: dict[str, Any] | None = None,
) -> EvidenceReceiptV8:
    agreement_str = (
        dual_validator_agreement.value
        if hasattr(dual_validator_agreement, "value")
        else str(dual_validator_agreement)
    )
    receipt_id = f"rcpt-v8-{hashlib.sha256(f'{run_id}-{candidate_hash}'.encode()).hexdigest()[:12]}"

    receipt = EvidenceReceiptV8(
        receipt_id=receipt_id,
        run_id=run_id,
        incident_id=incident_id,
        candidate_hash=candidate_hash,
        dual_validator_agreement=AdjudicationVerdict(agreement_str),
        safety_gates=safety_gates,
        decision=decision,
        receipt_digest="",
        created_at=datetime.now(timezone.utc).isoformat(),
        metadata=metadata or {},
    )
    # Digest the model's validated (coerced) fields so verify_v8_receipt recomputes the same value.
    digest = compute_v8_receipt_digest(
        run_id=receipt.run_id,
        incident_id=receipt.incident_id,
        candidate_hash=receipt.candidate_hash,
        dual_validator_agreement=receipt.dual_validator_agreement.value,
        safety_gates=receipt.safety_gates,
        decision=receipt.decision,
    )
    return receipt.model_copy(update={"receipt_digest": digest})


def verify_v8_receipt(receipt: EvidenceReceiptV8) -> bool:
    expected = compute_v8_receipt_digest(
        run_id=receipt.run_id,
        incident_id=receipt.incident_id,
        candidate_hash=receipt.candidate_hash,
        dual_validator_agreement=receipt.dual_validator_agreement.value,
        safety_gates=receipt.safety_gates,
        decision=receipt.decision,
    )
    return receipt.receipt_digest == expected
