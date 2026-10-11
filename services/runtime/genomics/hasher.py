from __future__ import annotations

import hashlib
import os
from pathlib import Path


def compute_sha256(file_path: str | Path) -> str:
    path = Path(file_path).resolve()
    hasher = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()

def compute_bytes_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def ensure_safe_path(base_dir: str | Path, relative_path: str) -> Path:
    """
    Ensure the path is safely enclosed inside base_dir without directory traversal.
    Strictly verifies boundary with trailing path separator.
    """
    base = Path(base_dir).resolve()
    clean_name = os.path.basename(relative_path)
    target = (base / clean_name).resolve()

    base_prefix = str(base)
    if not base_prefix.endswith(os.sep):
        base_prefix += os.sep

    if not (str(target) == str(base) or str(target).startswith(base_prefix)):
        raise ValueError(f"Path traversal detected: {relative_path} outside {base}")
    return target
