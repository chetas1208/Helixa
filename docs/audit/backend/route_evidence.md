# Audit: route_evidence (services/api/app/routes/evidence.py)

## FIXED
- services/api/app/routes/evidence.py:15-18 (original), `GET /api/evidence/{id}`: the shared `evidence_receipts` collection also holds `ScientificEvidenceReceipt` documents written by `GenomicsOrchestrator._persist_to_mongo` (fields `source_artifact_sha256`, `overall_status`, ...). `EvidenceRepository.get_receipt*` coerces every hit into `EvidenceReceiptModel`, so looking up a validation receipt by receipt_id, digest or run_id raised an unhandled pydantic `ValidationError` (HTTP 500) instead of returning the receipt.
  - Failing test: `services/tests/test_audit_route_evidence.py::test_scientific_receipt_is_served_not_500` (failed with `ValidationError: 3 validation errors for EvidenceReceiptModel` before the fix).
  - Fix: iterate the same three lookups in the same order; on `ValidationError` fall back to the raw document (`_id` excluded) for that key, exactly as `GET /api/validation/{id}/evidence` already does. Response for `EvidenceReceiptModel` documents and the 404 behavior are unchanged.

## UNVERIFIED/NEEDS OTHER OWNER
- services/integrations/mongodb/repositories/evidence.py:25-27 (`get_receipt_by_run`): `find_one({"run_id": ...})` has no sort and `run_id` index is non-unique (client.py:261), so if several receipts exist for one run the one returned is unspecified. Not reproduced (the orchestrator/runner currently produce one receipt per run); belongs to mongo_repo_rest.
- services/integrations/mongodb/repositories/evidence.py:17-27: root cause of the shape mismatch (repo always parses to `EvidenceReceiptModel`); the route-level fallback is a containment, a repo/model-level solution belongs to mongo_repo_rest / mongo_models.

## VERIFIED OK
- Lookup order (receipt_id, receipt_digest, run_id) and 404 for unknown ids; tested.
- No `_id`/ObjectId leakage: repo projections exclude `_id`; `model_dump(mode="json")` used for typed receipts (tested).
- Path parameter is a plain string used only as a Mongo equality value (no operator injection possible; `{"field": str}`), no filesystem access, no unbounded reads.
- Router registration in main.py:87 and dependency `get_evidence_repo` behave correctly; existing `test_api_routes.py` passes.
