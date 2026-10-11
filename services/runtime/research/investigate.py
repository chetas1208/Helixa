"""Investigate a prompt against public sources. Abstain when no allele is grounded."""

from __future__ import annotations

import hashlib
import re
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx

from services.runtime.research.claims import (
    ensembl_claim,
    expression_claim,
    gwas_claim,
    literature_claim,
    verify_claim_support,
)
from services.runtime.research.intent import parse_intent
from services.runtime.research.sources.client import SourceError
from services.runtime.research.sources.public import (
    clingen_status,
    ensembl_symbol,
    europepmc_search,
    gwas_mapped_gene,
    hpa_gene,
    opentargets_search,
    uberon_mentions,
)

# literature claims are built in _claims.


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _query_for(intent: dict[str, Any]) -> str:
    text = intent["prompt_excerpt_redacted"]
    if "ACGT" * 8 in text.upper():
        return ""
    drop = {
        "show", "me", "research", "about", "and", "whether", "any", "known", "relate",
        "these", "traits", "the", "a", "of", "to", "does", "what", "say", "please",
    }
    words = [word for word in re.findall(r"[A-Za-z0-9]+", text) if word.lower() not in drop]
    return " ".join(words[:12]) or text[:180]


class InvestigationStore:
    def __init__(self) -> None:
        self.items: dict[str, dict[str, Any]] = {}

    def save(self, record: dict[str, Any]) -> dict[str, Any]:
        self.items[record["investigation_id"]] = record
        return record


STORE = InvestigationStore()


def investigate(
    text: str,
    *,
    workspace_id: str | None = None,
    transport: httpx.BaseTransport | None = None,
    live: bool = True,
) -> dict[str, Any]:
    intent = parse_intent(text)
    records: list[dict[str, Any]] = []
    statuses: list[dict[str, Any]] = []
    if intent["operation"] == "refuse":
        return _finish(intent, records, statuses, workspace_id, abstain="refused")
    if not live:
        statuses.append({"source_id": "all", "status": "not_run"})
        return _finish(intent, records, statuses, workspace_id, abstain="sources_not_run")
    query = _query_for(intent)
    if not query:
        return _finish(intent, records, statuses, workspace_id, abstain="query_rejected")
    records.extend(uberon_mentions(text))
    statuses.append(clingen_status())
    _take(statuses, records, "europepmc", lambda: europepmc_search(query, transport=transport))
    if len(intent["genes"]) == 1 and not intent["ambiguous"]:
        symbol = intent["genes"][0]
        gene_row = _take(statuses, records, "ensembl", lambda: ensembl_symbol(symbol, transport=transport))
        _take(statuses, records, "gwas_v2", lambda: gwas_mapped_gene(symbol, transport=transport))
        if isinstance(gene_row, dict) and str(gene_row.get("external_id", "")).startswith("ENSG"):
            _take(statuses, records, "hpa", lambda: hpa_gene(gene_row["external_id"], transport=transport))
    else:
        _take(statuses, records, "opentargets", lambda: opentargets_search(query, transport=transport))
        statuses.append(
            {
                "source_id": "ensembl",
                "status": "skipped",
                "detail": "No single user-typed gene symbol to resolve.",
            }
        )
    return _finish(intent, records, statuses, workspace_id, abstain=None)


def _take(statuses: list, records: list, source_id: str, fn) -> Any:
    try:
        payload = fn()
    except SourceError as exc:
        statuses.append({"source_id": source_id, "status": exc.status, "detail": str(exc)})
        return None
    except Exception as exc:
        statuses.append({"source_id": source_id, "status": "SOURCE_UNAVAILABLE", "detail": type(exc).__name__})
        return None
    if isinstance(payload, list):
        records.extend(payload)
        statuses.append({"source_id": source_id, "status": "ok", "count": len(payload)})
        return payload
    records.append(payload)
    statuses.append({"source_id": source_id, "status": "ok", "count": 1})
    return payload


def _claims(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    claims = []
    for row in records:
        if row.get("source_id") == "europepmc" and row.get("pmid"):
            claims.append(literature_claim(row))
        elif row.get("source_id") == "ensembl":
            claims.append(ensembl_claim(row))
        elif row.get("source_id") == "gwas_v2":
            claims.append(gwas_claim(row))
        elif row.get("source_id") == "hpa":
            claims.append(expression_claim(row))
        elif row.get("source_id") == "opentargets":
            claims.append(
                {
                    "type": "HYPOTHESIS",
                    "predicate": "SEARCH_HIT",
                    "text": (
                        f"Open Targets search hit {row.get('ensembl_id')} ({row.get('name')}). "
                        "A search hit is not a selected edit target."
                    ),
                    "limitations": ["Not disambiguated by the user."],
                    "source_ids": [f"opentargets:{row.get('ensembl_id')}"],
                }
            )
        elif row.get("source_id") == "uberon_local":
            claims.append(
                {
                    "type": "ANNOTATED",
                    "predicate": "BODY_REGION_HAS_ANATOMY_TERM",
                    "text": f"Local Uberon term {row.get('ontology_id')} ({row.get('label')}) matched the wording.",
                    "limitations": ["An anatomy term is not a controlling gene."],
                    "source_ids": [f"uberon:{row.get('ontology_id')}"],
                }
            )
    checked = []
    for claim in claims:
        verdict = verify_claim_support(claim, records)
        claim["verification"] = verdict
        if verdict["ok"]:
            checked.append(claim)
    return checked


def _finish(intent, records, statuses, workspace_id, abstain: str | None) -> dict[str, Any]:
    claims = _claims(records) if abstain not in {"refused", "query_rejected"} else []
    proposal = None
    if intent.get("allele"):
        proposal = {
            "status": "blocked_until_reference_check",
            "allele": intent["allele"],
            "reason": "An explicit allele still needs the deterministic reference check. It is not applied here.",
        }
    elif intent.get("operation") != "refuse":
        proposal = {
            "status": "abstain",
            "reason": (
                "No user-specified REF/ALT on a named assembly coordinate. "
                "Retrieved associations and papers are not an in-silico edit."
            ),
        }
    blob = repr(sorted((row.get("source_id"), row.get("pmid") or row.get("external_id") or row.get("association_id")) for row in records))
    digest = hashlib.sha256(blob.encode()).hexdigest()
    record = {
        "investigation_id": "inv-" + uuid.uuid4().hex[:12],
        "workspace_id": workspace_id,
        "created_at": _now(),
        "intent": intent,
        "source_status": statuses,
        "records": records,
        "claims": claims,
        "proposal": proposal,
        "abstain": abstain,
        "bundle_hash": digest,
        "disclaimer": (
            "Research use only. Sequence validation is separate. "
            "Expression and GWAS associations do not predict organ shape."
        ),
    }
    return STORE.save(record)
