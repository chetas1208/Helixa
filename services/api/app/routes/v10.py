"""V10 genome workspace and population-simulation routes."""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from services.integrations.raindrop import RaindropAdapter
from services.integrations.voyage import VoyageAdapter
from services.runtime.genome_workspace.catalog import PRESETS, parameter_specs
from services.runtime.genome_workspace.store import WorkspaceConflict, WorkspaceStore
from services.runtime.population.wright_fisher import SimulationError

router = APIRouter(prefix="/api/v10", tags=["v10"])
_store = WorkspaceStore()


def _attach_sponsors(record: dict) -> None:
    """Record the run with Raindrop and embed the explanation. Failures stay local."""
    summary = {
        "run_id": record["simulation_id"],
        "workspace_id": record["workspace_id"],
        "seed": record.get("seed"),
        "generations": record.get("generations_executed"),
        "fitness_class": record.get("fitness_class"),
    }
    try:
        import asyncio

        async def _send() -> None:
            adapter = RaindropAdapter()
            if adapter.status == "CONFIGURED":
                await adapter.finish_run(record["simulation_id"], summary)

        asyncio.run(_send())
    except Exception:
        pass
    try:
        adapter = VoyageAdapter()
        vector = adapter.embed(str(record.get("narrative") or "")[:500])
        if vector:
            record["embedding_dimensions"] = len(vector)
            record["embedding_model"] = adapter.config.embedding_model
    except Exception:
        record["embedding_dimensions"] = None


class WorkspaceBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class BranchBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class SelectBody(BaseModel):
    expected_counter: int | None = None


class InterpretBody(BaseModel):
    text: str = Field(min_length=1, max_length=500)


class RenameBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class ProposalBody(BaseModel):
    position: int = Field(ge=1)
    alt: str = Field(min_length=1, max_length=1)
    note: str = ""


class CommitBody(BaseModel):
    proposal_id: str
    expected_counter: int


class SimulationBody(BaseModel):
    workspace_id: str | None = None
    horizon_years: float = 2000
    generation_time_years: float = 25
    population_size: int = 80
    initial_frequency: float = 0.5
    selection_coefficient: float = 0.0
    mutation_forward: float = 0.0
    migration_rate: float = 0.0
    migrant_frequency: float = 0.0
    seed: int = 1
    fitness_class: str = "EDUCATIONAL_TOY"
    ploidy: int = 1
    temperature_c: float | None = None
    precipitation_mm_year: float | None = None
    allow_acceleration: bool = False
    replicates: int = 1
    dominance_h: float = 0.5
    carrying_capacity: int = 1000
    intrinsic_growth_rate: float = 0.0
    engine_mode: str = "MODE_A_WRIGHT_FISHER"
    environment: dict | None = None
    environment_selection_model: dict | None = None


def _missing(exc: KeyError) -> HTTPException:
    return HTTPException(status_code=404, detail=str(exc) or "not found")


@router.get("/genome/baselines")
def baselines() -> dict:
    return _store.describe_reference()


@router.get("/genome/window")
def genome_window(start: int = 1, end: int = 48) -> dict:
    try:
        return _store.read_window(start, end)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/genome/workspaces")
def create_workspace(body: WorkspaceBody) -> dict:
    return _store.create_workspace(body.name)


@router.get("/genome/workspaces")
def list_workspaces() -> dict:
    return {"workspaces": _store.list_workspaces(), "active": _store.active()}


@router.get("/genome/workspaces/active/snapshot")
def active_snapshot() -> dict:
    return _store.snapshot()


@router.get("/genome/workspaces/active")
def active_workspace() -> dict:
    current = _store.active()
    if current is None:
        raise HTTPException(status_code=404, detail="no active workspace")
    return current


@router.get("/genome/workspaces/{workspace_id}")
def get_workspace(workspace_id: str) -> dict:
    try:
        return _store.get_workspace(workspace_id)
    except KeyError as exc:
        raise _missing(exc) from exc


@router.post("/genome/workspaces/{workspace_id}/select")
def select_workspace(workspace_id: str, body: SelectBody) -> dict:
    try:
        return _store.select(workspace_id, body.expected_counter)
    except KeyError as exc:
        raise _missing(exc) from exc
    except WorkspaceConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/genome/workspaces/{workspace_id}/branch")
def branch_workspace(workspace_id: str, body: BranchBody) -> dict:
    try:
        return _store.branch(workspace_id, body.name)
    except KeyError as exc:
        raise _missing(exc) from exc


