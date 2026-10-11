# route_seals audit (services/api/app/routes/seals.py)

## FIXED
1. seals.py:20-50 (original), `get_evidence_seal` / `verify_seal_endpoint`: any unrecorded `seal_id` returned a fabricated PROMOTED demo seal with invented hashes and metrics ("+16.7%"), and `/verify` reported `is_valid: true` for it. A nonexistent seal verified as authentic. Same substitution pattern rejected by ADR-019. Tests: `test_unknown_seal_is_not_fabricated`, `test_unknown_seal_never_verifies_as_authentic`. Fix: unknown seal returns 404; the fabricated fallback is removed. Neither endpoint is used by scripts or the web app (grepped).
2. seals.py:17-20: an overlong `seal_id` (300 chars) made `Path.exists()` raise `OSError(ENAMETOOLONG)` and returned HTTP 500; characters outside the id grammar reached the filesystem. Test: `test_overlong_seal_id_is_not_found_not_server_error`. Fix: `seal_id` must fullmatch `[A-Za-z0-9._-]{1,128}` (existing seal ids conform), else 404; lookup uses `is_file()`.

## UNVERIFIED/NEEDS OTHER OWNER
- seals.py:13-14, :67: `SEALS_DIR` (import-time `mkdir`) and the manifest path are relative to the process cwd. Starting the API from another directory creates `artifacts/v7/seals` there and 404s `/experiments/v7`. Same cwd-relative convention as routes/validation.py `resolve_fixture_path`, so left unchanged.
- seals.py `verify_seal_endpoint`: a recorded seal file with invalid JSON or missing required fields raises (HTTP 500) instead of reporting `is_valid: false`. Desired response shape is a design choice, so not changed.
- seals.py `get_evidence_seal`: returns the raw file JSON, so extra keys in a stored file are served but are not covered by `compute_canonical_hash` (pydantic ignores extras in `verify`). The file's inner `seal_id` is not checked against the requested id.
- seals.py `list_v7_experiments`: `partitions` counts (5/9/2) are hardcoded rather than read from the dev/regression/sealed_holdout manifests; they match the manifests today (checked 5/9/2, total 16). A malformed manifest returns 500. Blocking file reads occur in `async` handlers (small files).
- seal.py (owner eval_seal_models): `verify_evidence_seal` only enforces gates for PROMOTED. A REJECTED seal with all gates true is also valid. Not examined as a defect.

## VERIFIED OK
- Path traversal via HTTP: `..%2F` ids do not resolve outside SEALS_DIR (`test_encoded_traversal_seal_id_is_not_found`).
- Round trip of a recorded seal: GET returns it, verify recomputes the matching hash (`test_recorded_seal_roundtrip_verifies`).
- Tampered recorded seal reports `is_valid: false` with differing hashes (`test_tampered_recorded_seal_reports_invalid`).
- `/experiments/v7` totals are consistent with the manifests and no held-out expected outcomes are exposed, only case ids, filenames, hashes and sizes (`test_experiments_v7_matches_manifests`).
- Ruff clean; existing tests test_v7_evidence_seal.py and test_api_routes.py pass.
