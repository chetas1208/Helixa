# V10 simulation validation

Covered by `services/tests/test_v10_wright_fisher.py` and `services/tests/test_v10_workspace.py`:

- Selection ratio 0.25 with fitnesses 2 and 1 equals 0.4.
- Mutation and migration formulas.
- Zero population is extinct.
- Negative fitness is rejected.
- Same seed repeats the hash. A second seed can differ.
- Temperature does not change the hash and is marked `NOT_MODELED`.
- Unsupported fitness plus a nonzero coefficient is rejected.
- Years equal generations times generation time.
- 2,000,000 years at 25-year generations exceeds the budget and raises before sampling.
- Stored frames include generation 0 and the last generation and are not marked interpolated.
- Frequencies stay in [0, 1].
- Commit changes a workspace preview and does not change the FASTA baseline.
- A wrong revision counter does not commit.
- Idempotency returns the same simulation id.

SLiM was not run. There is no cross-check against SLiM or tskit.
