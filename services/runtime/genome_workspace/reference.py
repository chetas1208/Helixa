"""Bounded educational reference slice. This file is synthetic. It is not GRCh38."""

from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path

REFERENCE_PATH = Path(__file__).resolve().parents[3] / "fixtures" / "references" / "ref_synthetic_chr22.fasta"
ASSET_ID = "ref_synthetic_chr22"
ASSEMBLY = "synthetic-chr22-educational"
CONTIG = "chr22"
LICENSE_NOTE = (
    "Local synthetic FASTA shipped with DIAMOND fixtures. "
    "Not an official GRCh38 download. No patient sequence."
)


@lru_cache(maxsize=1)
def sequence() -> str:
    parts: list[str] = []
    for line in REFERENCE_PATH.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith(">"):
            continue
        parts.append(line.strip().upper())
    text = "".join(parts)
    if not text or any(base not in "ACGTN" for base in text):
        raise ValueError(f"unexpected bases in {REFERENCE_PATH}")
    return text


def checksum() -> str:
    return hashlib.sha256(sequence().encode("ascii")).hexdigest()


def base_at(position: int) -> str:
    """1-based coordinate on the synthetic contig."""
    text = sequence()
    if position < 1 or position > len(text):
        raise ValueError(f"position {position} is outside 1..{len(text)}")
    return text[position - 1]


def window(start: int, end: int) -> str:
    if end < start:
        raise ValueError("end is before start")
    if end - start > 400:
        raise ValueError("window is capped at 400 bases")
    text = sequence()
    if start < 1 or end > len(text):
        raise ValueError(f"window outside 1..{len(text)}")
    return text[start - 1 : end]
