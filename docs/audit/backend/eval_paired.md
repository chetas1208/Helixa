# eval_paired audit: services/runtime/evaluation/paired_scientific_eval.py

## FIXED
1. paired_scientific_eval.py:93,184 (`adjudicate`): the "no FASTA => INCONCLUSIVE" downgrade only fired for `fasta_path is None`. A nonexistent path or `""` left `fasta_hash` None, EBI skipped its assembly checker, native skipped the REF check, and the result was `AGREE_PASS` with `reference_sha256=None`, i.e. a REF-concordance claim with no reference (violates ADR-016 / ADR-006). Test: `test_unusable_fasta_path_cannot_yield_agree_pass` (2 params). Fix: key the downgrade on `fasta_hash is None` (hash now uses `is_file()`); message says "no usable FASTA".
2. paired_scientific_eval.py:190 (`adjudicate`): `AGREE_PASS` was issued whenever both statuses were PASS, even if the EBI assembly checker never ran (`ebi_report.assembly_valid is None` with a FASTA supplied, e.g. assembly binary not executable, which EbiVcfValidator skips silently). Agreement was claimed for a check one engine did not perform. Test: `test_agree_pass_requires_ebi_assembly_confirmation`. Fix: `AGREE_PASS` additionally requires `assembly_valid is True`, otherwise `INCONCLUSIVE`. Real-binary paths still yield `AGREE_PASS` (`test_supplied_fasta_with_assembly_confirmation_still_agrees_pass`, test_ebi_disagreement.py, holdout gate 5).
3. paired_scientific_eval.py:68 (`adjudicate`): a VCF path that is a directory passed `exists()` and then raised `IsADirectoryError` from `compute_sha256`, escaping the TOOL_ERROR/quarantine contract used for missing VCFs. Test: `test_directory_vcf_is_tool_error_not_exception`. Fix: `exists()` -> `is_file()`.

## UNVERIFIED/NEEDS OTHER OWNER
- A directory passed as `fasta_path` still raises `IsADirectoryError`, now from `DeterministicGenomicsValidator.validate` (validator.py `Path(fasta_path).exists()` then `compute_sha256`), not from this file. Needs gen_validator owner (`exists()` -> `is_file()`).
- EbiVcfValidator.validate silently skips the assembly checker when the binary exists but is not executable (ebi_vcf/validator.py, `os.access(..., X_OK)` branch) and `is_available()` ignores the exec bit. Mitigated here by fix 2; root cause belongs to int_ebi.
- paired_scientific_eval.py:81-87 missing-VCF result sets `reference_sha256="NONE"` while every other path uses `None` when no FASTA; inconsistent sentinel, left unchanged (public value).
- paired_scientific_eval.py:66,72,128,170 incident ids / default run id use `uuid4`, non-deterministic; no determinism requirement is stated for incident ids in DECISIONS.md, so not changed.
- Native `WARNING` is treated as pass (line 112), so `absent_assembly.vcf` / `ambiguous_assembly.vcf` give `AGREE_PASS` with a FASTA. ADR-006 item 4 says missing assembly metadata is INCONCLUSIVE; the validator emits WARNING per its frozen oracle cases. The verdict only claims REF/syntax agreement, not build identity, so left unchanged; flag for ADR owner.
- VCF/FASTA hashes are computed before the validators read the files (TOCTOU if the file changes mid-call); native validator asserts its own byte invariant, EBI does not.
- AGREE_FAIL does not check that the two engines failed for the same reason; design choice.
- `heldout_contig_mismatch.vcf` fails in both engines, so the verdict is `AGREE_FAIL`. A test that required `DISAGREE` for that file was corrected on 2026-10-11; disagreement remains covered when one engine passes and the other fails.

## VERIFIED OK
- Verdict matrix: ERROR on either side -> TOOL_ERROR with QUARANTINED incident; pass/pass -> AGREE_PASS; fail/fail -> AGREE_FAIL; pass/fail either direction -> DISAGREE with incident and diverging_checks from both engines; anything else (native INCONCLUSIVE) -> INCONCLUSIVE.
- Checked against every fixture under fixtures/invalid, valid, heldout with the real native + EBI binaries; verdicts consistent with the engines' reported statuses.
- `is_concordant` / `requires_quarantine` properties; `_locus_text` handles None/str/LocusCoordinate.
- Missing VCF path returns TOOL_ERROR with incident, never raises; original VCF bytes untouched (test_ebi_disagreement).
- Consumers (holdout.py gate 5, v8/experiment.py, scripts/verify_v8.py, scripts/audit_system.py) only use verdict/is_concordant/requires_quarantine; unaffected for the valid-fixture-with-FASTA path.
