# Audit: orch_worker (services/runtime/orchestration/worker.py, models.py, __init__.py)

## FIXED
1. worker.py:57-68 (`DurableWorker.acquire_lease`): the follow-up `runs.update_one({"task_id": ...})` was unconditional. A worker that wins the task lease and then stalls (the ADR-002 GC-pause case) could, after a newer worker had already taken over, overwrite the run's `fence_token`/`worker_lease_owner` with its own older values, re-validating the zombie and fencing out the live worker.
   - Failing test: `test_stale_acquirer_cannot_regress_run_fence_token` (services/tests/test_audit_orch_worker.py).
   - Fix: the run update now matches only when the run's `fence_token` is `<=` the token just acquired (or absent, for legacy documents), so the run token is monotonic.
2. worker.py:158-171 (`run_single_job`, `resume=False`): the fresh task was rebuilt with a hard-coded `fence_token=1`, resetting the generation counter of an existing task. Old-generation workers could then collide with the new token (ADR-002 monotonicity).
   - Failing test: `test_run_single_job_keeps_fence_token_monotonic`.
   - Fix: reuse the existing task's `fence_token` (1 if the task does not exist). The lease reset and other fields are unchanged.
3. worker.py:177-183 (`run_single_job`): `mongo.close()` was skipped if `process_task` raised, leaking the connection pool.
   - Failing test: `test_run_single_job_closes_client_when_task_fails`.
   - Fix: `try/finally` around `process_task`.

## UNVERIFIED/NEEDS OTHER OWNER
- worker.py:49-69 `acquire_lease(task_id)` updates the first run matching `task_id` (`update_one`), not the `run_id` being processed. With several runs sharing one task_id, `process_task` could run against a run whose token was not refreshed. The API creates one task per run by default (routes/runs.py), so no realistic trigger was shown.
- worker.py:93-145 `process_task` never calls `renew_lease`; a run exceeding `lease_seconds` (30) loses its lease and is only protected by fencing afterwards. Design gap, not changed.
- worker.py:136-138 the lease is released as COMPLETED regardless of the run's final state (PROMOTED/REJECTED/INCONCLUSIVE are all "task completed"); also logs success even if the release was fenced out. Judged intended semantics.
- worker.py:142-145 if `release_lease` itself raises a non-fencing error in the failure path, it masks the original exception. Not reproduced.
- worker.py: `asyncio.CancelledError` is not caught, so the lease is not released on cancellation (it expires instead). Safe by design (fencing).
- worker.py:24 `logging.basicConfig` at import: no-op in the API process because api/main.py configures logging first; left as is (scripts rely on its INFO output).
- `process_task(vcf_name=...)` is passed straight to runner.execute_run, which joins it into fixtures paths (runner.py `fixtures_dir / "invalid" / vcf_filename`) without traversal checks. Owner: orch_runner. Worker callers only pass constants.
- run_single_job `resume=True` clears any lease unconditionally (including a live one); intentional for the chaos demo.
- Re-processing a task whose run already reached a terminal checkpoint emits a duplicate `worker.recovered`/`run.completed` (runner behavior; owner orch_runner).

## VERIFIED OK
- Lease acquire/renew/release delegate to TaskRepository with owner + fence_token guards; a stale worker's `release_lease` returns False and only FencingTokenConflictError is swallowed there; `process_task` re-raises fencing conflicts without releasing another worker's lease.
- `acquire_lease` returns False and leaves `self.fence_token` untouched when another worker holds the lease.
- models.py re-exports and `__all__` in models.py/__init__.py all resolve (test_package_exports_resolve).
- Existing tests test_m01_durability.py and test_mongo_recovery.py pass unchanged.
