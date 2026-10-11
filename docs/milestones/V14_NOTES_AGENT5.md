# V14 Agent 5 notes (Independent QA, Science Guardrails & Performance)

## Owned this turn

- `apps/web/e2e/v14/**` (own Playwright config on :8145 / :5145; does not edit V12 mocked/real/visual)
- `apps/web/tests/v14/guardrails*.test.ts`
- `services/tests/test_v14_guardrails*.py`
- `scripts/verify_v14.sh`, `scripts/benchmark_v14.py`
- `artifacts/milestones/v14/**`
- `docs/milestones/V14_{TEST_RESULTS,SCIENTIFIC_GUARDRAILS,LICENSE_REVIEW,NOTES_AGENT5}.md`

## Contract change requests

None. The locked v1 contract is sufficient to fail honestly.

## Coordinator ask (Makefile)

Please add (do not let me edit Makefile):

```
verify-v14:
	bash scripts/verify_v14.sh all
```

Do not point it at :8000 / :5173.

## Safety

- Playwright + verify script refuse ports 8000 and 5173.
- Page route aborts non-GET to :8000 / :5173.
- Throwaway state: `V10_STATE_PATH=/tmp/v14_e2e/state.json`.
- Cleanup only kills process groups we started on 8145/5145.

## Expected until Agents 1–4 land

Most anatomy/genome-edit/first-viewport tests **fail** with an owner+path in the assertion. That is the point.
License scan and some V12-era voice/body/parser guards can pass now.

## Re-run (2026-10-11T23:14Z)

`scripts/verify_v14.sh all` on :8145/:5145. Agents 1–4 landed enough that laterality, GRCh37 reject, GWAS v2 API, expression caveat (API), FASTA immutability, lineage, voice, and reduced-motion now **pass**. Remaining honest fails are listed in `V14_TEST_RESULTS.md`.

## Blockers for a green verify-v14

- Agent 4: "make my hands bigger" → `TRAIT_GOAL` (parser has `bigger hands` but not `hands bigger`).
- Agent 4: `POST /api/genome-edit/proposals` is 404.
- Agent 3: AnatomyTree search after Explore body parts; caveat in the drawer; first-view `Baseline · GRCh38` strip.
- Simulation tab: label unsupported phenotype `not modeled`.

No contract change requested. Do not weaken those tests.
