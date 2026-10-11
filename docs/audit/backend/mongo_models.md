# Audit: mongo_models (services/integrations/mongodb/models.py)

## FIXED
1. `services/integrations/mongodb/models.py:67` (`validate_state_transition`): the `InvalidStateTransitionError` message listed allowed targets by iterating a `set` of str-Enums, so the order depended on `PYTHONHASHSEED`. The message is surfaced to API clients (e.g. 422 detail in routes/runs.py) and logs, so identical requests returned different bodies across processes. Failing tests (before fix): `test_illegal_transition_message_is_deterministic_across_hash_seeds`, `test_illegal_transition_message_lists_allowed_targets_sorted` in `services/tests/test_audit_mongo_models.py`. Fix: `sorted(s.value for s in allowed)`. No other behavior changed; the "Illegal state transition" prefix is unchanged.

## UNVERIFIED/NEEDS OTHER OWNER
- `models.py:45-59` (`ALLOWED_RUN_TRANSITIONS`): `PAUSED` has no edge to `FAILED`, so a paused run can only be cancelled or resumed. Looks like a design choice; no caller or ADR shows it is wrong. Not changed.
- `models.py:61-63`: `validate_state_transition(X, X)` returns silently, including for terminal states (`COMPLETED`, `FAILED`, `CANCELLED`), while the table says terminals have no outgoing edges. `RunRepository.transition_state` would then rewrite `status`/`updated_at` of a terminal run. Possibly deliberate idempotency for resume; owner `mongo_repo_tasks_runs` / `orch_runner` should decide. Not changed.
- `models.py:45`: `ALLOWED_RUN_TRANSITIONS` is a mutable module-level dict of mutable sets, so a runtime mutation could weaken the state machine. No code mutates it today; no evidence of a defect.
- `models.py:215` (`EvidenceReceiptModel.fixtures_evaluated = 6`): the default asserts six fixtures were evaluated if a caller omits it. The only constructor (runner.py:322) passes `len(receipt.input_hashes)`, so no wrong value is produced today. Changing the default could break readers of older documents; left as is.
- No numeric bounds (`fence_token`, `seq`, `byte_size`, `false_positive_rate`, `step_index`) and no `extra="forbid"`. All models are constructed internally or from already-validated route data (route validation belongs to other units); no failing input was reproduced.
- `models.py:33` vs `services/runtime/harness/models.py:11`: two `HarnessStatus` enums with different members (runtime also has `EVALUATING`, `ROLLED_BACK`). `ROLLED_BACK`/`EVALUATING` are unused anywhere in services, scripts or the web app, so no crash today; persisting a spec with those statuses via `HarnessVersionModel` would raise a ValidationError (owner: `harness` / `mongo_*`).
- `validate_state_transition` assumes enum arguments; a plain-string target would raise `AttributeError` rather than `InvalidStateTransitionError`. All callers pass enums.

## VERIFIED OK
- Every `RunState` appears as a key in `ALLOWED_RUN_TRANSITIONS`; all states are reachable from `CREATED`; `COMPLETED`/`FAILED`/`CANCELLED` are closed (tested).
- The runner's and demo_chaos' transition sequences (CREATED->VALIDATING->DIAGNOSING->MUTATING->EVALUATING->PROMOTED/REJECTED, PROMOTED->COMPLETED) are all allowed.
- All 12 models round-trip `model_dump()` -> BSON encode/decode -> constructor with equality, including str-Enum fields (`status`, `state`), so `RunState`/`TaskStatus`/`HarnessStatus` persist as plain strings and rehydrate to enums (tested).
- Mutable defaults use `default_factory`; timestamps are per-instance ISO-8601 UTC strings.
- No `_id`/ObjectId fields on any model (ADR-004); fencing fields (`fence_token`, `seq_counter`) exist on Task/Run/Checkpoint consistent with ADR-002/003.
- Tests: `services/tests/test_audit_mongo_models.py` (4), plus `test_m01_durability.py`, `test_mongo_recovery.py`, `test_optimizer_gate.py` pass with `MONGODB_DATABASE=diamond_audit_mongo_models`; ruff clean.
