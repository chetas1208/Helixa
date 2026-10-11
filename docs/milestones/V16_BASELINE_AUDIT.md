# V16 baseline audit

Timestamp: 2026-10-11. This audit was taken before the Voyage adapter was replaced.

## What already existed

- `services/integrations/voyage.py` was a synchronous `httpx` client. It posted to `{VOYAGE_API_BASE|/v1}/embeddings` with `VOYAGE_MODEL` defaulting to `voyage-3.5`, truncated input to 1000 characters, and returned `None` without a key. It had no rerank method, no `input_type`, no dimension check, and no payload refusal beyond the caller's slice.
- `GET /api/integrations/status` reported `CONFIGURED` whenever `VOYAGE_API_KEY` was non-empty. That was not a connectivity check.
- `services/api/app/routes/v10.py` optionally embedded a simulation narrative with the same adapter and swallowed failures.
- MongoDB collections were the existing twelve (`datasets` through `integration_events`). There was no `research_documents`, `research_chunks`, `retrieval_runs`, or `embedding_jobs` collection, and no Atlas Vector Search index.
- OpenAI-compatible reasoning, Raindrop, and ElevenLabs are separate adapters. Voyage was not used as a chat model.
- The four product tabs live in `apps/web/src/v12/{editor,evolution,simulation,library}`.

## Official API checked on 2026-10-11

MongoDB's Embedding and Reranking API (`https://www.mongodb.com/docs/voyageai/`) is embeddings and reranking only.

- Unscoped host: `ai.mongodb.com`. Geography-scoped hosts: `us.ai.mongodb.com`, `eu.ai.mongodb.com`. A scoped key fails on the wrong host. The client must not retry another region.
- `POST /v1/embeddings` with `input`, `model`, and `input_type` of `document` or `query`.
- `POST /v1/rerank` with `query`, `documents`, `model`, optional `top_k`.
- Recommended models: `voyage-4-large` (default dimension 1024; also 256, 512, 2048), `voyage-4-lite` (same dimensions; series-4 embeddings are documented as compatible with each other), `rerank-3`.
- `voyage-4-large` list price on that page: $0.12 per 1M tokens, 200M free tokens. This audit did not copy a rerank price table.

## Environment

- Python 3.12 venv, `httpx` already installed. The official `voyageai` package was not added. Typed `httpx` calls match the REST examples and avoid a new dependency.
- Local MongoDB is the hackathon cluster stand-in. `list_search_indexes` on this process raises `OperationFailure`. Atlas Vector Search is not active here.
- `.env` already contains `VOYAGE_API_KEY`, `VOYAGE_API_BASE`, and `VOYAGE_MODEL` (values not recorded). `VOYAGE_ENABLED` was absent, so the new gate stays off and no authenticated call was made.

## Preserved

Deterministic VCF validation, the population simulation engine, PCHE evaluator, Raindrop, ElevenLabs, and the four-tab UI were not replaced.
