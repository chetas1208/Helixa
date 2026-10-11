"""V14 genome-edit commands and proposals. Interpret never writes a revision."""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from services.integrations.raindrop import RaindropAdapter
from services.runtime.genome_edit.parser import interpret_command
from services.runtime.genome_workspace.store import WorkspaceConflict, WorkspaceStore

router = APIRouter(prefix="/api/genome-edit", tags=["genome-edit"])
_fallback_store = WorkspaceStore()
_store: WorkspaceStore | None = None


def _get_store() -> WorkspaceStore:
    if _store is not None:
        return _store
    try:
        from services.api.app.routes import v10
        return getattr(v10, "_store", _fallback_store)
    except Exception:
        return _fallback_store


class SelectionBody(BaseModel):
    anatomy_id: str | None = None
    gene_id: str | None = None
    locus_id: str | None = None
    position: int | None = None


class InterpretBody(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    workspace_id: str | None = None
    source: str = "text"
    selection: SelectionBody | None = None


class ProposalBody(BaseModel):
    workspace_id: str
    parent_revision_id: str | None = None
    locus_id: str | None = None
    reference_asset_id: str | None = None
    position: int = Field(ge=1)
    alt: str = Field(min_length=1, max_length=1)
    source: str = "manual"
    note: str | None = None
    anatomy_id: str | None = None
    contig: str | None = None
    gene_id: str | None = None
    gene_symbol: str | None = None
    ref: str | None = None
    stated_ref: str | None = None


class ApplyBody(BaseModel):
    expected_counter: int


def _missing(exc: KeyError) -> HTTPException:
    return HTTPException(status_code=404, detail=str(exc) or "not found")


@router.post("/interpret-command")
def interpret(body: InterpretBody) -> dict:
    payload = body.model_dump()
    # Grammar only. Optional LLM may suggest and is never mixed into intent.
    return interpret_command(payload)


@router.post("/proposals")
def create_proposal(body: ProposalBody) -> dict:
    try:
        return _get_store().create_genome_edit_proposal(body.model_dump())
    except KeyError as exc:
        raise _missing(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/proposals/{proposal_id}")
def get_proposal(proposal_id: str) -> dict:
    try:
        return _get_store().get_genome_edit_proposal(proposal_id)
    except KeyError as exc:
        raise _missing(exc) from exc


@router.post("/proposals/{proposal_id}/validate")
def validate_proposal(proposal_id: str) -> dict:
    try:
        return _get_store().validate_genome_edit_proposal(proposal_id)
    except KeyError as exc:
        raise _missing(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/proposals/{proposal_id}/apply")
def apply_proposal(
    proposal_id: str,
    body: ApplyBody,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict:
    try:
        result = _get_store().apply_genome_edit_proposal(proposal_id, body.expected_counter, idempotency_key)
    except KeyError as exc:
        raise _missing(exc) from exc
    except WorkspaceConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _emit_ids_only(result)
    return result


def _emit_ids_only(result: dict) -> None:
    """Raindrop may receive identifiers only. Never sequence, audio, or transcripts."""
    try:
        import asyncio

        receipt = result.get("receipt") or {}
        adapter = RaindropAdapter()
        if adapter.status != "CONFIGURED":
            return

        async def _send() -> None:
            await adapter.record_ids(
                "genome_edit.applied",
                {
                    "proposal_id": receipt.get("proposal_id"),
                    "workspace_id": receipt.get("workspace_id"),
                    "genome_revision_id": receipt.get("genome_revision_id"),
                },
            )

        asyncio.run(_send())
    except Exception:
        pass
