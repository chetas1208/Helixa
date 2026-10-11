# V16 contracts

Locked 2026-10-11. Modules below are the ownership boundaries used for this milestone.

## Provider

```python
class ResearchRetrievalModel(Protocol):
    async def embed_documents(self, texts: list[str]) -> list[list[float]]: ...
    async def embed_query(self, query: str) -> list[float]: ...
    async def rerank(self, query: str, documents: list[str], top_k: int) -> list[RankedDocument]: ...
```

`RankedDocument` has `index`, `text`, `relevance_score`, and optional `document_id`.

Health strings: `disabled`, `not_configured`, `configured_unverified`, `connected`, `rate_limited`, `permission_denied`, `wrong_scope`, `unavailable`.

Embedding version: `{model}:float:{dimension}`. Do not write two incompatible versions into one chunk.

## Collections

Created by `ResearchStore.ensure_indexes`, not by the original twelve-collection initializer.

- `research_documents`: `document_id`, `source_url`, `doi`, `title`, `license`, `retrieved_at`, `document_hash`, `excerpt`, `provenance`, `source_type`, `review_status`, `organism`, `assembly`, `evidence_type`, `gene_ids`, `tissue`, `organ`.
- `research_chunks`: `chunk_id` (sha256 prefix of the excerpt), `document_id`, `text_hash`, tags, `model_name`, `embedding_version`, `embedding`.
- `retrieval_runs`: `query_hash`, `filters`, `index_mode`, `embedding_version`, `candidate_ids`, `rerank_model`, `elapsed_ms`, `fallback_reason`, `citations`, `workspace_id`, `run_id`, `harness_id`, `status`.
- `embedding_jobs`: `idempotency_key`, `content_hash`, `model_version`, `state`, `retry_count`.
- `retrieval_policy_evals`: promotion or regression records. Evaluator version `v16-retrieval-oracle-1`.

User-facing search returns only `review_status=approved` and drops `source_type=misleading`.

## HTTP

- `GET /api/v16/research/status`
- `POST /api/v16/research/search` body `{query, context, top_k, policy}`
- Policies: `exact_lexical`, `exact_vector`, `exact_vector_rerank`

The search response includes `untrusted: true`, a disclaimer, citations, and index mode. It does not apply edits or change simulation parameters.

## UI

`ResearchEvidencePanel` posts only the typed query plus `gene_id`, `anatomy_id`, `assembly`, `workspace_id`, and `task_type`. It does not post bases.
