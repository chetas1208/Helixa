# gen_oracle audit: services/runtime/genomics/oracle.py

## FIXED
1. oracle.py:72 (`OracleEvaluationReport.create`): `summary_digest` hashed each case's `runtime_ms`, a wall-clock timing, so two evaluations of an identical oracle/validator/fixtures produced different digests. Test: `test_summary_digest_is_deterministic_across_evaluations`. Fix: `exclude={"runtime_ms"}` from the canonical case dump (`runtime_ms` is still reported on each case).
2. oracle.py:220 (`IndependentGenomicsOracle.evaluate`): `checks_present` only required the expected `check_id` to appear among findings, regardless of its status. A case with the right overall status but caused by a different check, with the expected check reported PASS, was scored as passed (ground-truth mislabel acceptance). Test: `test_expected_check_must_carry_the_expected_status`. Fix: the expected check must also carry `case["expected_status"]`. Verified every frozen case still passes with the real validator (13/13, 100%).

## UNVERIFIED/NEEDS OTHER OWNER
- oracle.py:180 `base_dir` defaults to `Path.cwd()`: running from another directory makes all fixtures "missing" (fail-closed, score 0, digest uses `NO_FASTA`). Fail-closed, so not changed; deriving the root from `__file__` would be a behavior change.
- oracle.py:185-189 `oracle_digest` binds the suite definition and FASTA bytes but not the VCF fixture bytes (nor the .fai), so a tampered fixture is not reflected in the digest (it would change case outcomes, not the digest). Adding them would change published digest values (artifacts/docs); design decision for the owner of ADR-009.
- oracle.py:311 `content.replace(...)` in the mutation test is a silent no-op if the fixture line changes; the property then reports not satisfied (fail-closed), with a slightly misleading details message.
- Side effect: `scripts/audit_system.py` was run to confirm the oracle consumer still works; it regenerated untracked files under artifacts/audit/.

## VERIFIED OK
- Frozen suite enumerations, fixture paths, and expected statuses match the real validator output (10/10 cases, 3/3 metamorphic).
- Missing-fixture handling is fail-closed (ERROR observed, passed=False).
- Validator never raises on missing/malformed files (returns ERROR reports), so evaluate() cannot be aborted by a bad fixture.
- Metamorphic tests write only to a TemporaryDirectory; byte-immutability check hashes before and after.
- Score math, empty-total guard, held-out fixtures read only by the oracle (ADR-009/017 unaffected).
- Consumers (test_m02_genomics, demo_m02, audit_system, verify_m02) unaffected.
