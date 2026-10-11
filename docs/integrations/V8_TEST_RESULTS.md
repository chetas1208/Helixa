# V8 test results

Commands on 2026-10-11, workspace `/home/923873155/Diamond_Proj`.

| Command | Result |
|---|---|
| `.venv/bin/pytest -q services/tests` | passed (80 tests, inside `make verify-v8`) |
| `pnpm --filter web test` | 9 passed |
| `pnpm --filter web exec tsc --noEmit` | passed, no output |
| `.venv/bin/ruff check` on the V8 paths listed in `scripts/verify_v8.py` | passed |
| `.venv/bin/python scripts/demo_v8.py` | exit 0, `promoted: true`, fingerprint above |
| `make verify-v8` | exit 0. EBI 0.10.2 checks passed, ruff passed, pytest passed (80 tests), web tests 9 passed, `tsc --noEmit` passed, `demo_v8.py` promoted with digest `a665c6d9004799782e13137cb01e72233e5ff11208d10266db720cb70206e606` |
| `make audit` | exit 0. Verdict `CONDITIONAL GO`. Dimension 11 V8 integration PASS. Summary: `artifacts/audit/verification_summary.json` |
| `.venv/bin/python scripts/verify_v8_atlas.py` | exit 2, `NOT_CONFIGURED` |

V8 tests:

- `test_biomni_security.py`: header instructions counted and not executed; shell, consequence lookup, and `../etc/passwd` rejected; region overlap counted 2 records in `valid_snvs.vcf` for `chr22:10000-10002`.
- `test_ebi_disagreement.py`: valid SNV `AGREE_PASS`; REF mismatch `AGREE_FAIL` with position 105002; missing FASTA `INCONCLUSIVE`; bad syntax not `AGREE_PASS`; native policy with REF check off versus EBI is `DISAGREE`.
- `test_optimizer_gate.py`: repair candidate enables REF check; provenance is `DETERMINISTIC`; unsafe tool rejected; holdout id rejected; GEPA status `INSTALLED_UNCONFIGURED`; Mongo pointer allows one writer (namespace `v8-pointer-test` deleted afterward).
- `test_transfer_ablation.py`: campaign promotes once; crash after `evaluated` then resume does not increment `eval_runs` or `promotion_writes`.

`make verify-v8` was run as one Make invocation on 2026-10-11 and exited 0. It includes the eight scientific checks, ruff, pytest, the web tests, `tsc --noEmit`, and `demo_v8.py`.