@router.post("/genome/workspaces/{workspace_id}/interpret")
def interpret(workspace_id: str, body: InterpretBody) -> dict:
    try:
        return _store.interpret(workspace_id, body.text)
    except KeyError as exc:
        raise _missing(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/genome/workspaces/{workspace_id}/genome-lineage")
def genome_lineage(workspace_id: str) -> dict:
    try:
        return _store.genome_lineage(workspace_id)
    except KeyError as exc:
        raise _missing(exc) from exc


@router.get("/genome/workspaces/{workspace_id}/harness-lineage")
def harness_lineage(workspace_id: str) -> dict:
    try:
        return _store.harness_lineage(workspace_id)
    except KeyError as exc:
        raise _missing(exc) from exc


@router.get("/genome/workspaces/{workspace_id}/body-descriptor")
def body_descriptor(workspace_id: str) -> dict:
    try:
        return _store.body_descriptor(workspace_id)
    except KeyError as exc:
        raise _missing(exc) from exc


@router.patch("/genome/workspaces/{workspace_id}")
def rename_workspace(workspace_id: str, body: RenameBody) -> dict:
    try:
        return _store.rename(workspace_id, body.name)
    except KeyError as exc:
        raise _missing(exc) from exc


@router.post("/genome/workspaces/{workspace_id}/archive")
def archive_workspace(workspace_id: str) -> dict:
    try:
        return _store.archive(workspace_id)
    except KeyError as exc:
        raise _missing(exc) from exc
@router.post("/genome/workspaces/{workspace_id}/proposals")
def propose_edit(workspace_id: str, body: ProposalBody) -> dict:
    try:
        return _store.propose(workspace_id, body.position, body.alt, body.note)
    except KeyError as exc:
        raise _missing(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/genome/workspaces/{workspace_id}/commit")
def commit_edit(
    workspace_id: str,
    body: CommitBody,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict:
    try:
        return _store.commit(workspace_id, body.proposal_id, body.expected_counter, idempotency_key)
    except KeyError as exc:
        raise _missing(exc) from exc
    except WorkspaceConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/genome/workspaces/{workspace_id}/intelligence")
def intelligence(workspace_id: str) -> dict:
    try:
        return _store.intelligence(workspace_id)
    except KeyError as exc:
        raise _missing(exc) from exc


@router.get("/evolution/environments")
def environments() -> dict:
    return {"presets": PRESETS, "nasa_power": "NOT_CONFIGURED"}


@router.get("/evolution/parameters")
def parameters() -> dict:
    return {"parameters": parameter_specs()}


@router.get("/evolution/simulations")
def list_simulations(workspace_id: str) -> dict:
    try:
        return {"simulations": _store.list_simulations(workspace_id)}
    except KeyError as exc:
        raise _missing(exc) from exc


@router.post("/evolution/simulations")
def simulate(
    body: SimulationBody,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict:
    try:
        record = _store.simulate(body.model_dump(), idempotency_key)
    except KeyError as exc:
        raise _missing(exc) from exc
    except SimulationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _attach_sponsors(record)
    return record


@router.get("/evolution/simulations/{simulation_id}/playback")
def playback(simulation_id: str, duration_seconds: int = 60) -> dict:
    try:
        return _store.playback(simulation_id, duration_seconds)
    except KeyError as exc:
        raise _missing(exc) from exc


@router.get("/evolution/simulations/{simulation_id}")
def get_simulation(simulation_id: str) -> dict:
    try:
        return _store.get_simulation(simulation_id)
    except KeyError as exc:
        raise _missing(exc) from exc


@router.get("/evolution/simulations/{simulation_id}/stream")
async def stream_simulation(simulation_id: str):
    import json

    from starlette.responses import StreamingResponse

    try:
        record = _store.get_simulation(simulation_id)
    except KeyError as exc:
        raise _missing(exc) from exc

    async def event_generator():
        frames = record.get("frames", [])
        total = len(frames)
        yield f"event: start\ndata: {json.dumps({'simulation_id': simulation_id, 'total_frames': total})}\n\n"
        for idx, frame in enumerate(frames):
            yield f"event: frame\ndata: {json.dumps({'index': idx, 'frame': frame})}\n\n"
        yield f"event: complete\ndata: {json.dumps({'simulation_id': simulation_id, 'result_sha256': record.get('result_sha256')})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
