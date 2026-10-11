# route_datasets audit (services/api/app/routes/datasets.py)

## FIXED
1. datasets.py:~70 (`declared_assembly=manifest.declared_assembly or "GRCh38"`): an uploaded dataset with no assembly metadata was recorded and served as declaring GRCh38 (ADR-006 #4: missing metadata must not become a declaration). Test: `test_undeclared_assembly_is_not_fabricated_as_grch38`. Fix: fall back to `"UNKNOWN"`.
2. datasets.py:~62 (upload error handling): a corrupt or truncated gzip upload raised `EOFError`/`gzip.BadGzipFile`/`zlib.error` from the ingestion gzip check, which fell into the generic handler and returned 500 for a client error. Tests: `test_upload_corrupt_gzip_is_client_error_not_500`, `test_upload_truncated_gzip_is_client_error_not_500`. Fix: map those exceptions to 400.
3. datasets.py:~64 (`detail=f"Ingestion failed: {e}"`): unexpected exceptions (e.g. `OSError` carrying CAS/tmp filesystem paths) were echoed to the client. Test: `test_internal_error_detail_does_not_leak_paths`. Fix: generic 500 detail, full traceback via `logger.exception`.

## UNVERIFIED/NEEDS OTHER OWNER
- datasets.py:~85 `except Exception: pass` around the Mongo upserts: upload returns INGESTED even if the dataset/artifact documents were not persisted, so a later `GET /api/datasets/{id}` can 404. Documented as intentional "graceful degradation"; changing the response contract is a design decision, so left unchanged.
- datasets.py:~48 `async def` handler runs blocking `stream_and_persist` (file I/O, gzip scan, SHA-256) on the event loop. Performance concern only; no correctness defect reproduced.
- datasets.py:~74 `fixtures={"primary_artifact": artifact.storage_path}` and the response `artifact.storage_path` expose the absolute server CAS path (also returned by `GET /api/datasets/{id}`). Other code may depend on it; needs api_schemas/validation owners to decide.
- Multipart body size is only limited after Starlette has fully received/spooled the request (the 25 MB cap in ingestion is applied while copying). Needs api_core (middleware) owner for a request-size limit.
- `FileIngestionService()` is built with the default relative `artifacts/cas` root, so the CAS location depends on process cwd (gen_ingestion / api_core config).
- ingestion.py sets `is_synthetic=True` for every uploaded file regardless of origin (gen_ingestion owner).
- `DatasetModel.declared_assembly` defaults to `"GRCh38"` in mongo_models (and the manifest fallback in repositories/datasets.py), the same ADR-006 concern, outside this unit's files.
- repositories/datasets.py `list_datasets` silently truncates at 100 docs (mongo_repo_rest owner).

## VERIFIED OK
- Route ordering: `POST /upload` and `GET /{id}` do not collide (different methods).
- Unsafe filenames (`../x`, `a/b`, `a\b`, `x..vcf`) rejected with 400 and nothing written to CAS.
- Unknown format -> 400; over-limit upload -> 413 and tmp file cleaned; gzip bomb -> 413.
- Round trip: upload stores bytes content-addressed, dataset retrievable via GET and list; no `_id`/ObjectId in responses; unknown id -> 404; `fixtures_count` correct for dict fixtures.
- Exception ordering (`IngestionLimitExceeded` before `ValueError`) is correct.
