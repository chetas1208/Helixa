# Audit: eval_evaluator (services/runtime/evaluation/evaluator.py)

## FIXED
- services/runtime/evaluation/evaluator.py:199 -- `receipt_id` was `receipt-{candidate.version_id}-{int(time.time())}`, so two evaluations of the same candidate version within one second (e.g. the runner always uses `harness-v2-candidate`) produced identical receipt ids. `EvidenceRepository.save_receipt` upserts by `receipt_id` (unique index `uniq_receipt_id`), so the second run's receipt silently overwrote the first run's evidence. Failing test: `test_audit_eval_evaluator.py::test_receipt_ids_unique_within_same_second` (clock frozen to one second, two runs, ids equal before the fix). Fix: `int(time.time())` -> `time.time_ns()`; id prefix/format otherwise unchanged.

## UNVERIFIED/NEEDS OTHER OWNER
- evaluator.py:47 -- the envelope check hardcodes `parent_passed=True` even if the parent violates the envelope. This only makes promotion harder (conservative) and may be intended; not changed.
- evaluator.py:200 -- `input_hashes` are computed after validation, so a fixture modified between validation and hashing would be hashed but not the bytes validated (TOCTOU). Requires local write access to fixtures; no reproduction attempted.
- evaluator.py:26 -- default `fixtures_dir="fixtures"` resolves against the process cwd. All production callers pass an explicit root-based path or run from the repo root; changing the default would alter behavior, so left as is.
- evaluator.py:30,207 -- field `evaluator_hash` is the SHA-256 of the reference FASTA, not of the evaluator code (`EVALUATOR_VERSION` is unused). Naming/semantics concern; changing it would alter the receipt format.
- evaluator.py:59,86 -- `TestCaseResult.description` states the expected held-out outcome ("POS 110000"). Whether result descriptions reach proposers is outside this file (ADR-017 guard lives in holdout.py/search); owner eval_holdout / evolution.
- models.py (`EvidenceReceipt.create`) -- the digest payload omits `false_positive_rate` and `input_hashes`; belongs to eval_seal_models.
- A candidate is "caught" on any overall FAIL, not specifically a REF_MISMATCH finding. Probed all 16 ValidationPolicy combinations on the five fixtures: FAIL on the incident/held-out fixtures occurs only when `require_reference_allele_check` is true, and valid fixtures always PASS, so no gaming path found today.

## VERIFIED OK
- Promotion gate: requires envelope_ok, FPR == 0.0, candidate_passed > parent_passed, incident and held-out caught; tests cover promote (6/6 vs 4/6), identical parent/candidate (not promoted), envelope violation (not promoted), weakened candidate (incident/held-out missed, not promoted).
- Fail-closed behavior: non-PASS statuses (WARNING/INCONCLUSIVE/ERROR) on negative controls count as false positives; non-FAIL on incident cases count as missed; missing reference raises FileNotFoundError at construction.
- Validators are built from all four fields of `ValidationPolicySpec`; no fields dropped.
- Receipt binds parent/candidate spec hashes, run_id, scores, timestamp; ids are passed unchanged to the Mongo model in the runner.
- Existing tests run clean: test_harness_evolution, test_v7_evolution_search, test_optimizer_gate, test_v7_evidence_seal, test_ebi_disagreement.
