# V16 test results

Timestamp: 2026-10-11. Commands were run in this working tree.

## V16 gate

`python scripts/verify_v16.py` exited 0. Artifact: `artifacts/milestones/v16/verification.json`.

| Step | Result |
|---|---|
| ruff on the V16 modules, routes, and scripts | exit 0 |
| pytest `test_v16_voyage.py`, `test_v16_retrieval.py`, `test_v16_privacy.py`, `test_v16_routes.py` | 17 passed |
| vitest `tests/v16/researchPanel.test.tsx` | 1 passed |
| `python scripts/voyage_check.py` | exit 2, `VOYAGE_ENABLED is false`, no request |
| `python scripts/demo_v16.py` | exit 0, lexical recall 1.0 on 8 queries, `verified_live_call: false` |
| `pnpm --filter web exec tsc --noEmit` | exit 0 |
| `pnpm --filter web exec vitest run` | 35 files, 417 passed |

Local Mongo integration (`test_local_mongo_idempotent_index_and_run_trace`) passed against the local daemon: unique document and chunk upserts, one retrieval run, BRCA1 stored with `ENSG00000012048`.

## API probe

Throwaway uvicorn on `127.0.0.1:8196` (this process, not the user's port 8000):

- `GET /api/v16/research/status` → `health: disabled`, `verified: false`, vector search `supported: false`.
- `POST /api/v16/research/search` for BRCA1 → `doc-brca1` citation, lexical mode, untrusted.
- Synthetic DNA query → `refused` / `genomic_content`.

## Browser

The Vite app on port 5173 hot-reloaded the panel. With the already-running API on port 8000, which was started before this route existed, each tab showed `Research evidence · unavailable` and the editor showed `Not Found` for status. That is the honest failure state, not a connected Voyage session.

Checked in the browser, same workspace `ws-4b73b1e41102`:

- Genome Editor: turn-figure control, 48 bases, and the research panel.
- Evolution: timeline and harness versions, plus the research panel.
- Earth Simulation: scenario controls, outcome, playback, and the research panel. Population size stayed 80.
- Harness Library: name/id search and workspace cards stayed in place. The research panel is a separate control. Active workspace stayed Studio workspace.

Playwright cross-tab E2E was not executed in this run. `apps/web/tests/support/fakeBackend.ts` answers the two V16 routes for later mocked E2E.

## Not claimed

No authenticated Voyage embedding or rerank. No Atlas Vector Search index.

## Full regression

`.venv/bin/pytest -q services/tests` exited 0 in 121s. 683 collected, 1 skipped (`test_audit_mongo_client.py` requires `MONGODB_DATABASE=diamond_audit_mongo_client`), 682 passed, 0 failed.

`pnpm --filter web exec vitest run`: 35 files, 417 passed. `tsc --noEmit` clean.
