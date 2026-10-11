# Audit: route_investigations_capabilities

Files: `services/api/app/routes/investigations.py`, `services/api/app/routes/capabilities.py`.
Tests: `services/tests/test_audit_route_investigations_capabilities.py`.

## FIXED

1. `investigations.py` (`investigate_run`, now `_resolve_input_file`): `vcf_path` / `fasta_path` accepted any server filesystem path. A request with `/etc/hostname` returned 200 with that file's SHA-256 and a validator verdict (arbitrary-file read/hash oracle). Failing tests: `test_investigate_rejects_vcf_outside_allowed_roots`, `test_investigate_rejects_fasta_outside_allowed_roots`, `test_investigate_rejects_traversal_out_of_fixtures`. Fix: resolved path must lie inside `config.fixtures_dir` or `artifacts/cas` (the two CAS/fixture roots from ADR-008), else 400. Paths with an internal `..` that stay inside the root still work (`test_investigate_allows_fixture_with_internal_dotdot_that_stays_inside_root`).
2. `investigations.py`: existence was checked with `exists()`, so a directory path (`fixtures/invalid`, `fixtures/references`) passed and crashed in `compute_sha256` with `IsADirectoryError` -> HTTP 500. Failing test: `test_investigate_directory_is_404_not_500`. Fix: `is_file()` check -> 404.
3. `investigations.py`: a NUL byte in a path made `Path.resolve()` raise `ValueError` -> HTTP 500. Failing test: `test_investigate_nul_byte_path_is_client_error`. Fix: caught -> 400.
4. `investigations.py` (`EvolveRequest`): `failure_finding.details` of a non-string type (`5`, `null`, list) reached `FailureTraceReflector.reflect_on_discrepancy` (`"out of bounds" in details`) and raised `TypeError` -> HTTP 500. Failing test: `test_evolve_rejects_non_string_details_with_422`. Fix: field validator rejects a non-string `details` with 422. (The reflector itself belongs to the optimization unit and was not edited.)
5. `capabilities.py` (`activate_capability`, `quarantine_capability`): `detail=str(e)` on a `KeyError` yields the repr, so the 404 body was `"\"Capability 'x' not found.\""` (extra quotes), inconsistent with `GET /{capability_id}`. Failing test: `test_capabilities_not_found_detail_has_no_repr_quotes`. Fix: `str(e.args[0])`.

## UNVERIFIED/NEEDS OTHER OWNER

- `main.py:94,101` / `runs.py:63` / `investigations.py` `POST /{run_id}/evolve`: both `runs.router` and `investigations.router` define `POST /api/runs/{id}/evolve`. `runs.router` is included first, so it always wins; the investigations `evolve` handler is unreachable through the app. Reproduced: an app with `runs.router` then `investigations.router` answers `POST /api/runs/x/evolve` with runs' `404 Run 'x' not found`. OpenAPI lists both operations. Fixing needs a path rename (api_core / route_runs owners, and the frontend `useRunActions.ts` calls `/api/runs/{id}/evolve` expecting the runs behavior), so I did not touch it.
- `capabilities/registry.py:52-72` (owner capabilities_registry): `register_macro` can overwrite a built-in primitive record if `macro_id` equals a whitelisted primitive id (e.g. `run_validation`), replacing the ACTIVE primitive with a DRAFT macro. Not reproduced through a test in my unit because the fix belongs in the registry.
- `capabilities/macro_schema.py:47` (owner capabilities_registry): the forbidden substring `"sh"` matches any value containing `sh` (e.g. `hash`, `finish`), rejecting benign macros via `POST /api/capabilities/register`. Not changed.
- `capabilities/registry.py:95` (owner capabilities_registry): `quarantine_capability(reason=...)` accepts the `reason` query parameter but never stores it; the route passes it through unchanged.
- `capabilities/registry.py:81`: `activate_capability` can reactivate a QUARANTINED capability, and primitives can be quarantined/activated via the API. Possibly intentional; no ADR forbids it.
- `investigations.py` `investigate_run` / `evolve_harness`: CPU- and IO-bound synchronous work (pysam validation, SHA-256) runs directly inside `async def` handlers and blocks the event loop. Latency issue, not a correctness defect; not changed.
- No authentication on the mutating `/api/capabilities/*` endpoints (api_core / security_review scope).
- `investigations.py`: `run_id` is not checked against stored runs, so any string is accepted and echoed. The endpoint is stateless (nothing persisted), so I left it as is.

## VERIFIED OK

- `investigate_run` happy path, default fixture paths, response shape (no ObjectId, no raw sequence); missing file -> 404.
- `evolve_harness`: candidate generation is deterministic, uses the baseline harness and `PolicyEnvelope`-checked branches; empty `failure_finding` yields `UNKNOWN_INTEGRITY_FAILURE` safely.
- Capabilities list/get/register/activate/quarantine flow; invalid `status` filter -> 422; unauthorized primitive and `eval` constructs -> 400 (ADR V7-002 preserved).
- Module-level `investigator` / `optimizer` / `candidate_search` are stateless; the module-level capability `registry` is in-memory (tests monkeypatch a fresh one).
