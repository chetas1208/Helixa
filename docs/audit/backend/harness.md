# harness audit (services/runtime/harness/*)

## FIXED
- None. No defect was reproduced with a failing test, so no source file was changed. `services/tests/test_audit_harness.py` (9 tests) pins the verified behavior (all pass on current code).

## UNVERIFIED/NEEDS OTHER OWNER
- models.py:72-104 `PolicyEnvelope.validate_candidate`: enforces only ceilings. `max_attempts`, `max_context_items` and `checkpoint_every_steps` of 0 or negative pass the envelope (pydantic fields are plain `int`). No consumer in services/ divides by or loops on these (runner.py does not read them; search adapters clamp with `max(1, ...)`), so no harm was demonstrated and the envelope contract only names ceilings. Not changed.
- models.py:72-76 `PolicyEnvelope` is documented "Immutable" but is a non-frozen model, and `immutable_allowed_tools_whitelist` is a mutable list. Candidates have no handle on the envelope instance (consumers construct their own), so no tamper path was found. Freezing would be a behavior change; not changed.
- models.py:62-64 / 66-70 `canonical_json` / `stable_version_id` hash `allowed_tools` in list order, so a reordered or duplicated tool list yields a different hash/id for a semantically identical candidate. All in-repo generators deep-copy the parent, so no reproduced dedup failure. Not changed.
- models.py `HarnessSpec` has no `validate_assignment`: in-place assignment (used by scripts/audit_system.py and the search adapters) bypasses type validation. `validate_candidate` would raise TypeError on a non-int assigned value rather than return `(False, reason)`. Reachable only by code assigning wrong types, not from deserialized input (which is validated). Not changed.
- Callers (not this unit): evolution/search_adapter.py and gepa_adapter.py copy `metadata` from the parent into candidates via deepcopy, so `parent_spec_hash` provenance is only set by `create_candidate_mutation`.

## VERIFIED OK
- baseline.py: `get_baseline_harness` returns a fresh object per call (no shared mutable lists/dicts); intentionally deficient `require_reference_allele_check=False`; status BASELINE, no parent.
- baseline.py `create_candidate_mutation`: shallow `model_copy` of flat-bool/int sub-policies and a copied tool list never alias or mutate the parent; no duplicate tools; extra tools all lie within the envelope whitelist; flags-off inherits parent policy; `parent_spec_hash` metadata matches the parent hash.
- models.py `compute_spec_hash`: deterministic (sorted keys), excludes only status and metadata, stable across a `model_dump(mode="json")` round trip.
- models.py `stable_version_id`: independent of version_id, status, metadata, parent_version_id in the token; changes with any policy change; role and parent prefix applied correctly.
- models.py `PolicyEnvelope.validate_candidate`: ceilings are inclusive (limit passes, limit+1 fails with the expected message); unlisted tools rejected; default whitelist is a fresh list per instance.
- __init__.py exports match definitions.
