"""Map cached Bgee / HPA / GWAS v2 payloads onto contract evidence rows.

Expression is never turned into a phenotype or GWAS claim.
"""

from __future__ import annotations

import hashlib
from typing import Any

from .genes import get_gene, list_genes
from .io import load_json
from .paths import (
    BGEE_ANATOMY_MAP_PATH,
    BGEE_CACHE,
    EXPRESSION_CAVEAT,
    GWAS_CACHE,
    GWAS_CAVEAT,
    HPA_CACHE,
    HPA_TISSUE_MAP_PATH,
    SOURCE_META_PATH,
)
from .registry import ancestors, descendants, get_node, list_nodes
from .seed import BGEE_ANATOMY_MAP, HPA_TISSUE_MAP


def _meta() -> dict:
    return load_json(SOURCE_META_PATH) or {}


def _hpa_map() -> dict[str, str]:
    return load_json(HPA_TISSUE_MAP_PATH) or HPA_TISSUE_MAP


def _bgee_map() -> dict[str, list[str]]:
    return load_json(BGEE_ANATOMY_MAP_PATH) or BGEE_ANATOMY_MAP


def source_status_for(*source_ids: str) -> list[dict]:
    meta = _meta()
    retrieved = meta.get("retrieved_at")
    versions = {
        "bgee": ((meta.get("sources") or {}).get("bgee") or {}).get("version") or "Bgee 15.2.5",
        "hpa": ((meta.get("sources") or {}).get("hpa") or {}).get("version") or "Human Protein Atlas",
        "gwas": "GWAS Catalog REST API v2",
        "ensembl": "release 116",
        "uberon": ((meta.get("sources") or {}).get("uberon_ols4") or {}).get("version") or "2026-10-01",
    }
    out = []
    for sid in source_ids:
        available = _source_available(sid)
        out.append(
            {
                "source_id": sid,
                "status": "cached" if available else "unavailable",
                "version": versions.get(sid),
                "retrieved_at": retrieved if available else None,
            }
        )
    return out


def _source_available(source_id: str) -> bool:
    if source_id == "bgee":
        return any(BGEE_CACHE.glob("ENSG*.json"))
    if source_id == "hpa":
        return any(HPA_CACHE.glob("ENSG*.json"))
    if source_id == "gwas":
        return any(GWAS_CACHE.glob("*.json"))
    if source_id == "ensembl":
        return True
    if source_id == "uberon":
        return True
    return False


def _eid(*parts: object) -> str:
    raw = "|".join(str(p) for p in parts)
    return "ev-" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def _node_label(anatomy_id: str, fallback: str | None = None) -> str:
    node = get_node(anatomy_id)
    if node:
        return node["label"]
    return fallback or anatomy_id


def tree_targets_for_measured(measured_id: str) -> set[str]:
    """Which curated nodes should surface a measurement at `measured_id`."""
    out: set[str] = set()
    if get_node(measured_id):
        out.add(measured_id)
        out.update(ancestors(measured_id))
    extra = _bgee_map().get(measured_id) or []
    out.update(extra)
    for node in list_nodes():
        if measured_id in (node.get("tissue_context_ids") or []):
            out.add(node["id"])
        if node.get("ontology_id") == measured_id:
            out.add(node["id"])
    # Generic lung/kidney measurements also attach to lateral organs.
    if measured_id == "UBERON:0002048":
        out.update({"UBERON:0002168", "UBERON:0002167", "UBERON:0000915"})
    if measured_id == "UBERON:0002113":
        out.update({"UBERON:0004538", "UBERON:0004539"})
    return {nid for nid in out if get_node(nid)}


def _bgee_cache(gene_id: str) -> dict | None:
    return load_json(BGEE_CACHE / f"{gene_id}.json")


def _hpa_cache(gene_id: str) -> dict | None:
    return load_json(HPA_CACHE / f"{gene_id}.json")


def _gwas_cache(symbol: str) -> dict | None:
    return load_json(GWAS_CACHE / f"{symbol}.json")


