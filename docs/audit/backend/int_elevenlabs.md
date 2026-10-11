# Audit: int_elevenlabs (services/integrations/elevenlabs/adapter.py, __init__.py)

## FIXED
1. services/integrations/elevenlabs/adapter.py:33-34 (original) - `os.getenv("ELEVENLABS_VOICE_ID", default)` only applies the default when the variable is unset. `.env.example` ships `ELEVENLABS_VOICE_ID=` (empty), so a copied env file gave `voice_id == ""` and the request URL `https://api.elevenlabs.io/v1/text-to-speech//stream` (invalid endpoint, guaranteed upstream error). Same pattern for `ELEVENLABS_MODEL_ID`.
   - Failing tests (failed before the fix): `services/tests/test_audit_int_elevenlabs.py::test_empty_env_values_from_env_example_fall_back_to_defaults`, `::test_stream_with_default_config_never_hits_blank_voice_path`.
   - Fix: `voice_id or os.getenv(...) or <default>` (and the same for `model_id`). No signature or other behavior change.

## UNVERIFIED/NEEDS OTHER OWNER
- adapter.py:49-61 - `compose_briefing_script` ignores `decision_reason` and hardcodes claims. The promoted branch always says the candidate "verified the mismatch on the held-out dataset ... without false positives" and refers to a "reference allele integrity incident", independent of the receipt contents. The non-promoted branch always says "not promoted due to insufficient evidence", even when the real reason differs (for example a regression). This is a truthfulness concern for an evidence-derived briefing, but `test_integrations.py` pins the promoted wording and the right wording is a product/science decision, so it was not changed.
- adapter.py:49-61 - the free-text fields (`receipt_id`, `candidate_version_id`, `score`) are interpolated unsanitized into text that is sent to a third party. They are internal identifiers, so no nucleotide leak was reproduced, but the adapter does not enforce the "never transmits raw genetic sequence data" docstring itself (the Raindrop adapter has a sanitizer; this one has none). Callers (`routes/voice.py`, `v8/experiment.py`) pass receipt-derived values only.
- adapter.py:80 - `voice_id` is interpolated into the URL path without quoting/validation. It comes from env or constructor (operator-controlled, not request-controlled), so no exploit path was found; left as is.
- adapter.py:98-99 - on a non-200 response the whole error body is read (`aread()`, unbounded) and embedded in the `RuntimeError` message, which `routes/voice.py` returns to the client as `error`. A hostile or misbehaving upstream could produce a large or HTML body. The API key is sent only as a request header and is not echoed (verified with a mock transport). Truncating would be a behavior change with no reproduced harm.
- adapter.py:33,36 - `api_key or os.getenv(...)`: an explicit `api_key=""` falls back to the env key, and `ELEVENLABS_ENABLED` accepts only the exact string `true` (case-insensitive; `1`/`yes`/trailing whitespace read as disabled, which fails closed). Neither is a reproduced defect; `v8/experiment.py:294` passes `enabled=False, api_key=""` and stays NOT_CONFIGURED because `enabled=False`.
- adapter.py:71-74 - `mock_chunks` is a test hook that bypasses the NOT_CONFIGURED check. It is only reachable by direct Python callers (no route passes it).

## VERIFIED OK
- `status` is `CONFIGURED` only when enabled and a key is present; `NOT_CONFIGURED` otherwise (ADR-012/ADR-018), and `stream_speech` raises before any network call when not configured (tested with a transport that fails on any request).
- Streaming request shape (URL, `xi-api-key` header, JSON body with text/model_id/voice settings) and chunk pass-through verified with `httpx.MockTransport`; no network used.
- Non-200 raises `RuntimeError` containing status and upstream body, never the API key.
- Script composition is deterministic and contains no nucleotide payload for either branch.
- `__init__.py` exports match the imports in `routes/voice.py`, `routes/health.py`, `v8/experiment.py`.
- Tests run: `MONGODB_DATABASE=diamond_audit_int_elevenlabs .venv/bin/pytest services/tests/test_audit_int_elevenlabs.py services/tests/test_integrations.py services/tests/test_audit_route_voice.py services/tests/test_audit_route_health_scene.py services/tests/test_audit_route_v8.py services/tests/test_api_routes.py -q` -> all pass; `ruff check` on owned files clean.
