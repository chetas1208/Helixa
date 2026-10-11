# route_harnesses audit (services/api/app/routes/harnesses.py)

## FIXED
- services/api/app/routes/harnesses.py:22-29 `get_harness_lineage`: an unknown harness id returned 200 with the entire harness graph and a `root_version_id` that does not exist in persistence (contradicts the "never invented" docstring and the sibling `GET /{id}` 404 behavior). Failing test: `test_lineage_unknown_root_is_404_not_invented_root`. Fix: 404 via `get_version(id)` before building the lineage. Known roots are unchanged (existing `test_api_routes` flow and frontend call to `harness-v1` unaffected; frontend only consumes the response when `ok`).

## UNVERIFIED/NEEDS OTHER OWNER
- services/integrations/mongodb/repositories/harness_eval.py:28-31 (`list_versions`): hard `to_list(length=100)` silently truncates both `GET /api/harnesses` and lineage past 100 versions (mongo_repo_rest owner).
- harness_eval.py:33-60 (`get_lineage`): `root_id` is only echoed back; nodes/edges are the whole forest, not the subtree of the root (mongo_repo_rest owner; changing it alters response shape).
- harness_eval.py:23-25 / 28-31: a persisted document failing `HarnessVersionModel` validation would surface as a 500 from the route (repo-level handling choice).
- dependencies/__init__.py:`get_mongo_client` fallback builds a new, never-closed `MongoDBClient` per request when `app.state.mongo` is unset (api_core owner).

## VERIFIED OK
- `_id` is excluded by repo projections; responses use `model_dump(mode="json")`, no ObjectId leakage.
- Path param `id` is a plain `str` used only as an equality filter value (no operator injection possible); `{id}/lineage` vs `{id}` routing unambiguous.
- List ordering is deterministic (`created_at` ascending); read-only endpoints, no secrets exposed.
