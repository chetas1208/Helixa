# Audit: route_health_scene (services/api/app/routes/health.py, scene.py)

## FIXED
None. No defect was reproduced, so no source file was changed.

## UNVERIFIED/NEEDS OTHER OWNER
- services/api/app/dependencies/__init__.py:25 (api_core): `get_mongo_client` falls back to `MongoDBClient()` when `app.state.mongo` is unset, so each health request would build a new, never-closed client. The real app always sets `app.state.mongo` in lifespan, so this only matters outside lifespan. Not reproduced as a defect; not my file.
- services/api/app/routes/health.py:68 (`raindrop.endpoint` exposed when CONFIGURED): the endpoint comes from `RAINDROP_ENDPOINT`. If an operator put credentials inside that URL they would be returned. Speculative, since the default is a plain URL, and no sanitization contract exists; left unchanged.
- services/api/app/routes/scene.py:41: the comment says "20-40s smooth morph window", but `cycle_phase >= 0.85` of 300 s is a 45 s window. This is comment drift only. The frontend does not consume `/api/scene/state` (grep of apps/web/src finds no use), so the window length is unverified. Not changed.
- services/api/app/routes/health.py: `/api/health` returns HTTP 200 with `status: DEGRADED` when Mongo is unreachable, while `/api/health/ready` returns 503. This matches the docstrings (liveness vs readiness), so it is treated as intended.

## VERIFIED OK
- `/api/health`: HEALTHY/CONNECTED when ping succeeds, DEGRADED/INACCESSIBLE when it fails. Ping failures are caught inside `MongoDBClient.ping`, so no 500 or driver error leaks. No credentials appear in the body.
- `/api/health/ready`: 200 only for `WRITE_VERIFIED`. `INACCESSIBLE` and `AUTHENTICATED` (write probe failed) return 503 with `ready=false` and `NOT_READY`. A real local Mongo check against an isolated audit DB returns 200, and the audit DB is dropped afterwards.
- `/api/integrations/status`: the Mongo URI is masked (`user:****@`). Raindrop and ElevenLabs report `NOT_CONFIGURED` without credentials, with no endpoint or voice id, and never a fabricated CONFIGURED (ADR-012, ADR-018). When enabled with keys, `CONFIGURED` is reported and the write key and API key do not appear in the response. An unreachable Mongo is reported as `INACCESSIBLE` with `write_verified=false`. An empty URI is reported as `NOT_CONFIGURED`.
- `/api/scene/state`: pure function of `time.time()` and a fixed epoch. Fixed-clock tests show identical output on repeated calls, `elapsed` clamped to 0 before the epoch, and `cycle_index`/`cycle_phase` consistent (`phase` in [0,1)). Style rotation over 5 styles wraps correctly, `next_style` is the following style, and the response is JSON serializable. It has no I/O and no input parameters, so there is no trust-boundary risk.
- Tests: services/tests/test_audit_route_health_scene.py (15 passed, run twice) and the existing services/tests/test_api_routes.py both pass. `ruff check` on both route files and the audit test is clean.
