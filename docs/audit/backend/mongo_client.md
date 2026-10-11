# Audit: mongo_client (services/integrations/mongodb/client.py)

Tests: `services/tests/test_audit_mongo_client.py` (run with `MONGODB_DATABASE=diamond_audit_mongo_client`).

## FIXED

1. `client.py:33` `sanitize_mongodb_uri` leaked part of a password containing an unencoded `@` and corrupted credential-less URIs that carry `@` in the query.
   - Old regex `://([^:]+):([^@]+)@` stopped at the first `@`, so `u:SuperSecretP@ss123@host` was logged and returned by `/api/health` as `u:****@ss123@host` (tail of password exposed). The same regex also rewrote `mongodb://127.0.0.1:27017/db?appName=a@b` into `mongodb://127.0.0.1:****@b`.
   - Failing tests: `test_sanitize_masks_password_containing_unencoded_at`, `test_sanitize_leaves_credentialless_uri_untouched`.
   - Fix: `://([^:/?#@]+):([^?#]*)@` (user cannot span `/`, `?`, `#`; password is matched greedily to the last `@` before any query/fragment).
2. `client.py:82` `is_atlas_uri` used substring checks (`"atlas" in uri`, `"mongodb.net" in uri`) over the whole URI including credentials, database name and query. A local URI such as `mongodb://127.0.0.1:27017/atlas_db` or `mongodb://atlas_user:pw@127.0.0.1` was classified as Atlas, which defeats the `MONGODB_REQUIRE_ATLAS` "no silent local fallback" guard (ADR-012/018) and reports `deployment_mode="atlas-hackathon"` for a local database.
   - Failing tests: `test_local_uri_is_not_atlas[...]` (5 cases).
   - Fix: Atlas now means a `mongodb+srv://` scheme (unchanged) or any host in the URI authority equal to or ending in `.mongodb.net`. Userinfo, path and query are ignored. `test_atlas_uri_is_atlas` confirms SRV, uppercase scheme and multi-host `*.mongodb.net` seed lists still count as Atlas.
3. `client.py:50-66` constructor used `arg or env_default` for the four numeric options, so an explicit `0` (valid for `min_pool_size`, `connect_timeout_ms`, etc.) was silently replaced by the env/default (`MongoDBClient(min_pool_size=0).min_pool_size == 5`).
   - Failing test: `test_explicit_zero_options_are_honored`.
   - Fix: `value if value is not None else int(env)`. Behaviour for `None` and non-zero values is unchanged (`test_defaults_come_from_env_then_builtin`).

## UNVERIFIED/NEEDS OTHER OWNER

- `client.py:166` `check_status` returns `"AUTHENTICATED"` whenever `ping` succeeds but the write probe fails. MongoDB `ping` does not require authentication, so a reachable-but-unauthorized server would be reported as AUTHENTICATED. Could not reproduce (no auth-enabled mongod may be started under the audit rules) and renaming the status (`REACHABLE`) is a public contract change consumed by `routes/health.py`, `scripts/check_atlas.py` and `scripts/verify_v8_atlas.py`. Left unchanged.
- `client.py:122` `verify_write` canary id is `canary-probe-<float timestamp>`. Two concurrent calls with an identical float timestamp would collide on the unique `event_id` index and one would report `False`; also if `delete_one` raises after a successful insert the canary doc remains. Collision is not reproducible without mocking the clock and is extremely unlikely; left unchanged.
- `client.py:56-61` `min_pool_size` default 5 with a caller-supplied `max_pool_size < 5` makes pymongo raise `ValueError: minPoolSize must be smaller or equal to maxPoolSize` on first `.client` access (lazy, so not at construction). Config-conflict behaviour, not changed.
- `client.py:82` `mongodb+srv://` is treated as Atlas regardless of host (existing intent, kept); a non-Atlas SRV deployment would be labelled Atlas.
- `scripts/audit_system.py:151,326` compare `deployment_mode` to `"atlas"`, but the property returns `"atlas-hackathon"`, so that branch can never be true (other owner; scripts are not in any audit unit).
- `client.py:14` `COLLECTIONS` and `init_indexes` do not cover `run_sequence_counters`, `v8_campaign_checkpoints`, `v8_active_pointers` etc. that are used elsewhere; those collections are created implicitly and have no declared indexes (the `run_events` unique `(run_id, seq)` index is the sequence guard). `COLLECTIONS` has no importers other than `__init__`. Not changed.
- `client.py:220` `idx_run_idempotency` is sparse but not unique; `EventRepository.append_event` dedupes with a read before write, so concurrent same-key appends are not prevented by the index. Belongs to the repository owner (events_checkpoints.py) and changing index uniqueness alters on-disk schema; not changed.

## VERIFIED OK

- `ping`: catches all exceptions (cancellation is BaseException and propagates), logs only the sanitized URI plus the pymongo error text (no credentials in pymongo ServerSelection/Auth messages); returns a bool. `test_inaccessible_status_does_not_leak_password` shows `INACCESSIBLE` with no password in the returned dict.
- `check_status`: `NOT_CONFIGURED` for empty or bare `mongodb://` URI; `WRITE_VERIFIED` against the live local mongod with the probe doc cleaned up (`count_documents(component=probe) == 0`).
- `init_indexes`: idempotent (second call returns identical names), 12 collections, unique indexes consistent with repository field names (`dataset_id`, `artifact_sha256`, `task_id`, `run_id`, `(run_id, seq)`, `checkpoint_id`, `version_id`, `mutation_id`, `evaluation_id`, `receipt_id`, `receipt_digest`, `memory_id`, `event_id`).
- `close`: idempotent, resets `_client`; `AsyncMongoClient` truthiness is True so the `if self._client` check is sound.
- `client`/`db` lazy creation uses the configured pool/timeout bounds (ADR-001).
- `require_atlas` guard still raises `ConfigurationError` with the expected message for local URIs (existing `test_require_atlas_guard`).
- Existing tests run green with an isolated DB: `test_m01_durability.py`, `test_mongo_recovery.py`, `test_audit_route_health_scene.py`, `test_optimizer_gate.py`, `test_audit_route_runs.py`, `test_audit_route_datasets.py`.
