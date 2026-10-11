from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.runtime.capabilities.macro_schema import (
    CapabilityRecord,
    CapabilityStatus,
    DeclarativeMacro,
)
from services.runtime.capabilities.registry import (
    CapabilityRegistry,
    InvalidMacroError,
    UnauthorizedPrimitiveError,
)

router = APIRouter(prefix="/api/capabilities", tags=["Capabilities"])

# Global shared registry instance
registry = CapabilityRegistry()


class RegisterMacroRequest(BaseModel):
    macro: DeclarativeMacro


@router.get("", response_model=list[CapabilityRecord])
async def list_capabilities(status: CapabilityStatus | None = None):
    return await registry.list_capabilities(status=status)


@router.get("/{capability_id}", response_model=CapabilityRecord)
async def get_capability(capability_id: str):
    cap = await registry.get_capability(capability_id)
    if not cap:
        raise HTTPException(status_code=404, detail=f"Capability '{capability_id}' not found.")
    return cap


@router.post("/register", response_model=CapabilityRecord)
async def register_macro(req: RegisterMacroRequest):
    try:
        return await registry.register_macro(req.macro)
    except (InvalidMacroError, UnauthorizedPrimitiveError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{capability_id}/activate", response_model=CapabilityRecord)
async def activate_capability(capability_id: str):
    try:
        return await registry.activate_capability(capability_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e.args[0]))


@router.post("/{capability_id}/quarantine", response_model=CapabilityRecord)
async def quarantine_capability(capability_id: str, reason: str = "Manual quarantine"):
    try:
        return await registry.quarantine_capability(capability_id, reason=reason)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e.args[0]))
