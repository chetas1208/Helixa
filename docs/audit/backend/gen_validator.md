# Audit: gen_validator (services/runtime/genomics/validator.py)

Tests: `services/tests/test_audit_gen_validator.py` (4 tests failed on the unmodified code, all 9 pass after the fixes).

## FIXED

1. `validator.py:46` (`validate`) - a VCF path that exists but is not a regular file (e.g. a directory) skipped the `file_existence_check` ERROR report and raised `IsADirectoryError` from `compute_sha256`. Test: `test_directory_path_yields_error_report_not_exception`. Fix: `exists()` -> `is_file()`.
2. `validator.py:113` (`has_reference_meta`) - substring test `"##reference=" in line` matched any header line that merely contained the text (e.g. an `##INFO ... Description="##reference=GRCh38"`), so `declared_assembly_check` reported PASS "Declared reference assembly present" with no declaration. Test: `test_assembly_declaration_requires_a_real_header_line` (companion `test_assembly_declaration_accepts_reference_and_assembly_lines` pins that real `##reference=` / `##assembly=` lines still PASS). Fix: `line.startswith(("##reference=", "##assembly="))`. No shipped fixture has either text mid-line.
3. `validator.py:226-237` - for `POS <= 0` the finding said "Position 0 exceeds contig ... length", which is false. Test: `test_zero_position_message_does_not_claim_length_overflow` (`test_position_past_contig_end_message_reports_overflow` pins the unchanged overflow message). Fix: separate message for `pos <= 0`; check_id/status/severity unchanged.
4. `validator.py:191` (unparseable-VCF early return) - the opened `pysam.FastaFile` was never `close()`d on this path (only released by GC; fd count did not grow in CPython, so this is explicit-close hygiene, not an observed fd leak). Test: `test_fasta_handle_closed_when_vcf_is_unparseable` (spy on `pysam.FastaFile`). Fix: close before the early return.

## UNVERIFIED/NEEDS OTHER OWNER

- `validator.py:66-67,155` - no FASTA (None, or a path that does not exist) silently skips the REF check and the report can be overall PASS even though `require_reference_allele_check=True`; no INCONCLUSIVE finding is emitted. Scientifically this is a false-PASS hazard (cf. ADR-006 #4, ADR-016 "missing FASTA is INCONCLUSIVE"), but callers (`orchestrator.py:101`, `runner.py:209`, `paired_scientific_eval.py`) rely on the current status mapping and a frozen oracle; changing it alters other units' outcomes, so not changed. Needs a decision from the owners/ADR.
- `validator.py:67` - a FASTA path that is a directory raises `IsADirectoryError` from `compute_sha256`; switching to `is_file()` would instead silently drop the REF check (see above), so left as is.
- `validator.py:355` - the source-mutation invariant is a bare `assert` (stripped by `python -O`, and raises instead of producing an ERROR finding). Deliberate fail-loud design; changing the failure mode is a behavior change. (An overlapping test for the bcftools unit references the same pattern.)
- `validator.py:173-177` - all VCF records are materialised in memory (`records`) with no size cap; large inputs are only bounded by ingestion limits.
- `validator.py:79-83` - header probe reads lines with no per-line length bound (hostile single-line file). Ingestion-level limits apply upstream.
- `validator.py:76` - gzip detection is by `.gz` suffix (case-sensitive); CAS storage always writes `.vcf.gz` so the in-repo flow is consistent, but a direct caller passing `X.GZ`/extension-less gzip gets a false "missing ##fileformat" ERROR from the header probe.
- `validator.py:204-222` - one `contig_compatibility_check` FAIL per record on an unknown contig (no de-duplication); noisy but not incorrect.
- `validator.py:320-333` - `indel_normalization_check` PASS message says "consistent anchor base" but no anchor-base test is performed; also fires for `*` alt. Changing it would alter frozen oracle expectations (`valid_indels_oracle`).
- `validator.py:30` - `SYMBOLIC_ALLELE_PATTERN` does not match `<*>`/`<NON_REF>`-style gVCF alleles or single breakends (`A.`); those go through the normal REF check (which is still valid), so no incorrect verdict was reproduced.

## VERIFIED OK

- 1-based `rec.pos` vs 0-based `fetch(pos-1, pos-1+len(ref))`, case-insensitive REF comparison, mismatch metadata (`declared_ref`/`fasta_ref`).
- Contig-missing FAIL, past-end boundary FAIL, symbolic/breakend INCONCLUSIVE path, multi-allelic/indel INFO findings.
- Overall-status precedence (ERROR > FAIL > WARNING > INCONCLUSIVE > PASS); absent assembly -> WARNING is frozen by the oracle and existing tests.
- Truncated gz: header IO error and `vcf_syntax_check` ERROR reported without raising.
- Read-only: source bytes unchanged, post-hash invariant holds, findings are deterministic across repeated runs.
- No subprocess, no network, no shell use in this module.
