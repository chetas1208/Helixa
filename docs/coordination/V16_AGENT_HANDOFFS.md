# V16 agent handoffs

The five workstreams were implemented in this session as separate modules with the contracts in `V16_CONTRACTS.md`. They were not five concurrent OS processes: one working tree cannot take five writers on shared imports, and earlier multi-agent runs in this repo lost workers to usage limits. Ownership below is the file boundary that was kept.

## A — Model API adapter

Owner: integrator. Files: `services/integrations/voyage/`, `services/tests/test_v16_voyage.py`, `scripts/voyage_check.py`.

Removed `services/integrations/voyage.py` after the package exported `VoyageAdapter`. Legacy `embed()` and `status` remain. Health is `disabled` until `VOYAGE_ENABLED=true`. No live authentication in this run (`voyage-check` exit 2).

Ready: mocked embeddings, rerank, 401, 403 scope, 429, timeout, bad dimensions, and secret redaction pass.

## B — Retrieval and Atlas

Files: `services/runtime/retrieval/`, `services/tests/test_v16_retrieval.py` (store and mongo), `scripts/reindex_research.py`.

Local MongoDB does not support Atlas Vector Search (`OperationFailure`). Idempotent upserts passed. Fallback is lexical and labeled.

## C — Genomics research evidence

Files: `services/runtime/research_evidence/`, `fixtures/v16/`, curated paraphrases in `corpus.py`.

`search_research_evidence` returns citations only. PCHE policies cannot replace `v16-retrieval-oracle-1`. Misleading fixtures are excluded. Deterministic VCF validators were not edited.

## D — Four-tab wiring

Files: `apps/web/src/v16/`, small mounts in the four tab components, `apps/web/tests/v16/researchPanel.test.tsx`, fake backend routes.

Browser check on port 5173: all four tabs show the panel. DNA bases, evolution timeline, simulation controls, and library cards still render. Status is `unavailable` until the API process on port 8000 is restarted onto this code.

## E — QA

Files: `services/tests/test_v16_privacy.py`, `services/tests/test_v16_routes.py`, `scripts/verify_v16.py`, `scripts/demo_v16.py`, these docs, Makefile targets.

`verify_v16.py` exited 0 (ruff, 17 pytest, 1 vitest). Frontend suite 417 passed. Full backend suite: 682 passed, 1 skipped, 0 failed.

Blocker: no authenticated Voyage call until `VOYAGE_ENABLED=true` and `make voyage-check`. Do not point a geography-scoped key at the wrong host.
