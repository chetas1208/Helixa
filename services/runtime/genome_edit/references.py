"""Resolve a pinned reference for V14 edits. Prefer Agent 2 loci; never invent GRCh38 bases."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from services.runtime.genome_workspace.reference import (
    ASSEMBLY as SYNTHETIC_ASSEMBLY,
)
from services.runtime.genome_workspace.reference import (
    ASSET_ID as SYNTHETIC_ASSET_ID,
)
from services.runtime.genome_workspace.reference import (
    CONTIG as SYNTHETIC_CONTIG,
)
from services.runtime.genome_workspace.reference import base_at as synthetic_base_at

GRCH38_ASSET_ID = "grch38_slices_ensembl116"
GRCH38_ASSEMBLY = "GRCh38"


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def anatomy_loci():
    """Agent 2 module when present; None otherwise. Never fabricate slices."""
    try:
        from services.runtime.anatomy import loci as module
    except ImportError:
        return None
    return module


def anatomy_registry():
    try:
        from services.runtime.anatomy import registry as module
    except ImportError:
        return None
    return module


def anatomy_genes():
    try:
        from services.runtime.anatomy import genes as module
    except ImportError:
        return None
    return module


def grch38_available() -> bool:
    return anatomy_loci() is not None


def grch38_source_status() -> dict[str, Any]:
    loci = anatomy_loci()
    if loci is None:
        return {
            "source_id": "ensembl_grch38_slices",
            "status": "unavailable",
            "version": None,
            "retrieved_at": None,
        }
    version = getattr(loci, "REFERENCE_ASSET_ID", GRCH38_ASSET_ID)
    return {
        "source_id": "ensembl_grch38_slices",
        "status": "cached",
        "version": version,
        "retrieved_at": _now(),
    }


def is_grch38_reference(reference_asset_id: str | None, locus_id: str | None = None) -> bool:
    if reference_asset_id == GRCH38_ASSET_ID:
        return True
    if reference_asset_id == SYNTHETIC_ASSET_ID:
        return False
    if locus_id and str(locus_id).startswith("grch38:"):
        return True
    return False


def resolve_reference(
    reference_asset_id: str | None = None,
    locus_id: str | None = None,
    contig: str | None = None,
) -> dict[str, Any]:
    """Pick the pinned asset. Missing Agent 2 never becomes a fake GRCh38 hit."""
    if is_grch38_reference(reference_asset_id, locus_id):
        loci = anatomy_loci()
        record = None
        if loci is not None and locus_id:
            record = loci.get_locus(locus_id)
        if record is None and loci is not None and contig:
            # Agent 2 may expose locus_for_position; contig alone is not a slice.
            record = None
        return {
            "reference_asset_id": GRCH38_ASSET_ID,
            "assembly": (record or {}).get("assembly") or GRCH38_ASSEMBLY,
            "contig": (record or {}).get("contig") or contig or "",
            "locus_id": (record or {}).get("locus_id") or locus_id,
            "gene_id": (record or {}).get("gene_id"),
            "gene_symbol": (record or {}).get("gene_symbol"),
            "available": loci is not None and (record is not None or not locus_id),
            "official_grch38": True,
            "source_status": grch38_source_status(),
            "locus": record,
        }
    return {
        "reference_asset_id": SYNTHETIC_ASSET_ID,
        "assembly": SYNTHETIC_ASSEMBLY,
        "contig": contig or SYNTHETIC_CONTIG,
        "locus_id": locus_id if locus_id == SYNTHETIC_ASSET_ID else None,
        "gene_id": None,
        "gene_symbol": None,
        "available": True,
        "official_grch38": False,
        "source_status": {
            "source_id": SYNTHETIC_ASSET_ID,
            "status": "cached",
            "version": SYNTHETIC_ASSET_ID,
            "retrieved_at": _now(),
        },
        "locus": None,
    }


def base_at_reference(
    reference_asset_id: str | None,
    position: int,
    locus_id: str | None = None,
) -> str:
    """Return the pinned base. ValueError if out of range; LookupError if GRCh38 is unavailable."""
    if not is_grch38_reference(reference_asset_id, locus_id):
        return synthetic_base_at(position)
    loci = anatomy_loci()
    if loci is None:
        raise LookupError("GRCh38 slices are unavailable")
    if not locus_id:
        raise LookupError("GRCh38 validation requires a locus_id")
    return loci.base_at(locus_id, position)


def try_base_at(
    reference_asset_id: str | None,
    position: int,
    locus_id: str | None = None,
) -> tuple[str | None, str | None]:
    """(base, error). error is a reason string when the base cannot be read."""
    try:
        return base_at_reference(reference_asset_id, position, locus_id), None
    except LookupError as exc:
        return None, str(exc)
    except ValueError as exc:
        return None, str(exc)


def resolve_anatomy_mentions(text: str) -> list[str]:
    registry = anatomy_registry()
    if registry is None or not text.strip():
        return []
    try:
        return list(registry.resolve_text(text) or [])
    except Exception:
        return []


def lookup_gene(token: str) -> dict[str, Any] | None:
    genes = anatomy_genes()
    if genes is None or not token:
        return None
    try:
        return genes.get_gene(token)
    except Exception:
        return None


def lookup_locus(locus_id: str) -> dict[str, Any] | None:
    loci = anatomy_loci()
    if loci is None or not locus_id:
        return None
    try:
        return loci.get_locus(locus_id)
    except Exception:
        return None
