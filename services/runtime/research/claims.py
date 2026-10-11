"""Claims may only name identifiers that a source record actually returned."""

from __future__ import annotations

import re
from typing import Any

_PMID = re.compile(r"\bPMID[:\s]*(\d{4,9})\b")
_ENSG = re.compile(r"\b(ENSG\d{11})\b")
_ASSOC = re.compile(r"\bassociation\s+(\d{6,})\b")


def verify_claim_support(claim: dict[str, Any], records: list[dict[str, Any]]) -> dict[str, Any]:
    text = claim.get("text") or ""
    pmids = set(_PMID.findall(text))
    genes = set(_ENSG.findall(text))
    assocs = set(_ASSOC.findall(text))
    have_pmid = {str(row.get("pmid")) for row in records if row.get("pmid")}
    have_gene = {str(row.get("external_id") or row.get("ensembl_id") or "") for row in records}
    have_gene |= {str(row.get("ensembl_id")) for row in records if row.get("ensembl_id")}
    have_assoc = {str(row.get("association_id")) for row in records if row.get("association_id")}
    missing = []
    missing += [f"PMID:{item}" for item in pmids - have_pmid]
    missing += [item for item in genes - have_gene]
    missing += [f"association {item}" for item in assocs - have_assoc]
    if claim.get("type") == "PREDICTED" and claim.get("predicate") == "BODY_FROM_EXPRESSION":
        missing.append("expression_cannot_predict_body")
    if claim.get("type") == "PREDICTED" and "GWAS" in text and "edit will" in text.lower():
        missing.append("gwas_is_not_a_causal_edit")
    return {"ok": not missing, "missing": missing}


def literature_claim(row: dict[str, Any]) -> dict[str, Any]:
    title = row.get("title") or "(no title)"
    return {
        "type": "HYPOTHESIS",
        "predicate": "ARTICLE_MATCHES_QUERY",
        "text": f"Europe PMC record PMID {row['pmid']} ({row.get('year')}): {title}",
        "limitations": ["Title metadata only. The paper was not read and is not proof of an edit."],
        "source_ids": [f"europepmc:{row['pmid']}"],
    }


def ensembl_claim(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "ANNOTATED",
        "predicate": "GENE_HAS_STABLE_ID",
        "text": (
            f"Ensembl lookup maps {row['symbol']} to {row['external_id']} on "
            f"{row.get('assembly')} chromosome {row.get('contig')}."
        ),
        "limitations": ["Coordinate annotation. Not a body morphology model."],
        "source_ids": [f"ensembl:{row['external_id']}"],
    }


def gwas_claim(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "ASSOCIATED",
        "predicate": "VARIANT_ASSOCIATED_WITH_TRAIT",
        "text": (
            f"GWAS Catalog v2 association {row['association_id']} was returned for mapped gene "
            f"{row['mapped_gene_query']} with reported p-value {row.get('pvalue')}. "
            "This association does not show that an edit of that gene produces a chosen appearance."
        ),
        "limitations": ["Association, not a demonstrated causal edit. Population context may be limited."],
        "source_ids": [f"gwas:{row['association_id']}"],
    }


def expression_claim(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "OBSERVED",
        "predicate": "GENE_EXPRESSED_IN_TISSUE",
        "text": (
            f"Human Protein Atlas lists RNA tissue specificity "
            f"'{row.get('rna_tissue_specificity')}' for {row.get('ensembl_id')}."
        ),
        "limitations": ["Expression is not evidence that changing the gene resizes or reshapes an organ."],
        "source_ids": [f"hpa:{row.get('ensembl_id')}"],
    }
