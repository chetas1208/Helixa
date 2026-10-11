import pytest

from services.integrations.contracts import AdjudicationVerdict
from services.runtime.evidence.proof_receipt import (
    canonical_body,
    compute_v8_receipt_digest,
    fingerprint_receipt,
    mint_v8_receipt,
    verify_v8_receipt,
)

GATES = {"holdout_isolated": True, "input_not_rewritten": True, "unsafe_candidate_rejected": False}


def _mint(**overrides):
    kwargs = {
        "run_id": "run-1",
        "incident_id": "inc-1",
        "candidate_hash": "a" * 64,
        "dual_validator_agreement": AdjudicationVerdict.AGREE_PASS,
        "safety_gates": dict(GATES),
        "decision": "PROMOTED",
    }
    kwargs.update(overrides)
    return mint_v8_receipt(**kwargs)


def test_minted_receipt_verifies_and_is_deterministic():
    first, second = _mint(), _mint()
    assert verify_v8_receipt(first) is True
    assert first.receipt_digest == second.receipt_digest
    assert first.receipt_id == second.receipt_id


def test_gate_key_order_does_not_change_digest():
    reordered = dict(reversed(list(GATES.items())))
    assert _mint(safety_gates=reordered).receipt_digest == _mint().receipt_digest


@pytest.mark.parametrize(
    "field,value",
    [
        ("decision", "REJECTED"),
        ("candidate_hash", "b" * 64),
        ("run_id", "run-2"),
        ("incident_id", "inc-2"),
        ("dual_validator_agreement", AdjudicationVerdict.AGREE_FAIL),
        ("safety_gates", {**GATES, "holdout_isolated": False}),
    ],
)
def test_tampering_with_bound_field_is_detected(field, value):
    receipt = _mint()
    assert verify_v8_receipt(receipt.model_copy(update={field: value})) is False


def test_minted_receipt_verifies_when_gate_values_are_coerced_by_the_model():
    receipt = _mint(safety_gates={"holdout_isolated": 1, "input_not_rewritten": 0})
    assert receipt.safety_gates == {"holdout_isolated": True, "input_not_rewritten": False}
    assert verify_v8_receipt(receipt) is True


def test_digest_is_identical_for_enum_and_plain_verdict():
    plain = compute_v8_receipt_digest("r", "i", "c", "AGREE_PASS", {}, "PROMOTED")
    enum = compute_v8_receipt_digest("r", "i", "c", AdjudicationVerdict.AGREE_PASS, {}, "PROMOTED")
    assert enum == plain


def test_fingerprint_ignores_holdout_order_and_extra_fields():
    base = {"run_id": "r", "holdout_case_ids": ["b", "a"], "promoted": True}
    other = {"promoted": True, "holdout_case_ids": ["a", "b"], "run_id": "r", "noise": 1}
    assert fingerprint_receipt(base) == fingerprint_receipt(other)
    assert canonical_body(base)["holdout_case_ids"] == ["a", "b"]
    assert canonical_body({})["holdout_case_ids"] == []
    assert fingerprint_receipt({**base, "promoted": False}) != fingerprint_receipt(base)
