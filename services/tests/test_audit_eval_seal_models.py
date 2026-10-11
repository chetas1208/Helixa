from __future__ import annotations

import json

import pytest

from services.runtime.evaluation import EvaluationResult, EvidenceReceipt
from services.runtime.evaluation.seal import EvidenceSealV1, verify_evidence_seal


def _seal(**overrides) -> EvidenceSealV1:
    kwargs = {
        "seal_id": "seal-audit-1",
        "run_id": "run-audit-1",
        "parent_harness_id": "parent",
        "candidate_harness_id": "candidate",
        "mutation_hash": "a" * 64,
        "input_manifest_hash": "b" * 64,
        "suite_hash": "c" * 64,
        "environment_manifest_hash": "d" * 64,
        "case_result_ids": ["case-1"],
        "safety_gate_results": {"policy_envelope_compliance": True},
        "metric_summary": {"score": "6/6"},
        "decision": "PROMOTED",
        "decision_reason": "audit",
    }
    kwargs.update(overrides)
    return EvidenceSealV1.create(**kwargs)


@pytest.mark.parametrize("decision", ["promoted", "Promoted", "PROMOTED ", "LGTM", ""])
def test_unrecognized_decision_does_not_bypass_safety_gate_check(decision):
    seal = _seal(decision=decision, safety_gate_results={"policy_envelope_compliance": False})

    valid, msg = verify_evidence_seal(seal)

    assert valid is False
    assert "Integrity violation!" in msg


def test_unrecognized_decision_never_verifies_as_authentic():
    valid, _ = verify_evidence_seal(_seal(decision="approved"))

    assert valid is False


def test_rejected_seal_with_failed_gate_still_verifies():
    seal = _seal(decision="REJECTED", safety_gate_results={"policy_envelope_compliance": False})

    assert verify_evidence_seal(seal)[0] is True


def test_non_finite_metric_cannot_mint_unverifiable_seal():
    # JSON persistence turns NaN into null, so a hash over NaN could never be re-verified.
    with pytest.raises(ValueError):
        _seal(metric_summary={"false_positive_rate": float("nan")})


def test_tampering_with_non_finite_value_reports_tamper_not_exception():
    seal = _seal()
    tampered = seal.model_copy(deep=True)
    tampered.metric_summary = {"score": float("inf")}

    valid, msg = verify_evidence_seal(tampered)

    assert valid is False
    assert "Tamper detected!" in msg


def test_persisted_seal_roundtrip_verifies():
    seal = _seal(metric_summary={"x": "é", "t": (1, 2), "big": 10**30, "f": 1e-7, "n": {"a": [1, None]}})

    restored = EvidenceSealV1(**json.loads(seal.model_dump_json()))

    assert restored.seal_hash == seal.seal_hash
    assert verify_evidence_seal(restored)[0] is True


def test_seal_hash_is_stable_for_finite_values():
    # Canonical digest for a fixed seal must not change across versions.
    seal = EvidenceSealV1(
        seal_id="s",
        run_id="r",
        parent_harness_id="p",
        candidate_harness_id="c",
        mutation_hash="m",
        input_manifest_hash="i",
        suite_hash="u",
        environment_manifest_hash="e",
        decision="REJECTED",
        decision_reason="x",
        created_at="2026-01-01T00:00:00+00:00",
    )

    assert seal.compute_canonical_hash() == "16e67d1d05379dfaf52bc1b19ee0e5e715d23f2f9235d03c45c6363c14d509ad"


def test_receipt_digest_deterministic_and_binds_core_fields():
    result = EvaluationResult(
        candidate_version_id="c",
        parent_version_id="p",
        score_numerator=6,
        score_denominator=6,
        parent_score_numerator=4,
        parent_score_denominator=6,
        false_positive_rate=0.0,
        envelope_compliance=True,
        promoted=True,
        decision_reason="ok",
    )

    def make(**kw):
        args = {
            "receipt_id": "r1",
            "run_id": "run",
            "eval_result": result,
            "parent_hash": "ph",
            "candidate_hash": "ch",
            "evaluator_hash": "eh",
            "input_hashes": ["h1"],
            "timestamp": "2026-01-01T00:00:00+00:00",
        }
        args.update(kw)
        return EvidenceReceipt.create(**args)

    base = make()
    assert base.receipt_digest == make().receipt_digest
    assert len(base.receipt_digest) == 64
    assert base.receipt_digest != make(candidate_hash="other").receipt_digest
    assert base.receipt_digest != make(run_id="run2").receipt_digest
    assert base.score == "6/6" and base.parent_score == "4/6"
