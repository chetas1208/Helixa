"""Curated gene panel (Ensembl release 116 / GRCh38.p14)."""

from __future__ import annotations

from functools import lru_cache

from .io import load_json
from .paths import GENES_PATH


@lru_cache(maxsize=1)
def _genes() -> list[dict]:
    data = load_json(GENES_PATH) or {}
    return list(data.get("genes") or [])


def reset() -> None:
    _genes.cache_clear()


def list_genes() -> list[dict]:
    return [dict(g) for g in _genes()]


def get_gene(gene_id_or_symbol: str) -> dict | None:
    token = (gene_id_or_symbol or "").strip()
    if not token:
        return None
    # Unversioned Ensembl gene id, or symbol (case-insensitive).
    bare = token.split(".", 1)[0]
    for gene in _genes():
        if gene.get("gene_id") == bare or (gene.get("symbol") or "").upper() == token.upper():
            return dict(gene)
    return None


def transcripts_for(gene_id_or_symbol: str) -> list[dict]:
    """Canonical + cached expanded transcripts from the Ensembl lookup cache."""
    from .io import load_json
    from .paths import ENSEMBL_CACHE

    gene = get_gene(gene_id_or_symbol)
    if gene is None:
        return []
    rec = load_json(ENSEMBL_CACHE / f"{gene['symbol']}.json") or {}
    payload = rec.get("payload") or {}
    canon = payload.get("canonical_transcript") or gene.get("canonical_transcript")
    rows = []
    for tr in payload.get("Transcript") or []:
        tid = tr.get("id")
        ver = tr.get("version")
        transcript_id = f"{tid}.{ver}" if tid and ver is not None and "." not in str(tid) else tid
        rows.append(
            {
                "transcript_id": transcript_id,
                "is_canonical": transcript_id == canon or tid == (canon or "").split(".")[0],
                "biotype": tr.get("biotype"),
                "start": tr.get("start"),
                "end": tr.get("end"),
            }
        )
    if not rows and canon:
        rows.append(
            {
                "transcript_id": canon,
                "is_canonical": True,
                "biotype": gene.get("biotype"),
                "start": gene.get("start"),
                "end": gene.get("end"),
            }
        )
    return rows
