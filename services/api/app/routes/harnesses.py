from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from services.api.app.dependencies import get_harness_repo
from services.integrations.mongodb import HarnessRepository

router = APIRouter(prefix="/api/harnesses", tags=["harnesses"])

@router.get("")
async def list_harnesses(harness_repo: HarnessRepository = Depends(get_harness_repo)):
    harnesses = await harness_repo.list_versions()
    return {"harnesses": [h.model_dump(mode="json") for h in harnesses]}

@router.get("/{id}")
async def get_harness(id: str, harness_repo: HarnessRepository = Depends(get_harness_repo)):
    h = await harness_repo.get_version(id)
    if not h:
        raise HTTPException(status_code=404, detail=f"Harness version '{id}' not found")
    return h.model_dump(mode="json")

@router.get("/{id}/lineage")
async def get_harness_lineage(id: str, harness_repo: HarnessRepository = Depends(get_harness_repo)):
    """
    Returns real genealogy tree nodes and edges sourced from MongoDB.
    Topology is strictly derived from persisted records, never invented.
    """
    if not await harness_repo.get_version(id):
        raise HTTPException(status_code=404, detail=f"Harness version '{id}' not found")
    return await harness_repo.get_lineage(root_id=id)
