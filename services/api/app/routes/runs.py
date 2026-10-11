from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator

from services.api.app.dependencies import (
    get_event_repo,
    get_mongo_client,
    get_run_repo,
)
from services.integrations.mongodb import (
    EventRepository,
    MongoDBClient,
    RunModel,
    RunRepository,
    RunState,
)
from services.integrations.raindrop import RaindropAdapter, RunMetadata
from services.runtime.orchestration import AgentRunner
from services.runtime.providers import build_model_provider

router = APIRouter(prefix="/api/runs", tags=["runs"])

MAX_SEQ = 2**63 - 1
MAX_FILENAME_LEN = 255
FINISHED_STATES = {RunState.PROMOTED, RunState.REJECTED, RunState.INCONCLUSIVE, RunState.COMPLETED}
DEAD_STATES = {RunState.FAILED, RunState.CANCELLED}

def _check_filename(value: str) -> str:
    if (
        len(value) > MAX_FILENAME_LEN
        or ".." in value
        or "/" in value
        or "\\" in value
        or "\x00" in value
    ):
        raise ValueError("filename must be a plain base filename of at most 255 characters")
    return value

class CreateRunRequest(BaseModel):
    task_id: str | None = None
    vcf_filename: str = "ref_mismatch.vcf"
    fasta_filename: str = "ref_synthetic_chr22.fasta"

    @field_validator("vcf_filename", "fasta_filename")
    @classmethod
    def _plain_filename(cls, value: str) -> str:
        return _check_filename(value)

@router.post("")
async def create_run(
    req: CreateRunRequest,
    run_repo: RunRepository = Depends(get_run_repo),
):
    now_ts = int(datetime.now(UTC).timestamp())
    suffix = uuid4().hex[:12]
    run_id = f"run-{now_ts}-{suffix}"
    task_id = req.task_id or f"task-{now_ts}-{suffix}"

    run_model = RunModel(
        run_id=run_id,
        task_id=task_id,
        status=RunState.CREATED,
        active_harness_version="harness-v1",
        vcf_filename=req.vcf_filename,
        fasta_filename=req.fasta_filename,
    )
    saved_run = await run_repo.create_run(run_model)
    return saved_run.model_dump(mode="json")

@router.get("/{id}")
async def get_run(
    id: str,
    run_repo: RunRepository = Depends(get_run_repo),
):
    run_model = await run_repo.get_run(id)
    if not run_model:
        raise HTTPException(status_code=404, detail=f"Run '{id}' not found")
    return run_model.model_dump(mode="json")

@router.post("/{id}/evolve")
async def evolve_run(
    id: str,
    mongo: MongoDBClient = Depends(get_mongo_client),
    run_repo: RunRepository = Depends(get_run_repo),
):
    run_model = await run_repo.get_run(id)
    if not run_model:
        raise HTTPException(status_code=404, detail=f"Run '{id}' not found")
    if run_model.status in FINISHED_STATES:
        return run_model.model_dump(mode="json")
    if run_model.status in DEAD_STATES:
        raise HTTPException(
            status_code=409, detail=f"Run '{id}' is {run_model.status.value} and cannot evolve"
        )

    runner = AgentRunner(mongo)
    runner.proposer = build_model_provider()
    vcf_file = run_model.vcf_filename or "ref_mismatch.vcf"
    fasta_file = run_model.fasta_filename or "ref_synthetic_chr22.fasta"
    try:
        _check_filename(vcf_file)
        _check_filename(fasta_file)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    raindrop = RaindropAdapter()
    if raindrop.status == "CONFIGURED":
        await raindrop.start_run(
            RunMetadata(
                run_id=id,
                task_id=run_model.task_id,
                dataset_id="fixture",
                harness_version=run_model.active_harness_version,
                started_at=datetime.now(UTC).isoformat(),
            )
        )
    res = await runner.execute_run(
        task_id=run_model.task_id,
        run_id=id,
        vcf_filename=vcf_file,
        fasta_filename=fasta_file,
    )
    return res

@router.get("/{id}/events")
async def get_run_events(
    id: str,
    after_seq: int = Query(default=0, le=MAX_SEQ),
    event_repo: EventRepository = Depends(get_event_repo),
):
    events = await event_repo.get_events(run_id=id, after_seq=after_seq, limit=200)
    return {
        "run_id": id,
        "events": [e.model_dump(mode="json") for e in events],
    }

@router.get("/{id}/stream")
async def stream_run_events(
    id: str,
    request: Request,
    event_repo: EventRepository = Depends(get_event_repo),
):
    """
    SSE stream yielding real monotonic events with sequence ID and heartbeats.
    """
    async def event_generator() -> AsyncGenerator[str, None]:
        last_seq = 0
        last_event_id_header = request.headers.get("Last-Event-ID")
        if (
            last_event_id_header
            and last_event_id_header.isascii()
            and last_event_id_header.isdigit()
            and int(last_event_id_header) <= MAX_SEQ
        ):
            last_seq = int(last_event_id_header)

        idle_ticks = 0
        while not await request.is_disconnected():
            events = await event_repo.get_events(run_id=id, after_seq=last_seq, limit=50)

            if events:
                idle_ticks = 0
                for evt in events:
                    last_seq = evt.seq
                    data = json.dumps(evt.model_dump(mode="json"))
                    yield f"id: {last_seq}\nevent: {evt.event_type}\ndata: {data}\n\n"
            else:
                idle_ticks += 1
                if idle_ticks % 3 == 0:
                    yield ": ping heartbeat\n\n"

            await asyncio.sleep(1.0)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
