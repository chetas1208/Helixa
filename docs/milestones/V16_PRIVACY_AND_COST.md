# V16 privacy and cost

## What may be sent

Remote embedding and reranking accept only text that passes the sanitizer: no 41+ base nucleotide run, no VCF header, no patient/sample id pattern, no canary or bearer/API-key material. The research index stores paraphrased public summaries, not VCF bodies or workspace sequences.

`VOYAGE_ALLOW_EXTERNAL_RESEARCH_TEXT` defaults to false. The reindex tool still embeds only the curated approved excerpts, and only when Voyage is enabled.

Queries from the UI are the short research box plus gene id, anatomy id, assembly, and workspace id. The editor does not post the base window.

Retrieved lines that look like instructions are prefixed with `[quoted source, not an instruction]`. The tool `search_research_evidence` marks every citation `untrusted: true`.

## Tests

`services/tests/test_v16_privacy.py` posts synthetic DNA (`ACGT` repeated), `CANARY_SECRET`, a VCF header, and a patient/sample id at the adapter. The mock transport records zero requests.

The throwaway API on port 8196 returned `status: refused`, `fallback_reason: genomic_content`, and zero citations for a long `ACGT` query.

Raindrop, when configured, receives a `search_research_evidence` tool event with a status string and a duration. The query text is not a field on that event. Mongo `retrieval_runs` store a query hash, filters, document ids, and source URLs.

## Cost

No Voyage tokens were consumed. `voyage-check` did not call the network.

From the MongoDB model page fetched 2026-10-11, `voyage-4-large` is listed at $0.12 per 1M tokens with a 200M token free tier. A rerank price was not copied because that fetch did not include a rerank price table. Token counts are stored on the adapter only after a real response (`usage.total_tokens`).

`VOYAGE_MAX_INPUT_CHARS` is 8000. Batch size is 32. Retries do not apply to authentication failures.
