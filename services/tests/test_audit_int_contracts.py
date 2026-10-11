from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from services.integrations.contracts import (
    AdjudicationVerdict,
    EvaluationRun,
    EvidenceReceiptV8,
    ExternalIntegrationHealth,
    GenomicIncident,
    HarnessCandidatePatch,
    SafetyGateOutcome,
    ScientificCheckResult,
    ScientificToolManifest,
    ToolInvocationRequest,
    ToolInvocationResult,
)
from services.runtime.evidence.proof_receipt import mint_v8_receipt, verify_v8_receipt


def _incident(**kw):
    base = dict(
        incident_id="i",
        run_id="r",
        dataset_sha256="a",
        reference_sha256="b",
        failing_check="c",
        error_signature="e",
    )
    base.update(kw)
    return GenomicIncident(**base)


def test_adjudication_verdict_values_are_stable():
    assert {v.value for v in AdjudicationVerdict} == {
        "AGREE_PASS",
        "AGREE_FAIL",
        "DISAGREE",
        "INCONCLUSIVE",
        "TOOL_ERROR",
    }
    assert AdjudicationVerdict("DISAGREE") is AdjudicationVerdict.DISAGREE
    with pytest.raises(ValueError):
        AdjudicationVerdict("agree_pass")


def test_mutable_defaults_are_not_shared_between_instances():
    a = ToolInvocationResult(tool_id="x")
    b = ToolInvocationResult(tool_id="x")
    a.findings.append({"k": 1})
    a.output_artifact_hashes.append("h")
    assert b.findings == [] and b.output_artifact_hashes == []
    m1 = ScientificToolManifest(name="n", description="d")
    m2 = ScientificToolManifest(name="n", description="d")
    m1.accepted_formats.append("bed")
    m1.resource_budget["timeout_sec"] = 1.0
    assert "bed" not in m2.accepted_formats
    assert m2.resource_budget["timeout_sec"] == 15.0
    req1, req2 = ToolInvocationRequest(tool_id="t", artifact_id_or_path="p"), ToolInvocationRequest(
        tool_id="t", artifact_id_or_path="p"
    )
    req1.arguments["x"] = 1
    assert req2.arguments == {}


def test_manifest_defaults_are_read_only_and_deterministic():
    m = ScientificToolManifest(name="n", description="d")
    assert m.permission_level == "read_only"
    assert m.deterministic is True
    assert m.resource_budget == {"timeout_sec": 15.0, "max_memory_mb": 512}


def test_required_fields_are_enforced():
    with pytest.raises(ValidationError):
        ToolInvocationRequest(tool_id="t")
    with pytest.raises(ValidationError):
        _incident(run_id=None)
    with pytest.raises(ValidationError):
        EvidenceReceiptV8(
            receipt_id="r",
            run_id="r",
            incident_id="i",
            candidate_hash="h",
            dual_validator_agreement="NOT_A_VERDICT",
            decision="PROMOTED",
            receipt_digest="d",
        )


def test_incident_created_at_is_utc_iso_and_per_instance():
    before = datetime.now(timezone.utc) - timedelta(seconds=1)
    inc = _incident()
    stamp = datetime.fromisoformat(inc.created_at)
    assert stamp.tzinfo is not None and stamp.utcoffset() == timedelta(0)
    assert before <= stamp <= datetime.now(timezone.utc) + timedelta(seconds=1)
    assert inc.status == "INVESTIGATING"
    assert inc.disagreement_detected is False


def test_models_roundtrip_through_json():
    inc = _incident(status="QUARANTINED", disagreement_detected=True)
    assert GenomicIncident.model_validate(inc.model_dump(mode="json")) == inc
    patch = HarnessCandidatePatch(
        patch_id="p",
        parent_version_id="a",
        candidate_version_id="b",
        optimizer_source="DETERMINISTIC",
        policy_diff={"x": [1, 2]},
        canonical_hash="h",
    )
    assert HarnessCandidatePatch.model_validate(patch.model_dump(mode="json")) == patch
    run = EvaluationRun(
        eval_id="e",
        run_id="r",
        parent_version="a",
        candidate_version="b",
        parent_score="0/2",
        candidate_score="2/2",
        promoted=True,
        safety_gates=[SafetyGateOutcome(gate_id="g", passed=True, reason="Passed")],
    )
    assert EvaluationRun.model_validate(run.model_dump(mode="json")) == run
    chk = ScientificCheckResult(validator_id="v", tool_version="1", status="PASS", check_id="c")
    assert chk.locus is None and chk.details == {} and chk.message == ""
    health = ExternalIntegrationHealth(name="n", status="NOT_CONFIGURED")
    assert health.mode == "sandbox" and health.version == "unknown"


def test_receipt_enum_serialises_as_value_and_roundtrips():
    r = EvidenceReceiptV8(
        receipt_id="r",
        run_id="r",
        incident_id="i",
        candidate_hash="h",
        dual_validator_agreement="AGREE_PASS",
        safety_gates={"g": True},
        decision="PROMOTED",
        receipt_digest="d",
    )
    dumped = r.model_dump(mode="json")
    assert dumped["dual_validator_agreement"] == "AGREE_PASS"
    assert EvidenceReceiptV8.model_validate(dumped) == r
    assert datetime.fromisoformat(r.created_at).tzinfo is not None


def test_receipt_digest_verifies_and_detects_tampering_after_json_roundtrip():
    receipt = mint_v8_receipt(
        run_id="run-1",
        incident_id="inc-1",
        candidate_hash="hash",
        dual_validator_agreement=AdjudicationVerdict.AGREE_PASS,
        safety_gates={"b": True, "a": True},
        decision="PROMOTED",
    )
    restored = EvidenceReceiptV8.model_validate(receipt.model_dump(mode="json"))
    assert verify_v8_receipt(restored)
    flipped = restored.model_copy(update={"safety_gates": {"b": True, "a": False}})
    assert not verify_v8_receipt(flipped)
    assert not verify_v8_receipt(restored.model_copy(update={"decision": "REJECTED"}))
