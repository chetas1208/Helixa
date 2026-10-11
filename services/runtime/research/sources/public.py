"""Public structured sources. Payloads are parsed, not invented."""

from __future__ import annotations

from typing import Any

import httpx

from services.runtime.anatomy.registry import get_node
from services.runtime.research.sources.client import SourceError, get_json

ENSEMBL = "https://rest.ensembl.org"
EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
GWAS = "https://www.ebi.ac.uk/gwas/rest/api/v2/associations"
OT = "https://api.platform.opentargets.org/api/v4/graphql"
HPA = "https://www.proteinatlas.org"


def ensembl_symbol(symbol: str, *, transport: httpx.BaseTransport | None = None) -> dict[str, Any]:
    _status, body = get_json(
        f"{ENSEMBL}/lookup/symbol/homo_sapiens/{symbol}",
        source_id="ensembl",
        params={"content-type": "application/json"},
        transport=transport,
    )
    if not isinstance(body, dict) or not str(body.get("id", "")).startswith("ENSG"):
        raise SourceError("ensembl", "SOURCE_UNAVAILABLE", "unexpected lookup")
    return {
        "source_id": "ensembl",
        "external_id": body["id"],
        "symbol": body.get("display_name") or symbol,
        "assembly": body.get("assembly_name"),
        "contig": body.get("seq_region_name"),
        "start": body.get("start"),
        "end": body.get("end"),
        "biotype": body.get("biotype"),
        "species": body.get("species"),
        "source_url": f"https://rest.ensembl.org/lookup/id/{body['id']}",
        "license": "Ensembl terms; annotation, not a phenotype model",
    }


def europepmc_search(query: str, *, transport: httpx.BaseTransport | None = None, page_size: int = 3) -> list[dict[str, Any]]:
    _status, body = get_json(
        EPMC,
        source_id="europepmc",
        params={"query": query, "format": "json", "pageSize": page_size, "resultType": "lite"},
        transport=transport,
    )
    hits = ((body or {}).get("resultList") or {}).get("result") or []
    rows = []
    for hit in hits:
        if not isinstance(hit, dict) or not hit.get("pmid"):
            continue
        rows.append(
            {
                "source_id": "europepmc",
                "pmid": str(hit["pmid"]),
                "doi": hit.get("doi"),
                "title": hit.get("title"),
                "year": hit.get("pubYear"),
                "source_label": hit.get("source"),
                "open_access": hit.get("isOpenAccess"),
                "source_url": f"https://europepmc.org/article/MED/{hit['pmid']}",
                "license": "Europe PMC metadata; title only, full text not stored",
            }
        )
    return rows


def gwas_mapped_gene(symbol: str, *, transport: httpx.BaseTransport | None = None) -> list[dict[str, Any]]:
    _status, body = get_json(
        GWAS,
        source_id="gwas_v2",
        params={"mapped_gene": symbol, "size": 2},
        transport=transport,
    )
    rows = ((body or {}).get("_embedded") or {}).get("associations") or []
    out = []
    for row in rows:
        if not isinstance(row, dict) or "association_id" not in row:
            continue
        mantissa = row.get("pvalue_mantissa")
        exponent = row.get("pvalue_exponent")
        out.append(
            {
                "source_id": "gwas_v2",
                "association_id": row["association_id"],
                "mapped_gene_query": symbol,
                "pvalue": None if mantissa is None or exponent is None else f"{mantissa}e{exponent}",
                "risk_frequency": row.get("risk_frequency"),
                "source_url": f"https://www.ebi.ac.uk/gwas/rest/api/v2/associations/{row['association_id']}",
                "license": "GWAS Catalog; association is not a causal edit",
            }
        )
    return out


def opentargets_search(query: str, *, transport: httpx.BaseTransport | None = None) -> list[dict[str, Any]]:
    graphql = (
        "query($q:String!){ search(queryString:$q, entityNames:[\"target\"], page:{index:0,size:3})"
        "{ hits { id name } } }"
    )
    _status, body = get_json(
        OT,
        source_id="opentargets",
        json_body={"query": graphql, "variables": {"q": query}},
        transport=transport,
    )
    hits = (((body or {}).get("data") or {}).get("search") or {}).get("hits") or []
    out = []
    for hit in hits:
        if isinstance(hit, dict) and str(hit.get("id", "")).startswith("ENSG"):
            out.append(
                {
                    "source_id": "opentargets",
                    "ensembl_id": hit["id"],
                    "name": hit.get("name"),
                    "source_url": "https://platform.opentargets.org/",
                    "license": "Open Targets aggregated search hit; not a body-phenotype probability",
                }
            )
    return out


def hpa_gene(ensembl_id: str, *, transport: httpx.BaseTransport | None = None) -> dict[str, Any]:
    _status, body = get_json(
        f"{HPA}/{ensembl_id}.json",
        source_id="hpa",
        transport=transport,
    )
    if not isinstance(body, dict):
        raise SourceError("hpa", "SOURCE_UNAVAILABLE", "unexpected body")
    return {
        "source_id": "hpa",
        "ensembl_id": body.get("Ensembl") or ensembl_id,
        "gene": body.get("Gene"),
        "rna_tissue_specificity": body.get("RNA tissue specificity"),
        "rna_tissue_distribution": body.get("RNA tissue distribution"),
        "source_url": f"https://www.proteinatlas.org/{ensembl_id}",
        "license": "Human Protein Atlas data access; expression is not an organ-shape claim. CC BY attribution required.",
    }


def uberon_mentions(text: str) -> list[dict[str, Any]]:
    """Local pinned Uberon nodes already in the anatomy registry. No network."""
    lowered = text.lower()
    found = []
    if "skin" in lowered or "pigment" in lowered:
        node = get_node("UBERON:0002097")
        if node:
            found.append(
                {
                    "source_id": "uberon_local",
                    "ontology_id": node["id"],
                    "label": node.get("label"),
                    "source_url": "http://purl.obolibrary.org/obo/UBERON_0002097",
                    "license": "Uberon ontology term from the local pinned registry",
                }
            )
    return found


def clingen_status() -> dict[str, str]:
    return {
        "source_id": "clingen",
        "status": "not_configured",
        "detail": "No ClinGen download is configured. Expert classifications are not invented.",
    }
