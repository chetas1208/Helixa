# Audit: providers (services/runtime/providers/*)

Files: adapter.py, __init__.py. Tests: services/tests/test_audit_providers.py.

## FIXED
1. services/runtime/providers/adapter.py:112 (`choice.get("content", "")`): an OpenAI-compatible response with `"content": null` (the normal shape when a message carries tool_calls) raised pydantic `ValidationError` because `ModelResponse.content` is `str`. Failing test: `test_null_content_response_is_accepted`. Fix: `choice.get("content") or ""`.
2. services/runtime/providers/adapter.py:83 and :85: `.env.example` ships `MODEL_BASE_URL=` and `MODEL_NAME=` empty and `services/api/app/config.py` loads it with `load_dotenv`, so the env vars exist as `""`. `os.getenv(name, default)` returns `""` rather than the default, so with only `MODEL_API_KEY` filled the provider had `is_configured == False` (silent fallback to the deterministic proposer) and an empty model name. Failing test: `test_empty_env_values_from_env_example_use_defaults`. Fix: `os.getenv(name) or default`.
3. services/runtime/providers/adapter.py:83: a `base_url` ending in `/` produced `.../v1//chat/completions`. Failing test: `test_trailing_slash_base_url_does_not_double_slash`. Fix: `.rstrip("/")` on the resolved base URL.

## UNVERIFIED/NEEDS OTHER OWNER
- services/runtime/providers/adapter.py:89-116: `tools` and `response_schema` are accepted but never sent, and any `tool_calls` in the response are dropped (`ModelResponse.tool_calls` stays empty). Looks like an incomplete adapter, but adding them changes behavior/contract beyond a defect fix and `OpenAICompatibleProvider` has no caller in the repo (only `DeterministicProposer` is used, in orchestration/runner.py:56), so not changed.
- services/runtime/providers/adapter.py:81: `timeout_seconds` defaults to 30 and ignores `MODEL_TIMEOUT_SECONDS` (60 in .env.example). Not a defect against a stated contract; left as is.
- services/runtime/providers/adapter.py:111: `data["choices"][0]` raises `KeyError`/`IndexError` on a malformed or empty response, and `resp.json()` raises `ValueError` on non-JSON. These are exceptions rather than swallowed errors, so left unchanged; callers must handle them (no caller exists yet).
- services/runtime/providers/adapter.py:108: message contents are sent verbatim to the configured external endpoint with no nucleotide/secret scrub (cf. ADR-013/ADR-020 for Raindrop). The only current caller (runner.py:247) builds a message with no sequence data, and the provider is unused in production, so no leak was reproduced.
- orchestration/runner.py:56 hard-codes `DeterministicProposer` and ignores `MODEL_PROVIDER`; owned by orch_runner.

## VERIFIED OK
- `DeterministicProposer` is pure and deterministic (identical input gives identical output), always `is_fallback=True`, provider name does not impersonate a remote model (`test_deterministic_*`).
- Unconfigured `OpenAICompatibleProvider` falls back with `is_fallback=True` and makes no HTTP call (`test_unconfigured_provider_falls_back_and_makes_no_http_call`), consistent with ADR-018.
- Configured request: bearer header, JSON body shape, `is_fallback=False`, provider name `openai-compatible` (`test_configured_request_shape_and_response`).
- HTTP errors propagate as `httpx.HTTPStatusError` without leaking the API key in the message (`test_http_error_propagates_without_leaking_api_key`); redirects are not followed (httpx default).
- `__init__.py` exports match adapter.py definitions.
- Tests use `httpx.MockTransport`; no network, no Mongo.
