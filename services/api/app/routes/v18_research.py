"""Research investigations. GET never writes a genome revision."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.runtime.genome_edit.references import try_base_at
from services.runtime.research.investigate import STORE, investigate
from services.runtime.research.sources.public import clingen_status

router = APIRouter(prefix="/api/research", tags=["research"])


class IntentBody(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    workspace_id: str | None = None


class ConfirmBody(BaseModel):
    reference_asset_id: str | None = None
    contig: str | None = None
    position: int = Field(ge=1)
    ref: str = Field(min_length=1, max_length=1)
    alt: str = Field(min_length=1, max_length=1)
    workspace_id: str | None = None


@router.get("/providers/status")
def provider_status() -> dict[str, Any]:
    return {
        "product_display_name": "HELIXA",
        "sources": [
            {"source_id": "ensembl", "status": "public", "live_claimed": False},
            {"source_id": "europepmc", "status": "public", "live_claimed": False},
            {"source_id": "gwas_v2", "status": "public", "live_claimed": False},
            {"source_id": "opentargets", "status": "public", "live_claimed": False},
            {"source_id": "hpa", "status": "public", "live_claimed": False},
            {"source_id": "uberon_local", "status": "local_registry"},
            clingen_status(),
        ],
        "note": "A source is connected only after a successful call on that investigation, not because this list exists.",
    }


@router.post("/intent")
def post_intent(body: IntentBody) -> dict[str, Any]:
    from services.runtime.research.intent import parse_intent

    return parse_intent(body.text)


@router.post("/investigations")
def post_investigation(body: IntentBody) -> dict[str, Any]:
    return investigate(body.text, workspace_id=body.workspace_id, live=True)


@router.get("/investigations/{investigation_id}")
def get_investigation(investigation_id: str) -> dict[str, Any]:
    row = STORE.items.get(investigation_id)
    if row is None:
        raise HTTPException(status_code=404, detail="investigation not found")
    return row


@router.post("/edit-proposals/{proposal_id}/confirm")
def confirm_edit(proposal_id: str, body: ConfirmBody) -> dict[str, Any]:
    """Check REF against the local reference. This call does not write a revision."""
    if body.ref.upper() not in "ACGT" or body.alt.upper() not in "ACGT":
        raise HTTPException(status_code=400, detail="REF and ALT must be ACGT")
    base, error = try_base_at(body.reference_asset_id, body.position, None)
    if error or base is None:
        raise HTTPException(status_code=409, detail=error or "reference base unavailable")
    if base != body.ref.upper():
        raise HTTPException(
            status_code=409,
            detail=f"REF mismatch at {body.position}: reference has {base}",
        )
    return {
        "proposal_id": proposal_id,
        "status": "reference_matched_not_committed",
        "position": body.position,
        "ref": base,
        "alt": body.alt.upper(),
        "workspace_id": body.workspace_id,
        "wrote_revision": False,
        "reason": "Deterministic reference matched. Commit stays on the existing genome-edit proposal path.",
    }
