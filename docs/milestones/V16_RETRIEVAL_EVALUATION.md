# V16 retrieval evaluation

## Corpus

Eight approved paraphrases are indexed in memory and can be upserted to MongoDB (`scripts/reindex_research.py`). They carry HGNC/Ensembl ids, assembly, tissue, license, provenance, and evidence type. Two rejected misleading fixtures exist only for contamination tests and are filtered out of user-facing passages.

Exact gene identifiers match structured fields. Vector similarity is not used for that match.

## This run (lexical only)

Command: `python scripts/demo_v16.py`. Voyage health: `disabled`. No embedding or rerank call.

Eight public queries in `fixtures/v16/queries.json`, k=5:

| Metric | Value |
|---|---|
| mean Recall@5 | 1.0 |
| mean MRR | 1.0 |
| mean nDCG@5 | 1.0 |
| unsupported-claim count | 0 |
| mean citation coverage | 1.0 |
| queries | 8 |

These scores are on a hand-built corpus whose relevant ids were written with the excerpts. They show the lexical filter and citation path. They are not a Voyage quality result.

Held-out queries in `fixtures/v16/heldout.json` are scored by `v16-retrieval-oracle-1`. A candidate may select `exact_lexical`, `exact_vector`, or `exact_vector_rerank`. It cannot replace the evaluator. A lower recall is stored as a regression and is not promoted.

## Arms not run against Voyage

| Arm | Result |
|---|---|
| Exact / lexical | Measured above. |
| Exact + vector | Not run. Voyage is disabled. A hash-vector wiring test in `test_v16_retrieval.py` checks the code path and is labeled as not a Voyage result. |
| Exact + vector + rerank | Not run against `rerank-3` for the same reason. The wiring test calls the rerank method on the hash stand-in. |
| Fallback | `lexical_fallback` with health `disabled`. |

## Atlas Vector Search

`GET /api/v16/research/status` on local MongoDB reported `supported: false`, `active: false`, reason `OperationFailure: Atlas Vector Search is not available on this cluster`. Local cosine over stored vectors is used only when vectors exist, and the response says `local_cosine`, not Atlas Vector Search.

Case-level rows are in `artifacts/milestones/v16/demo.json`.