def bgee_items(gene: dict, requested_anatomy_id: str | None = None) -> list[dict]:
    rec = _bgee_cache(gene["gene_id"])
    if rec is None:
        return []
    calls = ((rec.get("payload") or {}).get("data") or {}).get("calls") or []
    items: list[dict] = []
    for call in calls:
        cond = call.get("condition") or {}
        anat = cond.get("anatEntity") or {}
        measured_id = anat.get("id")
        measured_label = anat.get("name") or measured_id
        if not measured_id:
            continue
        targets = tree_targets_for_measured(measured_id)
        if requested_anatomy_id and requested_anatomy_id not in targets:
            # Also accept if the request is a descendant of the measured site.
            if requested_anatomy_id not in descendants(measured_id) and measured_id != requested_anatomy_id:
                continue
            targets.add(requested_anatomy_id)
        anatomy_id = requested_anatomy_id or next(iter(targets), measured_id)
        score = call.get("expressionScore") or {}
        try:
            value = float(score.get("expressionScore"))
        except (TypeError, ValueError):
            value = None
        quality = call.get("expressionQuality")
        state = call.get("expressionState")
        types = call.get("dataTypesWithData") or []
        items.append(
            {
                "evidence_id": _eid("bgee", gene["gene_id"], measured_id, anatomy_id, call.get("clusterIndex")),
                "gene_id": gene["gene_id"],
                "gene_symbol": gene["symbol"],
                "anatomy_id": anatomy_id,
                "measured_anatomy_id": measured_id,
                "measured_anatomy_label": measured_label,
                "evidence_kind": "tissue-expression",
                "interpretation_tier": "observed-expression",
                "source_id": "bgee",
                "source_version": rec.get("source_version") or "Bgee 15.2.5",
                "retrieved_at": rec.get("retrieved_at"),
                "study_or_record_id": None,
                "context": f"{', '.join(types) or 'expression call'}; call quality {quality}",
                "quantitative_value": value,
                "units": "Bgee expression score (0-100, rank-based)",
                "qualitative_label": f"{state} ({quality})" if state else quality,
                "uncertainty": f"FDR {call.get('fdr')}" if call.get("fdr") else None,
                "source_url": f"https://www.bgee.org/gene/{gene['gene_id']}",
                "caveat": EXPRESSION_CAVEAT,
            }
        )
    return items


def hpa_items(gene: dict, requested_anatomy_id: str | None = None) -> list[dict]:
    rec = _hpa_cache(gene["gene_id"])
    if rec is None:
        return []
    payload = rec.get("payload") or {}
    ntpms = payload.get("RNA tissue specific nTPM") or {}
    if not isinstance(ntpms, dict):
        return []
    items = []
    mapping = _hpa_map()
    for tissue_name, ntpms_value in ntpms.items():
        measured_id = mapping.get(tissue_name.lower()) or mapping.get(tissue_name)
        if not measured_id:
            continue
        if get_node(measured_id) is None and measured_id not in _bgee_map():
            # Still usable as a measured site even when it is only a tissue context.
            pass
        targets = tree_targets_for_measured(measured_id)
        if requested_anatomy_id and requested_anatomy_id not in targets and requested_anatomy_id != measured_id:
            continue
        anatomy_id = requested_anatomy_id or next(iter(targets), measured_id)
        try:
            value = float(ntpms_value)
        except (TypeError, ValueError):
            value = None
        items.append(
            {
                "evidence_id": _eid("hpa", gene["gene_id"], measured_id, tissue_name),
                "gene_id": gene["gene_id"],
                "gene_symbol": gene["symbol"],
                "anatomy_id": anatomy_id,
                "measured_anatomy_id": measured_id,
                "measured_anatomy_label": tissue_name,
                "evidence_kind": "tissue-expression",
                "interpretation_tier": "observed-expression",
                "source_id": "hpa",
                "source_version": rec.get("source_version") or "Human Protein Atlas",
                "retrieved_at": rec.get("retrieved_at"),
                "study_or_record_id": None,
                "context": f"HPA RNA tissue specific nTPM; specificity {payload.get('RNA tissue specificity')}",
                "quantitative_value": value,
                "units": "nTPM (HPA RNA tissue specific)",
                "qualitative_label": payload.get("RNA tissue specificity"),
                "uncertainty": None,
                "source_url": f"https://www.proteinatlas.org/{gene['gene_id']}",
                "caveat": EXPRESSION_CAVEAT,
            }
        )
    return items


def expression_items(gene: dict, requested_anatomy_id: str | None = None) -> list[dict]:
    return [*bgee_items(gene, requested_anatomy_id), *hpa_items(gene, requested_anatomy_id)]


def gwas_associations(gene: dict) -> list[dict]:
    rec = _gwas_cache(gene["symbol"])
    if rec is None:
        return []
    rows = ((rec.get("payload") or {}).get("_embedded") or {}).get("associations") or []
    out = []
    for row in rows:
        efo = row.get("efo_traits") or []
        reported = row.get("reported_trait") or []
        if isinstance(reported, str):
            reported = [reported]
        beta = row.get("beta")
        ci = None
        if row.get("ci_lower") is not None or row.get("ci_upper") is not None:
            ci = {"lower": row.get("ci_lower"), "upper": row.get("ci_upper"), "range": row.get("range")}
        accession = row.get("accession_id")
        assoc_id = row.get("association_id")
        out.append(
            {
                "association_id": str(assoc_id),
                "study_accession": accession,
                "pubmed_id": str(row.get("pubmed_id")) if row.get("pubmed_id") is not None else None,
                "first_author": row.get("first_author"),
                "reported_trait": reported,
                "efo_traits": [t.get("efo_trait") for t in efo if isinstance(t, dict) and t.get("efo_trait")],
                "snp_effect_allele": row.get("snp_effect_allele") or [],
                "p_value": row.get("p_value"),
                "beta": beta,
                "ci": ci,
                "locations": row.get("locations") or [],
                "source_url": f"https://www.ebi.ac.uk/gwas/studies/{accession}" if accession else "https://www.ebi.ac.uk/gwas/",
            }
        )
    return out


