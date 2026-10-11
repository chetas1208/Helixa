from __future__ import annotations

import gzip
import hashlib
import os
import shutil
import uuid
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO

from .contracts import ArtifactRecord, DatasetManifest


class IngestionLimitExceeded(ValueError):
    """Raised when an uploaded file violates security or size limits."""
    pass

class InvalidGenomicFileError(ValueError):
    """Raised when an uploaded file has an invalid format or header."""
    pass

class FileIngestionService:
    """
    Hardened genomic file ingestion and content-addressed storage (CAS).
    Enforces size limits, gzip bomb guards, streaming SHA-256, and atomic persistence.
    """

    def __init__(
        self,
        cas_root: str | Path = "artifacts/cas",
        max_upload_mb: int = 25,
        max_decompressed_mb: int = 100,
        max_header_lines: int = 10000,
        max_records: int = 50000,
    ):
        self.cas_root = Path(cas_root).resolve()
        self.tmp_dir = self.cas_root / "tmp"
        self.cas_root.mkdir(parents=True, exist_ok=True)
        self.tmp_dir.mkdir(parents=True, exist_ok=True)

        self.max_upload_bytes = max_upload_mb * 1024 * 1024
        self.max_decompressed_bytes = max_decompressed_mb * 1024 * 1024
        self.max_header_lines = max_header_lines
        self.max_records = max_records

    @staticmethod
    def sanitize_filename(filename: str) -> str:
        if not filename or ".." in filename or "/" in filename or "\\" in filename or "\x00" in filename:
            raise ValueError(f"Unsafe or malformed filename: '{filename}'")
        clean = os.path.basename(filename).strip()
        if not clean:
            raise ValueError(f"Unsafe or malformed filename: '{filename}'")
        return clean

    @staticmethod
    def detect_format_and_compression(initial_bytes: bytes) -> tuple[str, bool]:
        """Detect file format and compression via magic bytes."""
        is_gzip = initial_bytes.startswith(b"\x1f\x8b")
        if is_gzip:
            return "vcf.gz", True
        if initial_bytes.startswith(b"##fileformat=VCF") or b"#CHROM" in initial_bytes[:1024]:
            return "vcf", False
        if initial_bytes.startswith(b">"):
            return "fasta", False
        # Fallback check
        return "unknown", False

    def stream_and_persist(
        self,
        stream: BinaryIO,
        original_filename: str,
        dataset_id: str | None = None,
    ) -> tuple[ArtifactRecord, DatasetManifest]:
        """
        Streams input stream, validates limits, computes SHA-256 on the fly,
        writes atomically to CAS, and returns ArtifactRecord and DatasetManifest.
        """
        clean_name = self.sanitize_filename(original_filename)
        now_str = datetime.now(timezone.utc).isoformat()

        tmp_file = self.tmp_dir / f"upload_{os.getpid()}_{uuid.uuid4().hex}.tmp"
        hasher = hashlib.sha256()
        total_bytes = 0
        header_sample = bytearray()

        try:
            with open(tmp_file, "wb") as f_out:
                while True:
                    chunk = stream.read(65536)
                    if not chunk:
                        break
                    total_bytes += len(chunk)
                    if total_bytes > self.max_upload_bytes:
                        raise IngestionLimitExceeded(
                            f"Uploaded file exceeds maximum limit of {self.max_upload_bytes} bytes."
                        )
                    hasher.update(chunk)
                    f_out.write(chunk)
                    if len(header_sample) < 2048:
                        header_sample.extend(chunk[: 2048 - len(header_sample)])

            artifact_sha256 = hasher.hexdigest()
            file_format, is_compressed = self.detect_format_and_compression(bytes(header_sample))

            if file_format == "unknown":
                raise InvalidGenomicFileError(
                    f"Uploaded file '{clean_name}' does not match supported VCF/FASTA formats."
                )

            # Check for gzip bomb if compressed
            if is_compressed:
                self._verify_gzip_safety(tmp_file)

            # Determine extension and CAS destination
            ext = ".vcf.gz" if is_compressed else (".fasta" if file_format == "fasta" else ".vcf")
            cas_filename = f"{artifact_sha256}{ext}"
            final_path = self.cas_root / cas_filename

            # Atomic move / replace
            shutil.move(str(tmp_file), str(final_path))

            # Verify hash post-storage
            verify_hasher = hashlib.sha256()
            with open(final_path, "rb") as f_verify:
                while chunk := f_verify.read(65536):
                    verify_hasher.update(chunk)
            if verify_hasher.hexdigest() != artifact_sha256:
                if final_path.exists():
                    final_path.unlink()
                raise RuntimeError("Integrity verification failed: stored hash does not match computed hash.")

            # Create records
            ds_id = dataset_id or f"ds-{artifact_sha256[:12]}"
            artifact_record = ArtifactRecord(
                artifact_id=f"art-{artifact_sha256[:12]}",
                artifact_sha256=artifact_sha256,
                dataset_id=ds_id,
                filename=clean_name,
                file_format=file_format,
                byte_size=total_bytes,
                is_compressed=is_compressed,
                is_derived=False,
                storage_path=str(final_path),
                storage_backend="local_cas",
                created_at=now_str,
            )

            manifest = DatasetManifest(
                dataset_id=ds_id,
                file_type=file_format,
                artifact_sha256=artifact_sha256,
                byte_size=total_bytes,
                is_synthetic=True,
                created_at=now_str,
                metadata={"original_filename": clean_name},
            )

            return artifact_record, manifest

        except Exception:
            if tmp_file.exists():
                tmp_file.unlink()
            raise

    def _verify_gzip_safety(self, gz_path: Path) -> None:
        """Inspects compressed file to guard against decompression bombs and non-genomic payloads."""
        decompressed_bytes = 0
        inner_format = "unknown"
        try:
            with gzip.open(gz_path, "rb") as gz_in:
                while chunk := gz_in.read(65536):
                    if decompressed_bytes == 0:
                        inner_format, _ = self.detect_format_and_compression(chunk[:2048])
                    decompressed_bytes += len(chunk)
                    if decompressed_bytes > self.max_decompressed_bytes:
                        raise IngestionLimitExceeded(
                            f"Decompressed file size exceeds safety budget of {self.max_decompressed_bytes} bytes."
                        )
        except (gzip.BadGzipFile, EOFError, zlib.error) as e:
            raise InvalidGenomicFileError(f"Corrupt or truncated gzip stream: {e}") from e
        if inner_format == "unknown":
            raise InvalidGenomicFileError(
                "Compressed file content does not match supported VCF/FASTA formats."
            )
