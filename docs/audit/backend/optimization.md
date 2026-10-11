# Audit: optimization (services/runtime/optimization/*)

## FIXED
1. reflection.py:46-60 Real coordinate-overflow findings were misdiagnosed. The validator emits `check_id="contig_length_boundary_check"` ("Position N exceeds contig 'X' length (L)"); the `"contig" in code` branch ran first and returned `CONTIG_NOT_FOUND` / `enforce_contig_compatibility` instead of `COORDINATE_OVERFLOW` / `enforce_boundary_guards`. Test: `test_real_coordinate_overflow_finding_is_not_diagnosed_as_missing_contig` (uses the real validator). Fix: coordinate branch moved before the contig branch and also matches `"boundary"` in the code.
2. reflection.py:25-33 `target_locus` was always `None` for real validator findings (`Finding.model_dump()` nests `chrom`/`pos` under `locus`; incident error signatures read `REF_ALLELE_MISMATCH:None`). Test: `test_real_finding_locus_is_read_from_nested_locus`. Fix: fall back to `locus.chrom` / `locus.pos`; flat keys still take precedence.
3. reflection.py:51 `"out of bounds" in details` was case-sensitive (every other branch lowercases) and raised `TypeError` when `details` was `None`. Tests: `test_out_of_bounds_detail_match_is_case_insensitive`, `test_reflector_tolerates_null_details`. Fix: `details` coerced to `str(... or "")`, comparisons use `details_lower`.
4. optimizer.py:52-55 Proposed candidate `HarnessSpec`s were deep copies of the parent with the parent's `parent_version_id` (None for the baseline) and `status=BASELINE`, contradicting `ProposedCandidate.parent_version_id` and the repo convention in `create_candidate_mutation`. Test: `test_proposed_candidate_spec_records_lineage_and_candidate_status`. Fix: set `parent_version_id=parent.version_id` and `status=CANDIDATE` on candidate 1 (candidate 2 inherits via deepcopy). Note: this changes `canonical_hash` values (they include `parent_version_id`/`status`); no test or artifact pins them.

## UNVERIFIED/NEEDS OTHER OWNER
- budgets.py:7-12, 20 `max_retries`, `timeout_seconds`, `max_tokens` and `BudgetTracker.start_time` are never read or enforced (PROGRESS.md claims retry/timeout limits are enforced). Enforcing them needs a design decision and callers; no change.
- optimizer.py:50-60 For `enforce_strict_header_syntax` and `request_metadata_clarification` (and any unmapped action) candidate 1 is an unchanged clone of the parent; candidate 2 enables all four policies regardless of hypothesis. Design choice, not a verified defect.
- optimizer.py:74-79 Candidate 2 inserts `inspect_reference` into `allowed_tools` even if the parent lacks it (a tool expansion; still within `PolicyEnvelope`, and `create_candidate_mutation` does similar).
- optimizer.py:50,64 Candidate ids (`<parent>-refl-1`, `-refl-composite`) are not content-addressed (cf. ADR-020 `stable_version_id`), so different hypotheses for the same parent yield the same id with different bodies. Nothing persists them today.
- reflection.py:41 REF branch also matches `reference_ref_allele_match` findings with status ERROR ("Error reading sequence"); these are diagnosed as `REF_ALLELE_MISMATCH`. Arguably should be inconclusive; left as is.
- reflection.py:32 `pos == 0` yields `target_locus=None` (`if pos`); VCF pos 0 is invalid so left.
- services/runtime/evolution/candidate_search.py:26-47 (evolution owner) has the same pattern as fix 4 (branches keep parent's `parent_version_id` and `status`).

## VERIFIED OK
- BudgetTracker limits for proposals/evaluator calls (off-by-one, `stopped_reason` set only when exceeded); `max_proposals` 0/1/N honored by the optimizer.
- Optimizer never mutates the parent (deepcopy), is deterministic across instances, and stays inside `PolicyEnvelope`; no policy is ever weakened (only toggled to True); no code execution, I/O, or network in this package.
- Reflector precedence for REF and contig/parse branches, unknown fallback, no held-out/ground-truth access (ADR-017 untouched).
- Tests: services/tests/test_audit_optimization.py (8 tests; offline, no Mongo); test_v7_optimization, test_v7_evolution_search, test_v7_incident_forensics, test_optimizer_gate, test_audit_route_investigations_capabilities pass with `MONGODB_DATABASE=diamond_audit_optimization`; ruff clean. A concurrent full-suite run showed failures only in other units' in-progress files (test_audit_mongo_client.py, test_audit_mongo_models.py); none touch this package.
