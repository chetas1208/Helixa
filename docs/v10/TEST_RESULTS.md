# V10 test results

2026-10-11

`make verify-v10` after the demo path fix:

- Ruff on the V10 modules: passed
- pytest `test_v10_wright_fisher.py` and `test_v10_workspace.py`: 17 passed
- vitest `tests/playback.test.ts`: 1 passed
- `scripts/demo_v10.py` result sha256: `3bd52f0f56a88b0d92c328772e2b71ab98f750d262e0a4801de1b8dc4a5424e5`
- Demo run: 80 generations, 2000 model years, seed 1, educational coefficient 0.15, temperature marked NOT_MODELED, frequency 0.5 to 1.0

`pnpm --filter web exec tsc --noEmit`: passed after the Studio helix pose was added.

Browser, http://127.0.0.1:5173, Studio tab: 48 synthetic bases loaded, workspace `rev-e549c0a9468f` with harness `harness-pche-baseline`. Sandbox run with selection 0, seed 1, N=80, 2000 years: narrative reported frequency 0.5000 to 0.8000 and said temperature was not converted into fitness.

Not run: the full M01–V8 suite, SLiM, Atlas, Raindrop, ElevenLabs, a 60-second wall-clock watch of playback.
