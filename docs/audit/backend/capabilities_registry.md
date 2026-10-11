# Audit: capabilities_registry (services/runtime/capabilities/*)

Tests: `services/tests/test_audit_capabilities_registry.py` (uses a uniquely named collection in `$MONGODB_DATABASE`, dropped on teardown).

## FIXED
1. `registry.py:73,88,102,110,118` (`register_macro`, `activate_capability`, `quarantine_capability`, `get_capability`, `list_capabilities`): `if self.collection:` truth-tests the injected collection. PyMongo `AsyncCollection.__bool__` raises `NotImplementedError`, so every registry operation crashed whenever a real Mongo collection was supplied. Failing test: `test_registry_with_real_collection_register_activate_quarantine` (and the two real-collection fitness tests). Fix: `is not None`.
2. `registry.py` `register_macro`: a macro whose `macro_id` equals a built-in primitive id (e.g. `run_validation`) silently replaced the immutable ACTIVE primitive with a DRAFT macro record. Failing test: `test_register_macro_cannot_shadow_builtin_primitive`. Fix: raise `InvalidMacroError` when the id is in the PolicyEnvelope whitelist or already names a primitive record (route maps this to 400).
3. `fitness.py` `record_execution`: with a Mongo-backed registry, `total_executions` / `failed_executions` / `fitness_score` were mutated on a freshly loaded copy and never persisted, so counters never accumulated and the auto-quarantine threshold could never be reached. Failing tests: `test_fitness_counters_persist_with_real_collection`, `test_fitness_auto_quarantine_with_real_collection`. Fix: `$set` the three fields on the registry collection (no-op for in-memory primitives, which are mutated in place).

## UNVERIFIED/NEEDS OTHER OWNER
- `macro_schema.py:47`: forbidden-substring check includes `"sh"`, `"exec"`, `"eval"` as raw substrings, so benign values (`sha256`, `hash`, `execution_id`, `evaluation`) are rejected (fail-closed). Tightening to token matching would be a security-behavior change; not changed (also noted by route_investigations_capabilities).
- `macro_schema.py:45-53`: only `argument_mapping` keys/values are scanned; `step_id`, `output_key`, guard `condition_key`/`expected_value`, `name`, `description` are not. No interpreter of macros exists in the tree (grep: no consumer of `guards`/`argument_mapping`), so exploitability is unproven.
- `macro_schema.py` `MacroGuard.operator` / `on_violation` are free strings (documented vocab not enforced); `DeclarativeMacro` accepts empty `steps`. No consumer; not changed.
- `registry.py:95` `quarantine_capability(reason=)` accepts but never records the reason (no field on `CapabilityRecord`); needs a model change.
- `registry.py` `register_macro` re-registering an existing macro id resets it to DRAFT with zeroed counters (including a QUARANTINED one); `activate_capability` can reactivate QUARANTINED/RETIRED records and primitives can be quarantined. No state machine or ADR specifies otherwise.
- `registry.py:121` `list_capabilities` (Mongo mode) silently caps at 100 (`to_list(length=100)`), is unsorted, and omits built-in primitives (memory mode includes them). Looks like a deliberate bound; not changed.
- `fitness.py`: read-modify-write of counters is not atomic across concurrent Mongo-backed callers (lost updates possible; an `$inc` would be needed). Not reproduced deterministically. `quarantine_failure_threshold <= 0` is unvalidated and quarantines on the first execution.
- `miner.py:42`: macro id is `sha256("-".join(tools))[:8]`: 32-bit truncation and `-` joining can collide (tool names containing `-`), and a collision silently overwrites in `register_macro`. Miner also does not check that the trajectory succeeded (caller responsibility); no producer of `tool.invocation` events exists outside tests.

## VERIFIED OK
- Unsafe-construct and unauthorized-primitive rejection (V7-ADR-002), both `required_primitives` and per-step tool checked against the PolicyEnvelope whitelist.
- In-memory register/activate/quarantine/list/get semantics and status filtering; `KeyError` for unknown ids.
- Fitness score math and in-memory auto-quarantine at threshold (ACTIVE only).
- Miner determinism (stable ids/steps/order), <2 invocations -> None, non-invocation events ignored.
- Mongo-mode documents round-trip through `CapabilityRecord` (`_id` stripped, enum values serialize as strings, status filter works).
- `__init__.py` exports match module contents.
