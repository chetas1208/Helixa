# Audit: route_runs (services/api/app/routes/runs.py)

Tests: `services/tests/test_audit_route_runs.py` (isolated DB `diamond_audit_route_runs`, dropped on teardown).
Every FIXED item below had a test that failed on the original code (30 failing cases observed) and passes after the fix.

## FIXED

1. runs.py:38-40 (original) - `run_id = f"run-{now_ts}"` has one-second resolution and `RunRepository.create_run` is an upsert on `run_id`. Two creates in the same second returned the same id and the second silently replaced the first run document (and the shared id let a later `/evolve` resume the other run's checkpoints). Test: `test_create_run_ids_unique_within_same_second`. Fix: append `uuid4().hex[:12]` to run and default task ids (same pattern already used elsewhere in services).
2. runs.py:28-31, 74-75 (original) - `vcf_filename` / `fasta_filename` were unvalidated and flow into `fixtures_dir / "invalid" / vcf_filename` in `AgentRunner.execute_run`. An absolute path (`/etc/passwd`) or `../..` escaped the fixtures tree (observed: the validator hashed `/etc/passwd`, and the name was persisted in the `run.created` event). Names > 255 chars made `/evolve` return 500 (`OSError: File name too long`). Tests: `test_create_run_rejects_non_plain_filenames`, `test_evolve_rejects_unsafe_stored_filename`. Fix: reject `..`, `/`, `\`, NUL and > 255 chars (ADR-011 rule) with 422 in the request model, and re-check the stored names in `evolve_run` (422, before any event is written) for run documents that did not pass through this request model.
3. runs.py:63-82 (original) - `/evolve` on a run already PROMOTED/REJECTED/INCONCLUSIVE/COMPLETED re-executed the runner, appending another `run.completed` event and checkpoint on every call (observed 6 duplicate `run.completed` events). Test: `test_evolve_finished_run_is_idempotent`. Fix: return the stored run unchanged (same response shape) for those states.
4. runs.py:63-82 (original) - `/evolve` on a FAILED/CANCELLED run returned 500 (`InvalidStateTransitionError`) after the runner had already written a `run.created` event and checkpoint. Test: `test_evolve_dead_run_conflicts_without_side_effects`. Fix: 409 before the runner is constructed.
5. runs.py:86 (original) - `after_seq` beyond int64 reached BSON and produced 500 (`OverflowError`). Test: `test_events_after_seq_out_of_range_is_422`. Fix: `Query(le=2**63-1)` (422). Negative values keep their previous behavior.
6. runs.py:109 (original) - `Last-Event-ID` was parsed with `str.isdigit()`, which is True for `"²"`; `int()` then raised `ValueError` inside the SSE generator (stream dies after headers). Digits above int64 passed through to BSON the same way. Test: `test_stream_ignores_invalid_last_event_id`. Fix: require ASCII digits and a value <= 2**63-1, otherwise ignore the header (existing behavior for other invalid values).

## UNVERIFIED/NEEDS OTHER OWNER

- services/runtime/orchestration/runner.py `execute_run` (orch_runner): a missing fixture VCF does not fail the run. `validator.validate` returns an ERROR report and the run still proceeds to PROMOTED (reproduced with `vcf_filename="nope.vcf"`). Also `execute_run` is not itself idempotent for finished runs and two concurrent `/evolve` calls on the same non-finished run both execute the pipeline (no lease is taken; `fence_token=None`). The route guard in fix 3 only covers the sequential case. Needs runner/worker owner.
- runs.py:`stream_run_events` (original 96-136): an unknown `run_id` streams heartbeats forever, and the connection lifetime/number is unbounded. Returning 404 or a cap would change client-visible behavior (the web client opens the stream right after create, so a 404 is probably safe but unproven); SSE abuse is also in scope of security_review. Not changed.
- runs.py `stream_run_events`: a backlog is drained 50 events per 1 s tick (a 1000-event replay takes ~20 s). Throughput, not correctness; not changed.
- runs.py `get_run_events`: unknown run returns 200 with an empty list rather than 404 (the findings contract uses 404 for unknown runs; this endpoint's contract is not specified). Not changed.
- `dependencies/__init__.py` `get_mongo_client`: when `app.state.mongo` is absent it builds a new `MongoDBClient()` per request and never closes it (reachable in tests that skip lifespan). Owned by api_core.

## VERIFIED OK

- 404 handling for `GET /{id}` and `POST /{id}/evolve` on unknown runs.
- ObjectId isolation: responses use `RunModel.model_dump(mode="json")` and repository `_id` projection; no BSON ids leak.
- Event sequencing: `/events` and `/stream` rely on `EventRepository.get_events` (sorted by `seq`, `$gt` cursor); stream advances `last_seq` per event and emits `id:` for resume; SSE data is `json.dumps` (single line), `event:` field comes from server-set event types only.
- Heartbeat cadence and disconnect handling in the stream loop.
- Normal create -> evolve -> events flow and Last-Event-ID resume with an ASCII value (covered by `test_api_routes.py` and `test_stream_honours_ascii_last_event_id`).
