from __future__ import annotations

import asyncio
import glob
import json
from collections.abc import AsyncGenerator
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from pymongo.errors import PyMongoError

from services.api.app.dependencies import get_mongo_client
from services.integrations.mongodb import MongoDBClient
from services.runtime.genomics.orchestrator import DeterministicGenomicsOrchestrator

router = APIRouter(prefix="/api/validation", tags=["validation"])

class RunValidationRequest(BaseModel):
    dataset_id: str = "default_dataset"
    vcf_filename: str = "valid_snvs.vcf"
    fasta_filename: str = "ref_synthetic_chr22.fasta"

def _is_allowed_file(p: Path) -> bool:
    try:
        if not p.is_file():
            return False
        resolved = p.resolve()
    except OSError:
        return False
    return any(resolved.is_relative_to(Path(root).resolve()) for root in ("fixtures", "artifacts/cas"))

def resolve_fixture_path(filename: str) -> Path:
    # First check relative to fixtures
    candidates = [
        Path(filename),
        Path("fixtures/valid") / filename,
        Path("fixtures/invalid") / filename,
        Path("fixtures/heldout") / filename,
        Path("artifacts/cas") / filename,
    ]
    for p in candidates:
        if _is_allowed_file(p):
            return p.resolve()
    # Check if basename matches anywhere in fixtures (literal name, deterministic order)
    pattern = f"**/{glob.escape(filename)}"
    for root in ("fixtures", "artifacts/cas"):
        try:
            matches = sorted(Path(root).glob(pattern))
        except OSError:
            continue
        for match in matches:
            if _is_allowed_file(match):
                return match.resolve()
    raise FileNotFoundError(f"Genomic fixture or artifact not found: '{filename}'")

@router.post("/run")
async def run_validation(
    req: RunValidationRequest,
    mongo: MongoDBClient = Depends(get_mongo_client),
):
    try:
        vcf_path = resolve_fixture_path(req.vcf_filename)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except OSError as e:
        raise HTTPException(status_code=400, detail="Invalid fixture filename") from e

    try:
        fasta_path = resolve_fixture_path(req.fasta_filename)
    except FileNotFoundError:
        fasta_path = Path("fixtures/references/ref_synthetic_chr22.fasta").resolve()

    orchestrator = DeterministicGenomicsOrchestrator(mongo_client=mongo)
    run, receipt = await orchestrator.execute_pipeline(
        vcf_path=vcf_path,
        fasta_path=fasta_path,
        dataset_id=req.dataset_id,
    )

    return {
        "run_id": run.run_id,
        "status": run.status.value,
        "target_artifact_sha256": run.target_artifact_sha256,
        "evidence_receipt_id": receipt.receipt_id,
        "evidence_digest": receipt.receipt_digest,
        "total_records": run.total_records,
        "passed_checks": run.passed_checks,
        "total_checks": run.total_checks,
        "runtime_ms": run.runtime_ms,
        "findings": [f.model_dump(mode="json") for f in run.findings],
        "evidence": receipt.model_dump(mode="json"),
    }

@router.get("/{id}")
async def get_validation_run(
    id: str,
    mongo: MongoDBClient = Depends(get_mongo_client),
):
    doc = await mongo.db.runs.find_one({"run_id": id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail=f"Validation run '{id}' not found")
    return doc

@router.get("/{id}/evidence")
async def get_validation_evidence(
    id: str,
    mongo: MongoDBClient = Depends(get_mongo_client),
):
    doc = await mongo.db.evidence_receipts.find_one({"run_id": id}, {"_id": 0})
    if not doc:
        doc = await mongo.db.evidence_receipts.find_one({"receipt_id": id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail=f"Evidence for run '{id}' not found")
    return doc

@router.get("/{id}/stream")
async def stream_validation_events(
    id: str,
    request: Request,
    vcf_filename: str = "valid_snvs.vcf",
    fasta_filename: str = "ref_synthetic_chr22.fasta",
    mongo: MongoDBClient = Depends(get_mongo_client),
):
    try:
        vcf_path = resolve_fixture_path(vcf_filename)
        fasta_path = resolve_fixture_path(fasta_filename)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    try:
        recorded = await mongo.db.runs.find_one({"run_id": id}, {"_id": 1}) or await mongo.db.evidence_receipts.find_one(
            {"run_id": id}, {"_id": 1}
        )
    except PyMongoError:
        recorded = None
    if recorded:
        raise HTTPException(status_code=409, detail=f"Validation run '{id}' already recorded")

    orchestrator = DeterministicGenomicsOrchestrator(mongo_client=mongo)

    async def event_generator() -> AsyncGenerator[str, None]:
        async for evt in orchestrator.stream_pipeline(
            vcf_path=vcf_path,
            fasta_path=fasta_path,
            run_id=id,
        ):
            if await request.is_disconnected():
                break
            payload = json.dumps(evt)
            yield f"data: {payload}\n\n"
            await asyncio.sleep(0.01)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
