# Audit: route_v8 (services/api/app/routes/v8.py)

## FIXED
None. No defect was reproduced with a failing test, so the source file was not changed.

## UNVERIFIED/NEEDS OTHER OWNER
- v8.py:19 `_artifact_dir()` returns the CWD-relative `Path("artifacts/v8")`. Started from another working directory, `/api/v8/latest` reports `NOT_RUN` even though artifacts exist. The rest of the backend uses the same CWD-relative convention (`resolve_fixture_path`, `EbiVcfValidator.DEFAULT_*_PATH`) and the Makefile starts the API from the repo root, so it was left as is. Anchoring it would be a cross-cutting convention change.
- v8.py:55-58, 62, 76 Malformed recorded artifacts give an unhandled 500 (`JSONDecodeError`, or `KeyError`/`TypeError` for a missing `receipt_id`, `decision` or `dual_validator_agreement`, a missing lineage node `id`, or a non-dict receipt). The 500 body is generic and leaks nothing. The correct status or contract is a design decision, so no change. `experiment._write` (services/runtime/v8/experiment.py:37-39, owned by v8_experiment) uses non-atomic `write_text`. A request that lands during `make demo-v8` could therefore see a truncated file, or mixed receipt, lineage and metrics from different runs. That race was not reproduced.
- v8.py:48-76 `/latest` reports `RECORDED` without recomputing the receipt digest or surfacing `fingerprint_verified` and `safety_gates` from the file. Verification is left to the client, which has a DigestVerifier. This is an enhancement, not a defect.
- v8.py:23-46 `v8_health` is `async def` but does blocking work: it hashes two roughly 7 MB binaries twice (`checksums_match` runs again inside `get_version` via `is_available`) and may spawn a subprocess with a 5s timeout. Measured at about 100 ms per call, which stalls the event loop for that long. Not a correctness bug, so no change. The extra hashing is in services/integrations/ebi_vcf/validator.py (int_ebi owner).
- v8.py:33-37 The `biomni` status is a hard-coded `CONNECTED`. It is not probed, which fits ADR-014's local read-only adapter, but the status is static.

## VERIFIED OK
- `/latest` returns `NOT_RUN` with all-null fields when `evidence_receipt.json` is absent. It never invents a receipt (ADR-019).
- The `receipt` view maps every field from the recorded receipt and metadata. `false_positive_rate` is guarded against division by zero. A `None` score, `None` candidate id or `None` decision_reason falls back to `"0/0"`, `""` and the decision. `promoted` is derived from `decision == "PROMOTED"`. The missing-file branches of lineage, metrics and diff return `None`.
- Lineage edges are built only for nodes with a truthy `parent_id`, and the order is deterministic.
- No ObjectId or `_id` key reaches the response (ADR-004). The route only reads the artifact directory and never writes to it.
- `/health` marks EBI `FAILED` and the version `unavailable` when checksums do not match. Sponsors show `NOT_CONFIGURED` without credentials (ADR-018). Biomni agent execution is `DISABLED` (ADR-014). The proposer is `DETERMINISTIC` and `meta_harness_imported` is false (ADR-015).
- The route reads no request-controlled paths (no path parameters or query input), so there is no traversal or SSRF surface.
- Tests: services/tests/test_audit_route_v8.py (7 tests, offline, no Mongo, tmp_path only). No existing test imports routes/v8.py. test_api_routes.py also passes.
