# V16 Voyage integration

## Scope

The Atlas model API key authenticates `POST /v1/embeddings` and `POST /v1/rerank` only. This client rejects any other path, including chat completions, and rejects base URLs whose host is not `ai.mongodb.com`, `us.ai.mongodb.com`, or `eu.ai.mongodb.com`.

`VOYAGE_KEY_SCOPE` (`unscoped`, `us`, or `eu`) must match the host. A mismatch raises `wrong_scope` before any HTTP call. A 401/403 body that mentions geography, scope, endpoint, or region is also `wrong_scope` and is not retried. 401/403 otherwise are `permission_denied` and are not retried. 429/5xx/timeouts retry up to `VOYAGE_MAX_RETRIES` with jitter.

## Health

| State | Meaning |
|---|---|
| `disabled` | `VOYAGE_ENABLED` is not `true`. No request. |
| `not_configured` | Enabled and `VOYAGE_API_KEY` is empty. No request. |
| `configured_unverified` | Key is present. No successful call on this process yet. |
| `connected` | This process completed an embeddings or rerank call. |
| `rate_limited` | HTTP 429 after retries. |
| `permission_denied` | HTTP 401/403. |
| `wrong_scope` | Host/scope mismatch. |
| `unavailable` | Timeout, 5xx, or a malformed vector. |

`status` remains the legacy `CONFIGURED` / `NOT_CONFIGURED` flag. `CONFIGURED` means the feature is enabled and a key is present. `verified` is true only for `connected`.

## Models

- Documents and queries both use `VOYAGE_EMBEDDING_MODEL` (default `voyage-4-large`, dimension 1024). `VOYAGE_FAST_MODEL` (`voyage-4-lite`) is recorded but not mixed into the index implicitly.
- Embedding version string: `{model}:float:{dimension}`. Series-4 models at the same dimension may share an index. `voyage-3.5` and `voyage-4-large` may not.
- Rerank model: `rerank-3`.
- Every vector must be finite and the same length. A short or partial batch is an error.

## Live call

`make voyage-check` exits 2 with `NOT_CONFIGURED` when the feature is disabled or the key is empty. It does not invent a success. On this machine, 2026-10-11, the command printed `NOT_CONFIGURED: VOYAGE_ENABLED is false. No request was sent.` and exited 2.

A legacy `VOYAGE_API_KEY` name is present in `.env`. It was not sent anywhere during this campaign. Set `VOYAGE_ENABLED=true` only when that key is the Atlas model key for the host in `VOYAGE_BASE_URL`, then run `make voyage-check`.

## Code

`services/integrations/voyage/` replaces `services/integrations/voyage.py`. `VoyageAdapter.embed` remains for the V10 narrative hook and still returns `None` when disabled, unconfigured, or the text is refused.
