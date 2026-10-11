# Audit: artifacts (services/runtime/artifacts/*)

## FIXED
None. There is nothing to fix: `services/runtime/artifacts/` contains no files (no `__init__.py`, no modules, no `__pycache__`). `git log --all -- services/runtime/artifacts` returns no commits and `git ls-files` lists no tracked file there. No test file `services/tests/test_audit_artifacts.py` was created, because there is no code to test.

## UNVERIFIED/NEEDS OTHER OWNER
- services/runtime/artifacts/ (empty directory): a search of `*.py`, `*.md`, `*.toml`, `*.json` and the Makefile finds no import of `runtime.artifacts` or `runtime/artifacts` outside BACKEND_AUDIT.md, so nothing depends on the directory. Artifact handling lives in files owned by other units and was not audited here:
  - CAS storage and filename sanitization (ADR-008, traversal-hardening ADR) in services/runtime/genomics/ingestion.py (gen_ingestion).
  - Derived-artifact upserts into the `artifacts` collection in services/runtime/genomics/orchestrator.py:229-231 (gen_orchestrator).
  - The `artifacts` repository in services/integrations/mongodb/repositories/ (mongo_repo_rest).
  - Scratch/CAS defaults `artifacts/cas` and `artifacts/scratch` are relative paths (ingestion.py:32, orchestrator.py:53-54, bcftools_adapter.py:40), which depend on the process working directory. That is a possible concern for those owners, not verified here.
- If the contract meant this unit to cover one of those files, the unit mapping in BACKEND_AUDIT.md needs correcting. No file was edited on that guess.

## VERIFIED OK
- Directory contents: `ls -laR services/runtime/artifacts` shows only `.` and `..`.
- Git history: no commit on any ref has ever added a file under the path.
- No importers: no source, test, script or config file references the package, so there is no broken import or dead contract to report.
- No file outside docs/audit/backend/artifacts.md was created or edited.
