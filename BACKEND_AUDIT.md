# Backend audit contract (accuracy-first)

Repo: /home/923873155/Diamond_Proj (Python 3.12, venv `.venv`, FastAPI + PyMongo + pysam, local MongoDB on 127.0.0.1:27017 already running). Baseline: `.venv/bin/pytest -q services/tests` = 80 passed, `.venv/bin/ruff check services` clean. This is a proof-carrying scientific system: read /home/923873155/Diamond_Proj/DECISIONS.md (ADRs) and PROGRESS.md first. ADRs, scientific truth invariants, fencing/sequence guarantees, evidence sealing, held-out isolation and the research-use-only/no-clinical-claims stance are FROZEN: never weaken or change them.

## The bar: zero mistakes
1. You own ONLY the source files listed for your unit. You may also create exactly: `services/tests/test_audit_<unit>.py` and `docs/audit/backend/<unit>.md`. Never edit any other file. If a fix needs another unit's file, record it in your audit doc instead.
2. Audit your files line by line for REAL defects: logic errors, wrong edge cases, exception handling that swallows/leaks, unsafe input handling (path traversal, injection, unbounded reads, SSRF), race conditions, resource leaks, non-determinism where determinism is required, incorrect typing/contracts, missing validation at trust boundaries, inconsistencies with DECISIONS.md.
3. EVIDENCE-GATED FIXES ONLY. Change code only when you have reproduced the defect: write a test that FAILS on the current code (run it, see it fail), then fix minimally, then see it pass. No speculative refactors, no style rewrites, no renames, no new dependencies, no public signature/behavior changes beyond the bug. If you are not certain something is a bug, do NOT change it: list it as UNVERIFIED in your audit doc with file:line and reasoning.
4. Tests must be isolated and deterministic: run pytest with your own database: `MONGODB_DATABASE=diamond_audit_<unit> .venv/bin/pytest services/tests/test_audit_<unit>.py -q`; tests that touch Mongo must create/drop only their own uniquely named collections/db. Never touch the `diamond_genome` database, never use network, never write outside the repo or your tmp_path, never start/stop mongod.
4b. NEVER run git commands that modify state (stash, checkout, reset, restore, clean, commit, add, rebase, apply). Read-only git (diff, log, show, status) is fine. Other agents are editing files concurrently; a repo-wide git operation can destroy their work. Never run scripts that regenerate shared artifacts (e.g. scripts/audit_system.py, make verify-*, demo scripts). Never run the full suite expecting green: other units' tests are in progress.
5. Before finishing run: your test file, the existing tests that cover your files (grep services/tests for imports of your modules and run those with your own MONGODB_DATABASE), and `.venv/bin/ruff check <your files> services/tests/test_audit_<unit>.py` (and `ruff format --check` is NOT required). All must pass. Do not leave debug code.
6. Keep comments sparse and matching surrounding style.
7. `docs/audit/backend/<unit>.md` format: ## FIXED (each: file:line, defect, failing-test name, fix summary) ; ## UNVERIFIED/NEEDS OTHER OWNER (file:line, reasoning) ; ## VERIFIED OK (areas you checked and found correct, briefly). Write it even if you fixed nothing.
8. Final reply (max 4 lines): number fixed, number unverified, test command results.

## Cross-agent API contracts (for the two new-endpoint units)
- GET /api/fixtures -> {"fixtures":[{"name":"ref_mismatch.vcf","category":"invalid|valid|heldout|incident|other","description":str}]}: lists VCF fixtures under /home/923873155/Diamond_Proj/fixtures (basename names, which resolve via existing resolve_fixture_path in routes/validation.py). Path-safe, deterministic order, no traversal, only .vcf and .vcf.gz files, never expose held-out expected outcomes (names only).
- GET /api/runs/{run_id}/findings -> {"run_id":str,"findings":[{check_id,status,severity,message,locus?:{chrom,pos,ref,alt[]},metadata?}]} derived from recorded run events/evidence for that run (read persistence repos; 404 for unknown run; empty list if no findings recorded). Match Finding shape in apps/web/src/stores/useGenomeStore.ts.

