# Audit: mongo_repo_tasks_runs (services/integrations/mongodb/repositories/tasks_runs.py)

## FIXED
1. `RunRepository.transition_state`: read-validate-write was not atomic. The update filtered only on `run_id` (+ `fence_token`), so if the run changed state between the read and the write (same fence generation), the write overwrote the concurrent state with a transition that was never validated against it (e.g. COMPLETED overwritten by DIAGNOSING), bypassing the state machine. Test: `test_transition_state_rejects_illegal_transition_after_concurrent_change` (failed: DID NOT RAISE). Fix: the update filters on the validated status (compare-and-set); on a miss it re-reads, re-validates fencing and the transition against the fresh state, bounded to 5 attempts. Fence loss mid-transition still raises `FencingTokenConflictError` (`test_transition_state_fence_taken_over_mid_transition_is_fenced`); a benign concurrent advance is revalidated and applied (`test_transition_state_revalidates_against_concurrently_changed_state`).
2. `TaskRepository.create_task` (was `replace_one`): re-creating an existing task id reset `fence_token` to the model default (1), regressing the generation counter and allowing fence tokens to be reused (violates ADR-002 monotonic generations). Test: `test_create_task_never_regresses_fence_token` (failed: fence 1 != 3). Fix: `update_one` with `$set` of all other fields and `$max` on `fence_token`, upsert kept. Fresh tasks and explicitly higher tokens behave as before (`test_create_task_accepts_higher_fence_and_new_task`).
3. `RunRepository.create_run` (was `replace_one`): same fence regression for runs. Test: `test_create_run_never_regresses_fence_token` (failed: 1 != 5). Same fix.
4. `RunRepository.update_run`: mutated the caller's `updates` dict by inserting `updated_at`. Test: `test_update_run_does_not_mutate_caller_dict` (failed). Fix: build a new dict.

## UNVERIFIED/NEEDS OTHER OWNER
- `create_task`/`create_run` still overwrite non-fence fields of an existing doc (status, lease owner/expiry, `seq_counter`, run status), so re-creating an id can reset a COMPLETED run to CREATED or drop a live lease. Upsert-replace semantics are the documented behavior and the callers (`runner.execute_run` only creates when absent, API uses unique ids, `worker.run_single_job` passes the existing fence) do not trigger it in practice; not changed. `runner.execute_run` get-then-create is a check-then-act race (runner owner).
- `transition_state(additional_updates=...)` and `update_run(updates=...)` accept arbitrary keys, including `status`, `fence_token`, `run_id`; this would bypass the state machine/fencing. No in-repo caller passes such keys, so no defect was demonstrated.
- `acquire_lease` re-claims tasks in terminal states (COMPLETED/FAILED/CANCELLED) and flips them to RUNNING; `worker.run_single_job(resume=True)` relies on re-running a task, so left as is.
- `acquire_lease`: a task with a non-null `worker_lease_owner` and null/missing `worker_lease_expiry` can never be claimed by another worker (`$lt` does not match null). Only reachable through inconsistent data; `release_lease`/`acquire_lease` never produce it.
- `acquire_lease`/`renew_lease`: no validation of `lease_seconds` (<= 0 gives an immediately expired lease; used deliberately in tests).
- `renew_lease` returns `modified_count > 0`; a theoretical identical-timestamp write would report False. Not reproducible in practice.
- `list_runs(limit<=0)` raises `ValueError` from the driver (`to_list`); no caller passes it (API does not call `list_runs`). Ties on `created_at` have no secondary sort key.
- `transition_state` now matches on stored `status`; a run doc written by raw insert without a `status` field (not produced by `create_run`) would not match and ends with `ValueError`.
- `append_event` (events_checkpoints.py, other owner) writes `runs.seq_counter = seq` unconditionally, so concurrent appends can lower the mirrored `seq_counter`; informational field only.

## VERIFIED OK
- Lease acquire is atomic (`find_one_and_update`); 10 concurrent acquirers yield exactly one winner and one fence increment (`test_concurrent_acquire_has_single_winner`); expired leases are taken over with a higher fence and the old holder's renew/release are rejected.
- ISO-8601 UTC string comparison for lease expiry is order-correct for all strings produced by `datetime.now(UTC).isoformat()` (including the no-microsecond form).
- `renew_lease`/`release_lease` are guarded by owner + fence_token; release raises `FencingTokenConflictError` on mismatch and clears owner/expiry.
- `transition_state` fencing check, state-machine validation, idempotent same-state transition, `additional_updates` merge, and not-found handling.
- `update_run` fencing/not-found behavior; `list_runs` ordering and limit; model round-trip with `_id` stripped.
- Existing tests: test_m01_durability, test_mongo_recovery, test_audit_orch_worker, test_audit_route_runs, test_audit_new_findings_endpoint, test_api_routes pass.
