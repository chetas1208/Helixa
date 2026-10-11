# Audit: gen_ingestion (services/runtime/genomics/ingestion.py)

## FIXED
1. ingestion.py (stream_and_persist tmp path): temp filename was `upload_{pid}_{datetime.now().timestamp()}.tmp`. Two concurrent uploads in one process that sample the same clock value share one temp file; the later one's `shutil.move` then lets the earlier upload keep appending to the inode now at the other upload's CAS path, silently corrupting a content-addressed object (stored bytes no longer match `artifact_sha256`). Test: `test_concurrent_uploads_with_identical_clock_do_not_share_tmp_file` (clock frozen to model a tick collision; failed with differing stored bytes). Fix: use `uuid.uuid4().hex` in the temp name.
2. ingestion.py (`_verify_gzip_safety`): a truncated gzip, or gzip magic bytes followed by garbage, raised raw `EOFError` / `gzip.BadGzipFile` instead of `InvalidGenomicFileError`, so `/api/datasets/upload` answered 500 for a client error (the repo's own `fixtures/invalid/truncated.vcf.gz` triggered it). Tests: `test_truncated_gzip_is_invalid_genomic_file`, `test_gzip_magic_with_garbage_body_is_invalid_genomic_file`, `test_repo_truncated_fixture_is_invalid_genomic_file`. Fix: wrap `gzip.BadGzipFile`, `EOFError`, `zlib.error` into `InvalidGenomicFileError` (tmp file is still cleaned by the existing handler). `IngestionLimitExceeded` is unaffected.
3. ingestion.py (`_verify_gzip_safety` / format detection): any file starting with gzip magic was accepted and stored as `vcf.gz` without looking at the decompressed content, so a gzip of arbitrary bytes bypassed the "unknown format" rejection that plain files get. Test: `test_gzip_of_non_genomic_content_is_rejected`. Fix: sniff the first decompressed bytes with the existing `detect_format_and_compression`; reject `unknown` after the size-budget pass (so decompression bombs still yield `IngestionLimitExceeded`/413, preserving `test_audit_route_datasets.py::test_upload_gzip_bomb_is_413`).

## UNVERIFIED/NEEDS OTHER OWNER
- ingestion.py:35-44 (`max_header_lines`, `max_records`): accepted and stored but never enforced anywhere. Whether limits are meant to be enforced here or in the validator is a design question; no behavior changed.
- ingestion.py (manifest creation, `is_synthetic=True`): every uploaded file is recorded as synthetic regardless of origin. Scientifically questionable for user uploads but it matches the `DatasetManifest` default and changing it alters an API payload; needs owner decision (contracts/route_datasets).
- ingestion.py (`stream_and_persist`): temp file is not fsynced before rename, and only `Exception` (not `BaseException`) triggers temp cleanup. Crash-durability and interrupt cases are not reproducible in a deterministic test, so left as is.
- ingestion.py (`detect_format_and_compression`): `#CHROM` anywhere in the first 1024 bytes is enough to classify as VCF, and a gzipped FASTA is labeled `vcf.gz`. Heuristic is loose but not shown to cause a wrong outcome; unchanged.
- ingestion.py:48: `sanitize_filename` rejects any `..` substring (e.g. `a..b.vcf`); this is mandated by ADR-011, so left as is. The sanitized name is never used to build a filesystem path (CAS names derive from the SHA-256).
- services/api/app/routes/datasets.py (not owned): upload route swallows MongoDB persistence errors with `pass` and instantiates `FileIngestionService()` on the default relative `artifacts/cas` (cwd dependent). Belongs to route_datasets.

## VERIFIED OK
- Streaming SHA-256 matches stored bytes; post-store re-hash check; dedup of identical content (same CAS path).
- Upload limit boundary (exactly max accepted, max+1 rejected), tmp cleanup on every error path (limit, unknown format, empty upload, corrupt gzip).
- Short reads (1 byte at a time) still yield a correct header sample and format detection.
- `sanitize_filename` rejects empty, whitespace-only, `..`, `/`, `\`, NUL, None (ADR-011) and returns stripped names otherwise.
- Gzip bomb guard (multi-member handled by `gzip.open`), `IngestionLimitExceeded` -> 413 path preserved.
- Tests run: `test_audit_gen_ingestion.py`, `test_m02_genomics.py`, `test_audit_route_datasets.py`, `test_v7_incident_forensics.py`, `test_api_routes.py` (the latter on a fresh DB; `test_api_datasets_endpoint` depends on DB contents/ordering and fails only when upload tests have populated the same DB first, independent of this module).
