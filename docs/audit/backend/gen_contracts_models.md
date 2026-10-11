# Audit: gen_contracts_models
Files: services/runtime/genomics/contracts.py, models.py, __init__.py

## FIXED
1. contracts.py `ValidationRun` (alias pairs `status`/`overall_status` and `tool_receipts`/`tool_traces`):
   - Defect: the aliases were synchronised only at construction. the orchestrator (`orchestrator.py:107`, `run.status = val_report.status`; `run.tool_receipts.extend/append`) left `overall_status` at its default `PASS` and `tool_traces` empty, so the run document persisted to Mongo (`run.model_dump`) could say `status: FAIL` with `overall_status: PASS` and carry receipts only under one name. Consumers that read `overall_status` (oracle, evaluator, holdout, v8 experiment, runner) would see a stale PASS.
   - Failing tests (failed before fix, pass after): `test_validation_run_status_assignment_keeps_overall_status_in_sync`, `test_validation_run_overall_status_assignment_keeps_status_in_sync`, `test_validation_run_tool_receipt_mutation_is_visible_in_tool_traces`, `test_validation_run_tool_receipts_assignment_keeps_tool_traces_in_sync`, `test_validation_run_roundtrip_and_copy_keep_aliases_consistent` (services/tests/test_audit_gen_contracts_models.py).
   - Fix: `__setattr__` mirrors assignments across each alias pair; an `after` validator makes `tool_traces` the same list object as `tool_receipts` when they are equal, so in-place `append/extend` is visible under both names. Field names, dump shape, constructor behaviour and signatures are unchanged.

## UNVERIFIED/NEEDS OTHER OWNER
- contracts.py `ValidationFinding.sync_legacy_fields` / `ToolExecutionReceipt.sync_trace_fields` / `ValidationRun.sync_report_fields` (before-validators): they mutate the caller's input dict in place (adds alias keys) when given a dict via `model_validate`. Reproducible, but no caller in services/ reuses the dict afterwards, so no demonstrated harm; not changed.
- contracts.py `ValidationFinding` alias pairs (`artifact_id`/`source_artifact_sha256`, `reference_artifact_id`/`reference_sha256`, `evidence_ids`/`evidence_pointers`) and `ToolExecutionReceipt` pairs are also only synced at construction. No post-construction mutation site exists in services/, and `artifact_id` vs `source_artifact_sha256` are passed with different values by validator.py, so they are not strict aliases; left unchanged. Passing an explicit `artifact_id=None` (without the sha) would raise a ValidationError (None copied into a `str` field); no caller does this.
- contracts.py:42-47 `LocusCoordinate.pos` has no `>= 1` constraint and `DatasetManifest.byte_size` no `>= 0`; adding constraints would be a behaviour change with no demonstrated defect.
- contracts.py:206-260 `ScientificEvidenceReceipt.create`: digest covers receipt_id, run_id, source sha, declared ref, fasta sha, tool_chain, findings_summary, overall_status, derived hashes but NOT `timestamp` or `metadata`; there is no verify method in this module (by design as far as DECISIONS.md V7-ADR-003 concerns the separate EvidenceSealV1). Not changed.
- orchestrator.py:152-160 and :200-206 (other owner, gen_orchestrator): `_persist_to_mongo` swallows all exceptions silently; and the normalization `except` appends `None` to `tool_receipts` if the vcf is missing. Not mine.
- Observed during final suite run (not related to this unit): concurrent failing-first tests of other units (route_investigations_capabilities, route_datasets gzip bomb, api_core) were red at the time of the run.

## VERIFIED OK
- models.py and __init__.py: pure re-exports; every name in `__all__` resolves; alias names (`Finding`, `LocusInfo`, `ToolTrace`, `ValidationReport`) point to the contracts classes (test_models_module_reexports_contract_classes). No circular import (genomics/__init__ imports validator last).
- Enum definitions, defaults (`default_factory` used for all mutable defaults, no shared state), UTC ISO timestamps.
- Construction-time legacy alias sync for Finding, ToolExecutionReceipt, ValidationRun (test_finding_and_receipt_legacy_aliases_unchanged, test_validation_run_alias_construction_still_works).
- `ScientificEvidenceReceipt.create` digest is deterministic (sorted keys, UTF-8 sha256), enum serialised via `.value`.
