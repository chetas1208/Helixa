# V11 test results

2026-10-11

`make verify-v11`

- Ruff: passed on the V10/V11 modules and the new tests
- pytest `test_v10_wright_fisher.py`, `test_v10_workspace.py`, `test_v11_science.py`: 28 passed
- vitest `tests/playback.test.ts`: 1 passed

`make benchmark-v11`: wrote `artifacts/v11/benchmark.json` in about 0.0015 seconds for two diploid replicates.

`pnpm --filter web exec tsc --noEmit`: passed.

Not run: full M01–V8 suite, Playwright, a wall-clock 60-second watch, Atlas, SLiM, Raindrop, ElevenLabs, worker-kill recovery.
