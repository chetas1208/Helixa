# V18 test results

2026-10-11.

`ruff check` on `services/runtime/research`, `v18_research.py`, and the two V18 tests: pass.

`.venv/bin/pytest -q services/tests/test_v18_research.py services/tests/test_v18_live_ensembl.py`: **6 passed**.

- 5 mocked or local cases: abstain, fabricated PMID, MC1R fixture, expression-is-not-body, allele not applied, refuse clinical/virus wording.
- 1 live Ensembl lookup. It was not skipped.

`pnpm --filter web exec tsc --noEmit`: pass.

`vitest run tests/v16/researchPanel.test.tsx`: 1 passed. The new "Check sources" button was not the subject of that test.

## Not run

- Full backend suite after this change.
- Playwright prompt-to-confirm walkthrough.
- Authenticated Voyage, Raindrop, ElevenLabs, or Atlas writes for this milestone.
- A 15-query retrieval benchmark with independent relevance labels.

`make verify-v18` runs the ruff and pytest lines above.
