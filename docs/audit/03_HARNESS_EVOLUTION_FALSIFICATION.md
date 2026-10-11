# DIAMOND Genome V5 — Proof-Carrying Harness Evolution & Falsification
**Audit Phase:** Full-System Adversarial Audit & Release Gate  
**Architecture:** Proof-Carrying Harness Evolution (PCHE)  
**Oracle Version:** `PCHE-ORACLE-v4.0.0`

---

## 1. PCHE Architectural Framework

Proof-Carrying Harness Evolution (PCHE) is a formal method for recursive, autonomous agent harness self-improvement. Unlike unconstrained LLM self-modification, PCHE enforces:
1. **Immutable Policy Envelopes:** Hard structural constraints that no mutation can bypass.
2. **Independent Oracle Evaluation:** A separate evaluation harness that tests candidates against held-out regression suites.
3. **Cryptographic Evidence Receipts:** Immutable audit trails linking the parent version, candidate mutation, evaluation score, and SHA-256 evidence digests.

```
+-------------------------------------------------------------------+
|                        PolicyEnvelope                             |
|  - max_context_items_limit: 24                                    |
|  - max_attempts_limit: 5                                          |
|  - immutable_allowed_tools_whitelist: [9 read/eval/receipt tools] |
+-------------------------------------------------------------------+
                                  |
                                  v
+------------------+     +-------------------+     +------------------+
| Baseline Harness | --> | Propose Mutation  | --> | Candidate        |
| Spec (v1.0.0)    |     | (Deterministic)   |     | Spec (v2.0.0)    |
+------------------+     +-------------------+     +------------------+
                                                             |
                                                             v
                                                   +------------------+
                                                   | Independent      |
                                                   | Evaluator Oracle |
                                                   +------------------+
                                                             |
                                  +--------------------------+
                                  |
                                  v
                       [Incident Targets] (1)
                       [Negative Controls] (3)
                       [Held-Out Transfer] (1)
                       [Envelope Boundary] (1)
                                  |
                                  v
                       Candidate Promoted: YES
                       Receipt SHA-256 Generated
```

---

## 2. Policy Envelope Boundaries

The `PolicyEnvelope` (`services/runtime/harness/models.py`) defines invariant boundaries:
- **Max Context Items Limit:** 24 items.
- **Max Execution Attempts:** 5 attempts.
- **Allowed Tools Whitelist:**
  - `inspect_manifest`
  - `inspect_reference`
  - `inspect_vcf`
  - `run_validation`
  - `query_prior_evidence`
  - `read_harness_version`
  - `propose_mutation`
  - `request_evaluation`
  - `inspect_receipt`

Any mutation attempting to add arbitrary shell tools, expand network access, or increase context windows beyond 24 items is immediately rejected prior to evaluation.

---

## 3. Adversarial Falsification & Negative Controls

During Dimension 3 of the system audit (`scripts/audit_system.py`), adversarial candidate mutations were submitted to the evaluator to verify rejection mechanics:

### Test Case: Unsafe Context Expansion
- **Attack Payload:** Mutated `ContextPolicy.max_context_items = 999`.
- **Evaluator Response:** `(False, "Context items (999) exceeds envelope ceiling (24)")`.
- **Verdict:** Rejection confirmed. Candidate denied promotion.

### Test Case: Incident Reproduction & Negative Regression
- **Baseline Harness:** Missed subtle REF mismatch at POS 105002 when reference allele checking was disabled.
- **Candidate Harness:** Enabled `require_reference_allele_check=True`.
- **Evaluation Results:**
  - Incident target detected: PASS
  - Valid SNVs preserved: PASS (no false positive)
  - Multiallelic preserved: PASS (no false positive)
  - Indels preserved: PASS (no false positive)
  - Held-out transfer detected: PASS (unseen transfer test passed)
  - Policy envelope check: PASS
- **Promotion Outcome:** Score improved from 5/6 to 6/6. Candidate promoted to active harness.

---

## 4. Machine-Readable Evidence Receipt

The audit produced an immutable record in `artifacts/audit/evolution_matrix.json`:
- **Receipt ID:** `rcpt-PCHE-ORACLE-v4.0.0-...`
- **Evaluator Digest:** SHA-256 of synthetic reference genome (`ref_synthetic_chr22.fasta`).
- **Cryptographic Digest:** Complete SHA-256 hash across parent spec, candidate spec, and test results.
