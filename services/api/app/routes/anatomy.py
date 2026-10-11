"""V14 anatomy, gene evidence, and pinned GRCh38 locus routes (Agent 2)."""

from __future__ import annotations

import hashlib
from typing import Any
from urllib.parse import unquote

from fastapi import APIRouter, HTTPException, Query

from services.runtime.anatomy import evidence as ev
from services.runtime.anatomy import genes as gene_api
from services.runtime.anatomy import loci as loci_api
from services.runtime.anatomy import registry

router = APIRouter(tags=["v14-anatomy"])

PANEL_NOTE = (
    "Ranked by source-reported values for the curated gene panel. "
    "Not a complete transcriptome. Expression is not a phenotype claim."
)
EMPTY_REASON = (
    "No panel genes have cached tissue-expression or association records mapped to this anatomy id."
)


def _decode(value: str) -> str:
    return unquote(value)


def _require_node(anatomy_id: str) -> dict:
    node = registry.get_node(anatomy_id)
    if node is None:
        raise HTTPException(status_code=404, detail=f"Unknown anatomy id '{anatomy_id}'")
    return node


def _require_gene(token: str) -> dict:
    gene = gene_api.get_gene(token)
    if gene is None:
        raise HTTPException(status_code=404, detail=f"Unknown gene '{token}'")
    return gene


def _check_assembly(assembly: str | None) -> None:
    if assembly is None:
        return
    norm = assembly.strip()
    if norm.upper() in {"GRCH38", "GRCH38.P14", "HG38"}:
        return
    raise HTTPException(status_code=400, detail="assembly must be GRCh38")


def _cursor_page(items: list[dict], cursor: str | None, limit: int) -> tuple[list[dict], str | None]:
    start = 0
    if cursor:
        try:
            start = max(0, int(cursor))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="cursor must be an integer offset") from exc
    limit = max(1, min(limit, 100))
    page = items[start : start + limit]
    nxt = str(start + limit) if start + limit < len(items) else None
    return page, nxt


@router.get("/api/anatomy/tree")
def anatomy_tree(
    system: str | None = None,
    depth: int | None = Query(default=None, ge=0, le=8),
) -> dict[str, Any]:
    nodes = registry.tree_nodes(system=system, depth=depth)
    systems = registry.list_systems()
    if system:
        systems = [s for s in systems if s["id"] == system]
    return {
        "nodes": nodes,
        "systems": systems,
        "root_id": registry.root_id(),
        "source_status": ev.source_status_for("uberon"),
    }


@router.get("/api/anatomy/search")
def anatomy_search(
    q: str = "",
    limit: int = Query(default=20, ge=1, le=50),
) -> dict[str, Any]:
    results = registry.search(q, limit=limit)
    return {"query": q, "results": results}


@router.get("/api/anatomy/{anatomy_id:path}/genes")
def anatomy_genes(
    anatomy_id: str,
    evidence_kind: str | None = None,
    cursor: str | None = None,
    limit: int = Query(default=20, ge=1, le=100),
) -> dict[str, Any]:
    anatomy_id = _decode(anatomy_id)
    _require_node(anatomy_id)
    items = ev.group_by_gene(ev.items_for_anatomy(anatomy_id, evidence_kind=evidence_kind))
    page, next_cursor = _cursor_page(items, cursor, limit)
    gene_ids = list(dict.fromkeys(item["gene_id"] for item in page))
    genes = [g for gid in gene_ids if (g := gene_api.get_gene(gid))]
    payload: dict[str, Any] = {
        "anatomy_id": anatomy_id,
        "items": page,
        "genes": genes,
        "next_cursor": next_cursor,
        "panel_note": PANEL_NOTE,
        "source_status": ev.source_status_for("bgee", "hpa", "gwas"),
    }
    if not items:
        payload["empty_reason"] = EMPTY_REASON
    return payload


@router.get("/api/anatomy/{anatomy_id:path}")
def anatomy_detail(anatomy_id: str) -> dict[str, Any]:
    anatomy_id = _decode(anatomy_id)
    node = _require_node(anatomy_id)
    tissues = [t for tid in node.get("tissue_context_ids") or [] if (t := registry.get_node(tid))]
    return {
        "node": node,
        "breadcrumb": registry.breadcrumb(anatomy_id),
        "children": registry.children_of(anatomy_id),
        "relationships": registry.relationships_for(anatomy_id),
        "tissue_contexts": tissues,
        "source_status": ev.source_status_for("uberon"),
    }


@router.get("/api/genes/{ensembl_id}/tissues")
def gene_tissues(ensembl_id: str) -> dict[str, Any]:
    gene = _require_gene(_decode(ensembl_id))
    return {
        "gene": gene,
        "items": ev.items_for_gene(gene),
        "source_status": ev.source_status_for("bgee", "hpa"),
    }


@router.get("/api/genes/{ensembl_id}/annotations")
def gene_annotations(ensembl_id: str, assembly: str = "GRCh38") -> dict[str, Any]:
    _check_assembly(assembly)
    gene = _require_gene(_decode(ensembl_id))
    loci = [loc for loc_id in gene.get("locus_ids") or [] if (loc := loci_api.get_locus(loc_id))]
    return {
        "gene": gene,
        "transcripts": gene_api.transcripts_for(gene["gene_id"]),
        "loci": loci,
        "source_status": ev.source_status_for("ensembl"),
    }


@router.get("/api/genes/{ensembl_id}/variants")
def gene_variants(ensembl_id: str, assembly: str = "GRCh38") -> dict[str, Any]:
    _check_assembly(assembly)
    gene = _require_gene(_decode(ensembl_id))
    associations = ev.gwas_associations(gene)
    status = ev.source_status_for("gwas")
    if status[0]["status"] == "unavailable":
        associations = []
    return {
        "gene": gene,
        "associations": associations,
        "source": "GWAS Catalog REST API v2",
        "source_status": status,
    }


@router.get("/api/genes/{ensembl_id}")
def gene_detail(ensembl_id: str) -> dict[str, Any]:
    return _require_gene(_decode(ensembl_id))


@router.get("/api/genome-edit/loci")
def list_edit_loci() -> dict[str, Any]:
    return {"loci": loci_api.list_loci()}


@router.get("/api/genome-edit/loci/{locus_id:path}/window")
def locus_window(
    locus_id: str,
    start: int = Query(..., ge=1),
    end: int = Query(..., ge=1),
) -> dict[str, Any]:
    locus_id = _decode(locus_id)
    loc = loci_api.get_locus(locus_id)
    if loc is None:
        raise HTTPException(status_code=404, detail=f"Unknown locus '{locus_id}'")
    try:
        bases = loci_api.window(locus_id, start, end)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "locus_id": locus_id,
        "assembly": "GRCh38",
        "contig": loc["contig"],
        "start": start,
        "end": end,
        "bases": bases,
        "coordinate": "1-based inclusive",
        "strand": "+",
        "sequence_sha256": hashlib.sha256(bases.encode("ascii")).hexdigest(),
        "features": loci_api.overlapping_features(loc, start, end),
    }
