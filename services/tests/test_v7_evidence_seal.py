from __future__ import annotations

from services.runtime.evaluation.seal import EvidenceSealV1, verify_evidence_seal


def test_evidence_seal_creation_and_verification():
    seal = EvidenceSealV1.create(
        seal_id="seal-v7-001",
        run_id="run-test-123",
        parent_harness_id="harness-v1-baseline",
        candidate_harness_id="harness-v2-candidate",
        mutation_hash="a" * 64,
        input_manifest_hash="b" * 64,
        suite_hash="c" * 64,
        environment_manifest_hash="d" * 64,
        case_result_ids=["01_correct_snv", "02_ref_mismatch"],
        safety_gate_results={
            "policy_envelope_compliance": True,
            "negative_control_preservation": True,
            "heldout_transfer_satisfied": True,
        },
        metric_summary={"score": "6/6", "promoted": True},
        decision="PROMOTED",
        decision_reason="Verified by independent oracle.",
    )

    assert len(seal.seal_hash) == 64
    valid, msg = verify_evidence_seal(seal)
    assert valid is True
    assert "authentic, untampered" in msg


def test_evidence_seal_tamper_detection():
    seal = EvidenceSealV1.create(
        seal_id="seal-v7-002",
        run_id="run-test-124",
        parent_harness_id="harness-v1-baseline",
        candidate_harness_id="harness-v2-candidate",
        mutation_hash="a" * 64,
        input_manifest_hash="b" * 64,
        suite_hash="c" * 64,
        environment_manifest_hash="d" * 64,
        case_result_ids=["01_correct_snv"],
        safety_gate_results={"policy_envelope_compliance": True},
        metric_summary={"score": "5/6"},
        decision="REJECTED",
        decision_reason="Insufficient score.",
    )

    # Adversarial tampering: modify decision to PROMOTED without recomputing hash
    tampered_seal = seal.model_copy(deep=True)
    tampered_seal.decision = "PROMOTED"

    valid, msg = verify_evidence_seal(tampered_seal)
    assert valid is False
    assert "Tamper detected!" in msg


def test_evidence_seal_rejects_promotion_with_failed_safety_gate():
    # If someone tries to create a PROMOTED seal while a safety gate is False
    seal = EvidenceSealV1.create(
        seal_id="seal-v7-003",
        run_id="run-test-125",
        parent_harness_id="harness-v1-baseline",
        candidate_harness_id="harness-v2-candidate",
        mutation_hash="a" * 64,
        input_manifest_hash="b" * 64,
        suite_hash="c" * 64,
        environment_manifest_hash="d" * 64,
        case_result_ids=["01_correct_snv"],
        safety_gate_results={
            "policy_envelope_compliance": False,  # Failed!
        },
        metric_summary={"score": "6/6"},
        decision="PROMOTED",
        decision_reason="Attempted bypass",
    )

    valid, msg = verify_evidence_seal(seal)
    assert valid is False
    assert "Integrity violation!" in msg
