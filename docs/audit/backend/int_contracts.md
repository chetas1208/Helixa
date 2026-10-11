# Audit: int_contracts
File: services/integrations/contracts.py (untracked/new in working tree; 11 pydantic models + 1 enum, no logic)

## FIXED
None. No defect was reproduced; the module is declarative (field definitions and defaults only).

## UNVERIFIED/NEEDS OTHER OWNER
- contracts.py:42,54,69,77,108,116 (`status`, `optimizer_source`, `decision`, `ExternalIntegrationHealth.status` are free `str`; the allowed values exist only in comments). Tightening to Literal/Enum would change accepted input and could reject values other units write; the comment on :77 lists `REFLECTIVE_DETERMINISTIC` while callers (gepa_adapter.py:84, search_adapter.py) write `DETERMINISTIC`, and :116 omits `NOT_CONFIGURED` (ADR-018). Comment-only drift, no runtime impact demonstrated; not changed.
- contracts.py:35 `ToolInvocationRequest.artifact_id_or_path` has no `min_length`. An empty string resolves to the cwd in biomni/adapter.py (`Path("").resolve()`); the adapter then fails on a directory and returns an ERROR result via its generic `except`, so no demonstrated harm. Path-safety is the adapter's job (int_biomni owner).
- contracts.py:48 `runtime_ms: float` accepts NaN/inf; NaN dumps to JSON `null` which fails re-validation. Only perf_counter-derived values are written in services/, so unreachable in practice.
- contracts.py:10 `AdjudicationVerdict(str, Enum)`: `f"{verdict}"`/`str(verdict)` yields `AdjudicationVerdict.X` (Python 3.12), not the value. All current consumers use `.value` (proof_receipt.py:67,87; paired_scientific_eval.py; audit_system.py:320) and `model_dump(mode="json")` emits the value, so no demonstrated harm; switching to StrEnum would be a behavior change.
- Duplicate, differently-shaped class names (`GenomicIncident`, `EvidenceReceiptV8`, `ToolInvocationRequest`, ...) exist in services/runtime/v8/contracts.py (other owner); the two are not interchangeable. Not touched.
- Digest scope of `EvidenceReceiptV8` (proof_receipt.py compute_v8_receipt_digest) excludes receipt_id, created_at and metadata (evidence_receipt owner); not this file.

## VERIFIED OK
- All mutable defaults use `default_factory`; instances do not share lists/dicts (test_mutable_defaults_are_not_shared_between_instances).
- `created_at` defaults are per-instance, timezone-aware UTC ISO-8601 (test_incident_created_at_is_utc_iso_and_per_instance).
- Required fields and enum membership are enforced; enum values are stable and exact-case (tests: required_fields, adjudication_verdict_values).
- JSON dump/validate round trips are lossless for GenomicIncident, HarnessCandidatePatch, EvaluationRun, EvidenceReceiptV8; the verdict serialises as its value.
- Digest produced by `mint_v8_receipt` verifies after a JSON round trip and detects gate/decision tampering; pydantic bool coercion of `safety_gates` is consistent between mint and verify.
- Every importer (biomni adapter/manifest, ebi_vcf validator, holdout, paired eval, gepa/search adapters, proof_receipt, v8 experiment, scripts) uses only names/fields that exist in this module.
