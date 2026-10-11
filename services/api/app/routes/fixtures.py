from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from fastapi import APIRouter

logger = logging.getLogger("diamond.api.fixtures")

router = APIRouter(prefix="/api", tags=["fixtures"])

FIXTURES_ROOT = Path(__file__).resolve().parents[4] / "fixtures"
SEALED_HOLDOUT_MANIFEST = Path("v7") / "manifests" / "sealed_holdout_manifest.json"
V7_CASES_DIR = ("v7", "cases")
MAX_MANIFEST_BYTES = 1_048_576
VCF_SUFFIXES = (".vcf", ".vcf.gz")
GLOB_CHARS = frozenset("*?[]")

# Mirrors the lookup order of resolve_fixture_path so a duplicated basename maps to the file it resolves to.
TOP_DIR_PRIORITY = {"valid": 0, "invalid": 1, "heldout": 2}
INCIDENT_FIXTURES = frozenset({"ref_mismatch.vcf"})

KNOWN_DESCRIPTIONS = {
    "ref_mismatch.vcf": "Incident target: REF allele disagrees with the reference",
    "valid_snvs.vcf": "Negative control with valid SNVs",
    "valid_indels.vcf": "Valid insertions and deletions",
    "multiallelic_snvs.vcf": "Multi-allelic SNV sites",
    "normalization_indel.vcf": "Indel needing normalization",
    "benign_header_variant.vcf": "Benign header variation",
    "absent_assembly.vcf": "Assembly missing from header",
    "ambiguous_assembly.vcf": "Ambiguous genome build",
    "length_mismatch.vcf": "Contig length mismatch",
    "invalid_pos_bounds.vcf": "POS outside contig bounds",
    "unsupported_contig.vcf": "Contig not in reference",
    "symbolic_structural.vcf": "Symbolic structural alleles",
    "malformed_record.vcf": "Malformed data record",
    "truncated.vcf.gz": "Truncated gzip file",
}
HELDOUT_DESCRIPTION = "Held-out transfer fixture"


def _sealed_holdout_names(root: Path) -> set[str] | None:
    """Basenames of sealed held-out v7 cases, or None when the manifest cannot be trusted."""
    manifest = root / SEALED_HOLDOUT_MANIFEST
    try:
        if manifest.is_symlink() or manifest.stat().st_size > MAX_MANIFEST_BYTES:
            return None
        data = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        logger.warning("Sealed holdout manifest unreadable; v7 cases are not listed")
        return None
    if not isinstance(data, list):
        return None
    names: set[str] = set()
    for item in data:
        if not isinstance(item, dict) or not isinstance(item.get("filename"), str):
            return None
        names.add(item["filename"])
    return names


def _describe(name: str, category: str) -> str:
    if category == "heldout":
        return HELDOUT_DESCRIPTION
    known = KNOWN_DESCRIPTIONS.get(name)
    if known:
        return known
    stem = name
    for suffix in VCF_SUFFIXES:
        if stem.endswith(suffix):
            stem = stem[: -len(suffix)]
            break
    return f"{category.capitalize()} VCF fixture: {stem.replace('_', ' ')}"


def list_fixtures(root: Path | None = None) -> list[dict[str, str]]:
    root = (root if root is not None else FIXTURES_ROOT).resolve()
    if not root.is_dir():
        return []

    sealed: set[str] | None = None
    sealed_loaded = False
    found: list[tuple[tuple[str, ...], str]] = []
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = sorted(d for d in dirnames if not (Path(dirpath) / d).is_symlink())
        base = Path(dirpath)
        for filename in sorted(filenames):
            if not filename.lower().endswith(VCF_SUFFIXES) or GLOB_CHARS.intersection(filename):
                continue
            path = base / filename
            if path.is_symlink() or not path.is_file():
                continue
            found.append((path.relative_to(root).parts, filename))

    entries: dict[str, tuple[tuple[str, ...], str]] = {}
    for parts, name in sorted(found, key=lambda f: (TOP_DIR_PRIORITY.get(f[0][0], 3), f[0])):
        entries.setdefault(name, (parts, name))

    fixtures: list[dict[str, str]] = []
    for parts, name in sorted(entries.values()):
        top = parts[0] if len(parts) > 1 else ""
        if parts[:-1] == V7_CASES_DIR:
            if not sealed_loaded:
                sealed = _sealed_holdout_names(root)
                sealed_loaded = True
            if sealed is None:
                continue
            category = "heldout" if name in sealed else "other"
        elif top == "heldout":
            category = "heldout"
        elif name in INCIDENT_FIXTURES and top == "invalid":
            category = "incident"
        elif top in ("valid", "invalid"):
            category = top
        else:
            category = "other"
        fixtures.append({"name": name, "category": category, "description": _describe(name, category)})
    return fixtures


@router.get("/fixtures")
def get_fixtures():
    return {"fixtures": list_fixtures()}
