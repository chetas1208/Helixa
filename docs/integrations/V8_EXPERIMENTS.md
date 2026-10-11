# V8 experiment

Fixture: `fixtures/invalid/ref_mismatch.vcf` against `fixtures/references/ref_synthetic_chr22.fasta`. Synthetic only.

Recorded run in `artifacts/v8/` (2026-10-11):

| Measure | Count |
|---|---|
| Baseline cases | 1 |
| Baseline detections of the REF mismatch | 0 |
| Independent adjudication | `AGREE_FAIL` |
| EBI assembly detail | chr22:105002 REF `G`, FASTA `T` |
| Input rewritten | no (`input_sha256_unchanged: true`) |
| Build identity proven | no |
| Candidates proposed | 5 |
| Rejected before evaluation | 1 (`harness-v1-unsafe-weaken`, `execute_shell`) |
| Candidates evaluated | 2 |
| Promoted | yes |
| Promotion writes | 1 |
| Model calls | 0 |
| GEPA `optimize()` calls | 0 |
| Ablation (tool discovery / prior-failure context off) promoted | yes |

The ablation matching the optimized run is one exploratory pair. It does not show that tool discovery caused the repair. The repair is the policy flag `require_reference_allele_check`.

Held-out case ids are not passed to `generate_candidates`. `IndependentEvaluator` still scores `heldout_transfer_unseen_mismatch`.

Control is the baseline harness with the REF check left off: 0 detections out of 1 incident case.

Receipt digest after `make verify-v8` on 2026-10-11: `a665c6d9004799782e13137cb01e72233e5ff11208d10266db720cb70206e606`. Candidate ids are content-addressed (`stable_version_id`), so a repeat of the same parent and policy produces the same ids. Earlier digests `c144360e…` and `691c8b95…` came from random suffixes and are obsolete.
