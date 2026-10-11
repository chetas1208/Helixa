# Audit: int_biomni (services/integrations/biomni/*)

## FIXED
Test file: services/tests/test_audit_int_biomni.py. Each test failed on the original code and passes now.
- adapter.py:99 (original) Symlink rejection was dead code. `Path(raw_path).resolve()` follows the link, so `.is_symlink()` on the result was always False. A symlinked input was analysed. Test: `test_symlink_input_is_rejected`. Fix: check `Path(raw_path).is_symlink()` before `resolve()`.
- adapter.py:107 (original) The `allowed_workspaces` constructor argument was stored and never used, so an adapter built with an explicit workspace read any path. Test: `test_explicit_allowed_workspaces_are_enforced`. Fix: when the caller passes a non-empty `allowed_workspaces`, the resolved target must be inside one of them, else exit 126 `SECURITY_VIOLATION`. The default (no argument) is unchanged, with `test_default_adapter_does_not_restrict_workspace` as a guard. See UNVERIFIED for the default.
- adapter.py:107-114 (original) Only `exists()` was checked, so a FIFO, a device or a directory reached `open()`. A FIFO blocks the worker forever, and `/dev/zero` is an unbounded read. Tests: `test_fifo_input_is_rejected_without_blocking`, `test_directory_input_is_rejected_as_not_a_file`. Fix: reject non-regular files with exit 2 `not a regular file`.
- adapter.py:173 (original) `_inspect_security_violations` only recursed into `list`, so a `tuple`, `set` or `frozenset` argument bypassed the forbidden-token scan. Test: `test_tuple_arguments_are_scanned_for_forbidden_tokens`. Fix: recurse into `(list, tuple, set, frozenset)`.
- adapter.py:211 (original) A record with `ALT="."` (no alternate allele) and a one-base REF was counted as an SNV, so `snv_count` was inflated. Test: `test_alt_missing_value_is_not_counted_as_snv`. Fix: skip `ALT == "."` in the per-allele loop. `total_records` still counts the line.

## UNVERIFIED/NEEDS OTHER OWNER
- adapter.py:47 The default adapter (no `allowed_workspaces`) still reads any absolute path the caller names. Enforcing the cwd default would break callers that run from another directory, including services/runtime/v8/experiment.py and scripts/verify_v8.py, which pass tmp or fixture paths. Whether to enforce by default is a design decision for the caller owners.
- adapter.py:222 `titv_ratio` is `float(transitions)` when there are no transversions. The mathematically undefined ratio is reported as a number. scripts/verify_v8.py:128 asserts 2.0 for a fixture with transversions, so the 0-transversion case is untested. Changing it to None would change the output schema, so it was left.
- adapter.py:211-220 ALT `*` (spanning deletion) is counted as an SNV when REF is one base. Symbolic ALTs (`<DEL>`) and equal-length MNPs are counted under `indel_count`. The correct bucketing is a policy choice. Only the unambiguous `.` case was fixed.
- adapter.py:182-222 and :281-299 VCF parsing is unbounded. `resource_budget.timeout_sec` and `max_memory_mb` from the manifests are never enforced, so a gzip bomb or a single huge line is read in full. There is no limit in the contract to enforce against, so no change.
- capability_manifest.py:22, :44 `accepted_formats` lists `bed` for the liftover and region-overlap tools, but nothing enforces formats and the region counter parses every file as VCF. A BED file would count its 0-based start as POS. Manifest formats are never checked by any caller (grep: only scripts/verify_v8.py counts manifests), so the manifest and parser need a joint decision.
- capability_manifest.py:28-35, :17-26 The `biomni_variant_consequence_lookup` manifest says it "performs consequence annotation" while the tool always errors (ADR-014). The liftover manifest says it "inspects and validates" translation but only reports INCONCLUSIVE. This is misleading advertising, but changing descriptions touches the V8 receipt surface, so it was left.
- adapter.py:34-38 The forbidden patterns are applied to the file path as well. Paths containing words such as `exec` (as in `exec.vcf`), `requests`, `;`, `|`, `<` or `>` are rejected. This is fail-closed, so it is not a vulnerability. It is a false-positive risk only.
- adapter.py:49-54 `health()` is hard-coded CONNECTED and is not probed. This matches the static v8 health route.

## VERIFIED OK
- ADR-014: nothing imports `biomni`. `test_biomni_security.py` asserts `biomni` is not in `sys.modules`. Consequence annotation is always refused. Liftover without a chain is INCONCLUSIVE, and no genome build is inferred or coordinates rewritten (ADR-006).
- Unknown tool id gives ERROR exit 1. Forbidden tokens in `tool_id`, path and nested argument keys and values give exit 126. `..` and NUL in the path give exit 126.
- Header instruction text is only counted, never executed (`instruction_text_executed` is False).
- Ti/Tv and transition/transversion counting (gzip and plain), multiallelic counting, and `_parse_region`/`_count_overlapping_records` (inclusive 1-based bounds, exact contig match with no chr/non-chr normalisation, invalid regions ignored and INCONCLUSIVE when none are valid).
- `output_artifact_hashes` is a deterministic SHA-256 of the sorted-key JSON findings. Exceptions are caught and returned as ERROR exit 1 without a traceback.
- Existing tests: services/tests/test_biomni_security.py, test_audit_v8_experiment.py, test_audit_route_v8.py and test_transfer_ablation.py pass.
