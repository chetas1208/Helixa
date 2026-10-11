# Audit: gen_bcftools (services/runtime/genomics/bcftools_adapter.py)

Tests: `services/tests/test_audit_gen_bcftools.py`

## FIXED

1. `bcftools_adapter.py` `_execute` guard (was lines 54-63), now plus `_norm_sets_ref`. The `--check-ref s` prohibition (ADR-007) only matched the literal spellings `--check-ref s`, `-c s`, `--check-ref=s`, `-cs`. bcftools uses getopt_long, so these all selected silent REF rewrite and bypassed the guard: `--check s`, `--check-r s`, `--chec=s`, `-c ws` / `--check-ref ws` (the value is scanned with strchr, so any value containing `s` sets REF), and clustered short options such as `-Dcs`. Reproduced against the repo's bcftools: `norm --check s ...` and `-c ws` rewrote REF `G`->`T` on `fixtures/invalid/ref_mismatch.vcf`.
   - Failing tests: `test_norm_rejects_every_spelling_of_check_ref_set[args4..args13]`.
   - Fix: for `norm` only, parse args like getopt (long-option prefixes of `--check-ref`, `=` or separate value, short clusters with argument-consuming options) and reject any value containing `s`. Legitimate args (`-ocs`, `--fasta-ref /x/cs/..`, `-c e|w|x`, `stats -c snps`) are covered by passing tests.
2. `normalize` (output path validation). `output_path` equal to the input VCF (or FASTA), directly or via symlink/hardlink, made bcftools overwrite the source; the post-hoc hash check then raised only after the original bytes were destroyed (ADR-007 violation). Reproduced: original sha changed and size dropped to 681 bytes.
   - Failing tests: `test_normalize_refuses_output_path_equal_to_input_and_preserves_source`, `test_normalize_refuses_symlink_alias_of_input`, `test_normalize_refuses_output_path_equal_to_reference`.
   - Fix: raise `ValueError` before running when the output resolves to or is the same file as the input VCF or FASTA.
3. `normalize` source-integrity invariant used `assert`, which is stripped under `python -O`, silently disabling the check. Failing test: `test_source_mutation_invariant_is_not_an_assert_statement` (runs `python -O` in a subprocess). Fix: explicit `raise RuntimeError` with the same message. The orchestrator catches `Exception`, so its handling is unchanged.
4. `__init__` `bin_path`. A relative `bcftools_path` that exists was kept relative, but `_execute` runs with `cwd=scratch_dir`, so the subprocess failed with FileNotFoundError. Failing test: `test_relative_bcftools_path_survives_scratch_cwd`. Fix: `os.path.abspath` (no symlink resolution) for the existing-path branch.

## UNVERIFIED/NEEDS OTHER OWNER

- `bcftools_adapter.py` receipt id (`rcpt-bcf-<epoch ms>`): two receipts created in the same millisecond (e.g. concurrent threads) would collide. No unique index or concurrent caller exists for tool receipts today (the `uniq_receipt_id` index is on evidence receipts), so I could not show an impact. Not changed.
- `TOOL_VERSION = "1.24"` is a class constant and is never checked against the binary, so the receipt could report a wrong version if another bcftools is on PATH. Fixing needs an extra subprocess call and a receipt behavior change. Not changed.
- `_execute` input_hashes silently skips input paths that do not exist, so the receipt omits them (bcftools itself fails in that case). Left as is.
- `normalize` on a nonzero bcftools exit or a timeout leaves a partial `output_path` file behind. Left as is: it is derived scratch data, not the source.
- ADR-010 mentions "output size truncation": only the receipt summaries are truncated to 1000 chars. `subprocess.run(capture_output=True)` buffers full stdout (`view -h` returns the full header). Not exploitable here, since the subcommands are fixed.
- `/home/923873155/.local/bin/bcftools` is a local pysam shim (not a real binary, outside the repo). For a non-UTF-8 byte in a header, `view -h` through the shim returns `str(bytes)` (a `b'...'` repr). This is a shim defect, not an adapter defect; needs the environment owner.
- `_execute` is the sole enforcement point and is called with a private contract; the public methods only build fixed argument lists. The guard is defense in depth for future callers.

## VERIFIED OK

- Subprocess is invoked with an argument list (no shell), a timeout (kill on expiry, surfaced as `BcftoolsTimeoutError`), a sanitized env (`LC_ALL`, `PATH` only) and an isolated cwd.
- Subcommand allowlist (`norm`, `view`, `stats`, `index`) enforced before any execution; other subcommands raise `UnsafeBcftoolsCommandError`.
- `check_ref` uses `--check-ref e` with `-o /dev/null` (read-only) and returns the receipt with the real exit code.
- `normalize` output is a separate derived artifact: parent hash, derived hash, `is_derived`, and `output_artifact_hashes` are consistent. The source hash is verified before and after.
- Receipt fields (argv, input hashes, truncated stdout/stderr, runtime, timestamp) match the `ToolExecutionReceipt` contract.
- Existing tests `test_m02_genomics.py`, `test_genomics_validator.py` and the orchestrator/oracle/ingestion/contracts audit tests pass.