## Units
- **api_core** — services/api/app/main.py, config.py, middleware/*, dependencies/*. Also include routers from services/api/app/routes/fixtures.py (router) and routes/findings.py (router) in main.py once those files exist (they are created by other agents; add the include defensively only if the modules import cleanly).
- **route_runs** — services/api/app/routes/runs.py. 
- **route_validation** — services/api/app/routes/validation.py. 
- **route_datasets** — services/api/app/routes/datasets.py. 
- **route_evidence** — services/api/app/routes/evidence.py. 
- **route_harnesses** — services/api/app/routes/harnesses.py. 
- **route_health_scene** — services/api/app/routes/health.py, scene.py. 
- **route_investigations_capabilities** — services/api/app/routes/investigations.py, capabilities.py. 
- **route_seals** — services/api/app/routes/seals.py. 
- **route_v8** — services/api/app/routes/v8.py. 
- **route_voice** — services/api/app/routes/voice.py. 
- **api_schemas** — services/api/app/schemas/*. 
- **gen_ingestion** — services/runtime/genomics/ingestion.py. 
- **gen_bcftools** — services/runtime/genomics/bcftools_adapter.py. 
- **gen_orchestrator** — services/runtime/genomics/orchestrator.py. 
- **gen_contracts_models** — services/runtime/genomics/contracts.py, models.py, __init__.py. 
- **gen_oracle** — services/runtime/genomics/oracle.py. 
- **gen_validator** — services/runtime/genomics/validator.py. 
- **eval_evaluator** — services/runtime/evaluation/evaluator.py. 
- **eval_holdout** — services/runtime/evaluation/holdout.py. 
- **eval_paired** — services/runtime/evaluation/paired_scientific_eval.py. 
- **eval_seal_models** — services/runtime/evaluation/seal.py, models.py, __init__.py. 
- **evidence_receipt** — services/runtime/evidence/*. 
- **evolution** — services/runtime/evolution/*. 
- **harness** — services/runtime/harness/*. 
- **incidents** — services/runtime/incidents/*. 
- **memory** — services/runtime/memory/*. 
- **mutation** — services/runtime/mutation/*. 
- **optimization** — services/runtime/optimization/*. 
- **orch_runner** — services/runtime/orchestration/runner.py. 
- **orch_worker** — services/runtime/orchestration/worker.py and any other file in that dir except runner.py. 
- **providers** — services/runtime/providers/*. 
- **tools_agents** — services/runtime/tools/*, services/runtime/agents/*. 
- **artifacts** — services/runtime/artifacts/*. 
- **capabilities_registry** — services/runtime/capabilities/*. 
- **v8_experiment** — services/runtime/v8/experiment.py. 
- **v8_store_contracts** — services/runtime/v8/checkpoint_store.py, contracts.py and other v8 files except experiment.py. 
- **int_biomni** — services/integrations/biomni/*. 
- **int_ebi** — services/integrations/ebi_vcf/*. 
- **int_elevenlabs** — services/integrations/elevenlabs/*. 
- **int_raindrop** — services/integrations/raindrop/*. 
- **int_contracts** — services/integrations/contracts.py. 
- **mongo_client** — services/integrations/mongodb/client.py. 
- **mongo_models** — services/integrations/mongodb/models.py. 
- **mongo_repo_tasks_runs** — services/integrations/mongodb/repositories/tasks_runs.py. 
- **mongo_repo_rest** — services/integrations/mongodb/repositories/* except tasks_runs.py. 
- **new_fixtures_endpoint** — create services/api/app/routes/fixtures.py exporting `router` (prefix /api) implementing GET /api/fixtures; plus services/tests/test_audit_new_fixtures_endpoint.py (use FastAPI TestClient on a minimal FastAPI app that includes only your router).
- **new_findings_endpoint** — create services/api/app/routes/findings.py exporting `router` (prefix /api) implementing GET /api/runs/{run_id}/findings; read how runs/events/evidence are stored (services/integrations/mongodb/repositories, routes/runs.py) and how the validator produces findings; plus services/tests/test_audit_new_findings_endpoint.py with isolated DB.
- **security_review** — READ-ONLY cross-cutting security review of services/ (path traversal in fixture/artifact resolution, subprocess allowlisting, secret leakage in logs/responses, CORS/middleware, SSE endpoint abuse, input size limits, ObjectId leakage). You own only docs/audit/backend/security_review.md. Reproduce every claimed vuln with a concrete request/command before listing it as CONFIRMED; otherwise UNVERIFIED.
- **test_infra** — own pyproject.toml [tool.pytest.ini_options] and Makefile test targets only: make sure `make test` style invocation works, add a `pytest.ini`-free marker config if useful, add `make audit-backend` target running `.venv/bin/pytest -q services/tests` and `.venv/bin/ruff check services`. Detect order-dependent/flaky tests by running the existing suite 3 times (`-p no:randomly` is default; also run with `-x -q` and `--co` sanity) using MONGODB_DATABASE=diamond_audit_test_infra; record findings in docs/audit/backend/test_infra.md. Do not edit test files.
