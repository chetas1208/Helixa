# Independent Evaluation & Promotion Gate

## Evaluation Methodology

The Proof-Carrying Harness Evolution (PCHE) gate evaluates candidate harnesses across four test tiers:

1. **Original Incident Case**: The failure case that triggered adaptation (e.g. `ref_mismatch.vcf`). The candidate must detect and flag the integrity failure that the parent missed.
2. **Negative Control (Valid Data)**: Valid genomic records (e.g. `valid_snvs.vcf`). The candidate must **not** fail or quarantine valid records (zero false positive inflation allowed).
3. **Sealed Held-Out Transfer Case**: Unseen test fixture (`unseen_mismatch.vcf`) with different chromosomes/positions to verify generalization beyond the immediate incident.
4. **Policy & Permission Ceiling Check**: Verifies that the candidate has not expanded permissions, disabled checkpoints, or attempted evaluator tampering.

## Scoring & Promotion Rules

- **Score**: `PassingChecks / TotalChecks` (always reported with denominators).
- **Promotion Threshold**:
  - Score >= Parent Score.
  - 100% Negative Control pass rate (False Positive Rate = 0%).
  - Zero permission expansion beyond `PolicyEnvelope`.
  - Content digest recorded in immutable `EvidenceReceipt`.
