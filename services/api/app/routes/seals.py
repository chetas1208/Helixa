from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException

from services.runtime.evaluation.seal import EvidenceSealV1, verify_evidence_seal

router = APIRouter(prefix="/api", tags=["Evidence Seals & Experiments"])

# In-memory storage for active seals (backed by artifacts/)
SEALS_DIR = Path("artifacts/v7/seals").resolve()
SEALS_DIR.mkdir(parents=True, exist_ok=True)
_SEAL_ID_RE = re.compile(r"[A-Za-z0-9._-]{1,128}")


@router.get("/evidence-seals/{seal_id}")
async def get_evidence_seal(seal_id: str):
    if not _SEAL_ID_RE.fullmatch(seal_id):
        raise HTTPException(status_code=404, detail="Evidence seal not found")
    file_path = SEALS_DIR / f"{seal_id}.json"
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Evidence seal not found")

    return json.loads(file_path.read_text(encoding="utf-8"))


@router.get("/evidence-seals/{seal_id}/verify")
async def verify_seal_endpoint(seal_id: str):
    seal_dict = await get_evidence_seal(seal_id)
    seal = EvidenceSealV1(**seal_dict)
    valid, reason = verify_evidence_seal(seal)
    return {
        "seal_id": seal.seal_id,
        "is_valid": valid,
        "stored_seal_hash": seal.seal_hash,
        "recomputed_hash": seal.compute_canonical_hash(),
        "verification_message": reason,
        "decision": seal.decision,
    }


@router.get("/experiments/v7")
async def list_v7_experiments():
    manifest_path = Path("fixtures/v7/manifests/benchmark_manifest.json").resolve()
    if not manifest_path.exists():
        raise HTTPException(status_code=404, detail="Benchmark manifest not found. Run generate_v7_corpus first.")

    cases = json.loads(manifest_path.read_text(encoding="utf-8"))
    return {
        "suite_id": "V7-GENOMIC-RELIABILITY-BENCHMARK",
        "total_scenario_families": len(cases),
        "partitions": {
            "dev_count": 5,
            "regression_count": 9,
            "sealed_holdout_count": 2,
        },
        "cases": cases,
    }
