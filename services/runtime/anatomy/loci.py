"""Pinned GRCh38 slices (Ensembl release 116). Immutable; never rewrite a file."""

from __future__ import annotations

import hashlib
from functools import lru_cache
from typing import Any

from .io import load_json
from .paths import LOCI_MANIFEST_PATH, REFERENCE_ASSET_ID, SLICES_DIR

REFERENCE_ASSET_ID = REFERENCE_ASSET_ID  # contract §8a


@lru_cache(maxsize=1)
def _manifest() -> dict[str, Any]:
    return load_json(LOCI_MANIFEST_PATH) or {"loci": []}


@lru_cache(maxsize=32)
def _sequence(locus_id: str) -> str:
    rec = get_locus(locus_id)
    if rec is None:
        raise ValueError(f"unknown locus {locus_id}")
    path = SLICES_DIR / rec["fasta_file"]
    parts: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith(">"):
            continue
        parts.append(line.strip().upper())
    text = "".join(parts)
    if not text or any(base not in "ACGTN" for base in text):
        raise ValueError(f"unexpected bases in {path}")
    return text


def reset() -> None:
    _manifest.cache_clear()
    _sequence.cache_clear()


def list_loci() -> list[dict]:
    return [dict(loc) for loc in _manifest().get("loci") or []]


def get_locus(locus_id: str) -> dict | None:
    for loc in list_loci():
        if loc.get("locus_id") == locus_id:
            return loc
    return None


def locus_for_position(contig: str, position: int) -> dict | None:
    contig = str(contig).removeprefix("chr")
    for loc in list_loci():
        if str(loc.get("contig")) == contig and loc["start"] <= position <= loc["end"]:
            return loc
    return None


def _offset(locus: dict, position: int) -> int:
    if position < locus["start"] or position > locus["end"]:
        raise ValueError(f"position {position} is outside {locus['start']}..{locus['end']}")
    return position - locus["start"]


def base_at(locus_id: str, position: int) -> str:
    """Genomic 1-based; ValueError outside the slice."""
    loc = get_locus(locus_id)
    if loc is None:
        raise ValueError(f"unknown locus {locus_id}")
    seq = _sequence(locus_id)
    return seq[_offset(loc, position)]


def window(locus_id: str, start: int, end: int) -> str:
    """1-based inclusive window. ValueError if > 400 bp or outside the slice."""
    if end < start:
        raise ValueError("end is before start")
    if end - start + 1 > 400:
        raise ValueError("window is capped at 400 bases")
    loc = get_locus(locus_id)
    if loc is None:
        raise ValueError(f"unknown locus {locus_id}")
    if start < loc["start"] or end > loc["end"]:
        raise ValueError(f"window outside {loc['start']}..{loc['end']}")
    seq = _sequence(locus_id)
    a = _offset(loc, start)
    b = _offset(loc, end)
    return seq[a : b + 1]


def verify_checksums() -> list[dict]:
    rows = []
    for loc in list_loci():
        expected = loc.get("sequence_sha256")
        try:
            actual = hashlib.sha256(_sequence(loc["locus_id"]).encode("ascii")).hexdigest()
            ok = actual == expected
        except Exception:
            actual = None
            ok = False
        rows.append({"locus_id": loc["locus_id"], "ok": ok, "expected": expected, "actual": actual})
    return rows


def overlapping_features(locus: dict, start: int, end: int) -> list[dict]:
    out = []
    for feat in locus.get("features") or []:
        fs, fe = feat.get("start"), feat.get("end")
        if fs is None or fe is None:
            continue
        if fe < start or fs > end:
            continue
        out.append(dict(feat))
    return out