def gwas_evidence_items(gene: dict, requested_anatomy_id: str | None = None) -> list[dict]:
    """Statistical associations only. Never derived from expression."""
    items = []
    rec = _gwas_cache(gene["symbol"])
    retrieved = (rec or {}).get("retrieved_at")
    version = (rec or {}).get("source_version") or "GWAS Catalog REST API v2"
    for assoc in gwas_associations(gene):
        traits = assoc.get("reported_trait") or assoc.get("efo_traits") or []
        trait_label = ", ".join(str(t) for t in traits[:3]) or "GWAS trait"
        anatomy_id = requested_anatomy_id or "UBERON:0013702"
        items.append(
            {
                "evidence_id": _eid("gwas", gene["gene_id"], assoc.get("association_id")),
                "gene_id": gene["gene_id"],
                "gene_symbol": gene["symbol"],
                "anatomy_id": anatomy_id,
                "measured_anatomy_id": anatomy_id,
                "measured_anatomy_label": _node_label(anatomy_id),
                "evidence_kind": "variant-trait-association",
                "interpretation_tier": "statistical-association",
                "source_id": "gwas",
                "source_version": version,
                "retrieved_at": retrieved,
                "study_or_record_id": assoc.get("study_accession"),
                "context": (
                    f"GWAS Catalog v2 {assoc.get('study_accession')}; "
                    f"PubMed {assoc.get('pubmed_id')}; {assoc.get('first_author')}; {trait_label}"
                ),
                "quantitative_value": assoc.get("p_value"),
                "units": "p-value (GWAS Catalog)",
                "qualitative_label": trait_label,
                "uncertainty": None,
                "source_url": assoc.get("source_url"),
                "caveat": GWAS_CAVEAT,
            }
        )
    return items


def items_for_anatomy(
    anatomy_id: str,
    evidence_kind: str | None = None,
) -> list[dict]:
    rows: list[dict] = []
    for gene in list_genes():
        if evidence_kind in {None, "", "tissue-expression"}:
            rows.extend(expression_items(gene, anatomy_id))
        if evidence_kind in {None, "", "variant-trait-association"}:
            # Associations are listed on gene/variant endpoints; include only when
            # the organ is a plausible context (never as a phenotype derived from expression).
            if evidence_kind == "variant-trait-association":
                rows.extend(gwas_evidence_items(gene, anatomy_id))
    rows.sort(key=lambda r: (-(r.get("quantitative_value") or 0), r.get("gene_symbol") or "", r.get("evidence_id")))
    return rows


def items_for_gene(gene: dict) -> list[dict]:
    rows = expression_items(gene, None)
    rows.sort(key=lambda r: (-(r.get("quantitative_value") or 0), r.get("measured_anatomy_label") or ""))
    return rows


def group_by_gene(items: list[dict]) -> list[dict]:
    """Stable rank: genes by max source value, items stay together per gene."""
    order: list[str] = []
    buckets: dict[str, list[dict]] = {}
    scores: dict[str, float] = {}
    for item in items:
        gid = item["gene_id"]
        buckets.setdefault(gid, []).append(item)
        scores[gid] = max(scores.get(gid, 0.0), float(item.get("quantitative_value") or 0))
        if gid not in order:
            order.append(gid)
    order.sort(key=lambda gid: (-scores.get(gid, 0.0), gid))
    out: list[dict] = []
    for gid in order:
        out.extend(buckets[gid])
    return out


def iter_gwas_search_rows() -> list[dict[str, Any]]:
    rows = []
    for gene in list_genes():
        for assoc in gwas_associations(gene):
            for snp in assoc.get("snp_effect_allele") or []:
                rsid = str(snp).split("-", 1)[0]
                rows.append(
                    {
                        "result_type": "variant",
                        "id": rsid,
                        "label": str(snp),
                        "matched": rsid,
                        "fields": [rsid, str(snp), *(assoc.get("locations") or [])],
                    }
                )
            for trait in [*(assoc.get("reported_trait") or []), *(assoc.get("efo_traits") or [])]:
                if not trait:
                    continue
                rows.append(
                    {
                        "result_type": "trait",
                        "id": assoc.get("study_accession") or str(assoc.get("association_id")),
                        "label": str(trait),
                        "matched": str(trait),
                        "fields": [str(trait)],
                    }
                )
    return rows


def get_gene_required(token: str) -> dict | None:
    return get_gene(token)
