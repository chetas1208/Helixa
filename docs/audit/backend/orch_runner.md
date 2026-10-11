# orch_runner audit: services/runtime/orchestration/runner.py

## FIXED

1. `runner.py` filename resolution. A missing fixture, `..`, an absolute path, a slash, a NUL, or a name longer than 255 characters used to continue into validation and could still be promoted. Tests: `test_unsafe_filenames_rejected_before_any_persistence`, `test_missing_vcf_fails_loudly_instead_of_promoting`. Fix: reject unsafe names and missing files before any Mongo write.
2. `runner.py` diagnosing step. `reference.check.failed` was emitted for every VCF, including a valid control. Test: `test_clean_vcf_does_not_claim_ref_mismatch`. Fix: emit that event only when the oracle report is `FAIL`.
3. `runner.py` resume. A crash after events were written, or a second call after `PROMOTED`, appended the same events again. A crash after the promotion decision left the run status ahead of the checkpoint, and resume tried an illegal transition. Tests: `test_resume_after_crash_does_not_duplicate_events`, `test_rerun_of_finished_run_does_not_repeat_completion_event`, `test_resume_after_decision_committed_does_not_get_stuck`. Fix: idempotency keys on runner events, reuse the stored receipt, and finish from `PROMOTED`/`REJECTED` when the checkpoint is still behind.
4. `runner.py` fence check. A stale `fence_token` was applied only at the first transition, after `run.created` could already be stored. Test: `test_stale_fence_token_is_rejected_before_any_write`. Fix: compare the token before any write.
5. `runner.py` single flight. Concurrent `execute_run` calls on one id both walked the pipeline (security review C4). Test: `test_busy_run_is_not_executed_twice`. Fix: an `executing` flag claimed with `find_one_and_update`, released in `finally`.
6. Validation event payload now includes the oracle `findings` list so `GET /api/runs/{id}/findings` can read them. Happy-path event order is unchanged (`test_fresh_run_happy_path_is_unchanged`).

## UNVERIFIED/NEEDS OTHER OWNER

- `MODEL_PROVIDER` is still ignored; the runner constructs `DeterministicProposer` directly. Changing that would be a provider-unit behavior change.
- Held-out fixtures can still be named if they sit in `invalid/` or `valid/`. The runner only searches those two folders plus `references/` for the FASTA, so `fixtures/heldout/` is not opened by `execute_run`.
- Absolute paths in other routes, SSE caps, upload body limits, and full authentication remain with the route and API owners. Host and Origin checks added in `main.py` cover the confirmed cross-site and Host cases when those headers are present.

## VERIFIED OK

- Fresh `ref_mismatch.vcf` run still promotes `harness-v2-candidate` with score `6/6` and the original 12-event order.
- `test_mongo_recovery.py` still passes against this runner.
