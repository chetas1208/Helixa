# new_fixtures_endpoint

New file: `services/api/app/routes/fixtures.py` (router, prefix `/api`) implementing `GET /api/fixtures`. Tests: `services/tests/test_audit_new_fixtures_endpoint.py`.

## FIXED
None (new endpoint; no pre-existing code was changed). Defect classes were designed out and are covered by tests:
- Path safety: root is derived from `__file__`, not user input; no query/path parameters; `os.walk(followlinks=False)`, symlinked files/dirs skipped (`test_symlinks_are_not_followed`, `test_no_query_parameter_can_alter_listing`).
- Only `.vcf` / `.vcf.gz` basenames returned; names with glob metacharacters (`*?[]`) are skipped because `resolve_fixture_path` globs by basename and could not resolve them (`test_glob_metacharacter_names_skipped`).
- Duplicate basenames are listed once, preferring the directory `resolve_fixture_path` checks first (valid, invalid, heldout, then the rest) (`test_duplicate_basename_listed_once_with_resolver_priority`).
- Held-out: `fixtures/heldout/*` and the `fixtures/v7/cases` files named in `sealed_holdout_manifest.json` get category `heldout` with a fixed generic description (no expected outcome). If that manifest is missing, oversized, symlinked or malformed, all v7 cases are omitted (fail closed) (`test_untrusted_sealed_manifest_hides_v7_cases`, `test_missing_sealed_manifest_hides_v7_cases`, `test_heldout_descriptions_do_not_leak_outcomes`).
- Deterministic order: sorted by relative path (`test_deterministic_order`, `test_synthetic_tree_filtering_and_categories`).

## UNVERIFIED/NEEDS OTHER OWNER
- `services/api/app/routes/validation.py:19-41` (`resolve_fixture_path`): resolves relative to the process cwd and accepts any existing path via `Path(filename)` as the first candidate, so `vcf_filename` can be an arbitrary server path (path traversal / arbitrary-file read into the validator). Not part of this unit; belongs to route_validation / security_review.
- `services/api/app/main.py`: the router is not included yet; api_core owns that include (`from .routes import fixtures`; `app.include_router(fixtures.router)`).
- Category choice: `ref_mismatch.vcf` under `fixtures/invalid` is reported as `incident` (the incident target used by the UI and `holdout.py`); other v7 non-sealed cases are `other`. This follows the contract's category set but is a judgment call.
- v7 sealed holdout names such as `13_stale_reference.vcf` still reveal the failure family by filename; the contract says names only, so this was left unchanged.

## VERIFIED OK
- Response shape `{"fixtures":[{name,category,description}]}` matches the contract; every listed name resolves through `resolve_fixture_path` when cwd is the repo root (`test_real_fixtures_listed_and_resolvable`).
- Missing fixtures root returns an empty list rather than an error.
- Endpoint is a sync `def` (runs in the threadpool), does no Mongo or network access, and never reads fixture contents (only the sealed manifest, capped at 1 MiB).
- `ruff check` clean; existing `test_api_routes.py` still passes.
