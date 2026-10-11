# new_findings_endpoint

New files: `services/api/app/routes/findings.py` (router, prefix `/api`) and `services/tests/test_audit_new_findings_endpoint.py`.
Endpoint: `GET /api/runs/{run_id}/findings` -> `{"run_id": str, "findings": [{check_id, status, severity, message, locus?, metadata?}]}`.

## FIXED
Nothing to fix: this unit creates a new endpoint. No other source file was edited. The tests were written against the new module (it did not exist before, so every test failed with ImportError until `findings.py` was added); all 12 pass now.

Design (data sources, in priority order):
1. `runs` collection document for `run_id`, field `findings` (what `DeterministicGenomicsOrchestrator._persist_to_mongo` stores as `ValidationRun.model_dump`). The raw document is read, not `RunRepository.get_run`, because validation-run documents are not `RunModel`-shaped (`status` is PASS/FAIL, no `task_id`) and `RunModel(**doc)` would raise.
2. If the run document has no usable findings: `run_events` payloads carrying a `findings` list, read via `EventRepository.get_events` in pages of 200 (cap 50 pages, ordered by `seq`).
3. Existence (404 otherwise): run document, or any event, or an `evidence_receipts` row for that `run_id`. Known run with nothing recorded returns `findings: []`.

Each recorded finding is validated through `ValidationFinding` (so `status`/`severity` are limited to the enum values the UI `Finding` type accepts) and projected to the UI shape. `locus` is `{chrom,pos,ref,alt}` (the internal locus `id` is dropped). `metadata` is the finding metadata plus `observed_value`/`expected_value` when present (never overwriting a metadata key of the same name). Malformed entries are skipped, not 500. Mongo `_id` is excluded by projection (ADR-004). Only recorded findings are returned; no revalidation and no held-out/oracle expected outcomes.

## UNVERIFIED/NEEDS OTHER OWNER
- `services/runtime/orchestration/runner.py` (`AgentRunner`, runs created by `POST /api/runs` + `/evolve`): emits only `findings_count` in `run.validation.completed` and a synthetic `reference.check.failed` message; it records no per-finding data, so this endpoint returns an empty list for those runs. Persisting the oracle report findings (e.g. a `findings` list in the event payload) is an orch_runner decision; the endpoint already reads that shape if it is added.
- `services/runtime/genomics/orchestrator.py:236` (at audit time) `_persist_to_mongo` swallows all exceptions (`except Exception: pass`), so a failed write makes the endpoint 404/empty with no signal. Owner: gen_orchestrator.
- `services/api/app/main.py` must `include_router(findings.router)` (api_core unit). `GET /api/runs/{id}` in runs.py does not conflict (different path depth).
- Finding `metadata` is returned as stored; a non-JSON BSON type nested in `metadata` (e.g. ObjectId) would fail serialization. No writer in the repo produces that, so not changed.

## VERIFIED OK
- No route conflict with `runs.py` (`/{id}`, `/{id}/events`, `/{id}/stream`, `/{id}/evolve`).
- `run_id` is a path string used only as a literal equality value in Mongo filters (operator-injection test returns 404); length bounded to 1..256 (422 beyond).
- Paging over events does not loop forever (breaks on short page, bounded by page cap); no cross-run leakage.
- Real pipeline round trip: findings from `execute_pipeline` on `fixtures/invalid/ref_mismatch.vcf` (CAS/scratch redirected to tmp_path) match the endpoint output in order, status, severity, message, and locus shape.
- Tests use database `diamond_audit_new_findings_endpoint`, created and dropped by the test fixture only; no network; httpx ASGI transport on a minimal FastAPI app containing only this router.
