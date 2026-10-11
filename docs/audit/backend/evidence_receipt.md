# Audit: evidence_receipt (services/runtime/evidence/*)

## FIXED
1. `services/runtime/evidence/proof_receipt.py` `mint_v8_receipt`: the digest was computed from the raw `safety_gates` argument, but `EvidenceReceiptV8.safety_gates` is `dict[str, bool]` and pydantic coerces (`1` -> `True`, `0` -> `False`). The JSON bytes differ (`1` vs `true`), so a freshly minted receipt failed `verify_v8_receipt`. Test: `test_minted_receipt_verifies_when_gate_values_are_coerced_by_the_model`. Fix: build the model first, then digest the model's validated fields (same inputs `verify_v8_receipt` uses). Digests for already-valid inputs are unchanged.
2. `proof_receipt.py` `compute_v8_receipt_digest`: `str(AdjudicationVerdict.AGREE_PASS)` is `"AdjudicationVerdict.AGREE_PASS"`, so passing the enum directly gave a different digest than the plain value `"AGREE_PASS"`. Test: `test_digest_is_identical_for_enum_and_plain_verdict`. Fix: use `.value` when present.

## UNVERIFIED/NEEDS OTHER OWNER
- `proof_receipt.py` `compute_v8_receipt_digest`: the digest binds only run_id, incident_id, candidate_hash, verdict, safety_gates and decision. `receipt_id`, `metadata`, `created_at` are not bound, so `verify_v8_receipt` does not detect edits to them. Looks like a design choice (digests are quoted in PROGRESS.md/DECISIONS.md); changing the canonical form would invalidate recorded digests, so left alone.
- `mint_v8_receipt` receipt_id = hash of `f"{run_id}-{candidate_hash}"`: the `-` join is ambiguous (e.g. run "a-b"/hash "c" vs run "a"/hash "b-c") and does not include decision/incident. Candidate hashes are hex in practice; id is a label, not security-relevant. Not changed.
- `canonical_body` / `fingerprint_receipt` (legacy fingerprint; no callers outside `__init__`): `sorted(holdout_case_ids)` would split a bare string into characters or raise on mixed types; `json.dumps` accepts NaN. Inputs are internal dicts, so not reproduced as a real defect.
- `contracts.py:EvidenceReceiptV8.decision` is a free `str` (comment says PROMOTED/REJECTED); belongs to int_contracts owner.

## VERIFIED OK
- Digest is deterministic and independent of gate key order (`test_gate_key_order_does_not_change_digest`).
- Tampering with any bound field (decision, candidate_hash, run_id, incident_id, verdict, a gate) is detected by `verify_v8_receipt`.
- `fingerprint_receipt` is order-insensitive for `holdout_case_ids`, ignores unlisted fields, and reacts to changed fields.
- Existing consumers (`holdout.py`, `v8/experiment.py`, `scripts/verify_v8.py`, `test_transfer_ablation.py`) pass unchanged.
