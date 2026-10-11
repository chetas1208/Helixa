from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError

from services.api.app.dependencies import get_evidence_repo
from services.integrations.mongodb import EvidenceRepository

router = APIRouter(prefix="/api/evidence", tags=["evidence"])

@router.get("/{id}")
async def get_evidence_receipt(
    id: str,
    evidence_repo: EvidenceRepository = Depends(get_evidence_repo),
):
    lookups = (
        ("receipt_id", evidence_repo.get_receipt),
        ("receipt_digest", evidence_repo.get_receipt_by_digest),
        ("run_id", evidence_repo.get_receipt_by_run),
    )
    for field, getter in lookups:
        try:
            receipt = await getter(id)
        except ValidationError:
            # Scientific validation receipts share this collection with a different shape.
            doc = await evidence_repo.db.evidence_receipts.find_one({field: id}, {"_id": 0})
            if doc:
                return doc
            continue
        if receipt:
            return receipt.model_dump(mode="json")
    raise HTTPException(status_code=404, detail=f"Evidence receipt '{id}' not found")
