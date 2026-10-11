"""V8 recorded evidence. This route reads artifacts; it does not invent a run."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter

from services.integrations.ebi_vcf.validator import EbiVcfValidator
from services.integrations.elevenlabs.adapter import ElevenLabsAdapter
from services.integrations.raindrop.adapter import RaindropAdapter
from services.runtime.evolution.gepa_adapter import gepa_package_status

router = APIRouter(prefix="/api/v8", tags=["v8"])


def _artifact_dir() -> Path:
    return Path("artifacts/v8")


@router.get("/health")
async def v8_health() -> dict:
    ebi = EbiVcfValidator()
    checksum_ok, checksum_detail = ebi.checksums_match()
    gepa_status, gepa_detail = gepa_package_status()
    raindrop = RaindropAdapter()
    voice = ElevenLabsAdapter()
    return {
        "ebi_vcf_validator": {
            "status": "CONNECTED" if checksum_ok else "FAILED",
            "detail": checksum_detail,
            "version": ebi.get_version() if checksum_ok else "unavailable",
        },
        "biomni": {
            "status": "CONNECTED",
            "detail": "Read-only VCF inspection is local. Biomni agent code execution is DISABLED.",
            "agent_execution": "DISABLED",
        },
        "gepa": {"status": gepa_status, "detail": gepa_detail},
        "proposer": "DETERMINISTIC",
        "meta_harness_imported": False,
        "raindrop": {"status": raindrop.status},
        "elevenlabs": {"status": voice.status},
    }


@router.get("/latest")
async def v8_latest() -> dict:
    directory = _artifact_dir()
    receipt_path = directory / "evidence_receipt.json"
    if not receipt_path.is_file():
        return {"status": "NOT_RUN", "receipt": None, "lineage": None, "metrics": None}
    receipt = json.loads(receipt_path.read_text())
    metadata = receipt.get("metadata") or {}
    lineage = json.loads((directory / "lineage.json").read_text()) if (directory / "lineage.json").is_file() else None
    metrics = json.loads((directory / "runtime_metrics.json").read_text()) if (directory / "runtime_metrics.json").is_file() else None
    diff = json.loads((directory / "harness_diff.json").read_text()) if (directory / "harness_diff.json").is_file() else None
    negative_count = metadata.get("negative_control_count") or 0
    false_positives = metadata.get("false_positive_count") or 0
    view = {
        "receipt_id": receipt["receipt_id"],
        "receipt_digest": receipt["receipt_digest"],
        "run_id": receipt["run_id"],
        "parent_version_id": metadata.get("parent_version_id", ""),
        "candidate_version_id": metadata.get("candidate_version_id") or "",
        "score": metadata.get("score") or "0/0",
        "parent_score": metadata.get("parent_score") or "0/0",
        "false_positive_rate": (false_positives / negative_count) if negative_count else 0.0,
        "promoted": receipt["decision"] == "PROMOTED",
        "decision_reason": metadata.get("decision_reason") or receipt["decision"],
        "created_at": receipt.get("created_at", ""),
        "optimizer_provenance": metadata.get("optimizer_provenance", "DETERMINISTIC"),
        "adjudication": receipt["dual_validator_agreement"],
        "holdout_case_ids": metadata.get("holdout_case_ids", []),
        "reference_artifact_sha256": metadata.get("reference_artifact_sha256", ""),
        "raindrop_status": metadata.get("raindrop_status", "NOT_CONFIGURED"),
        "elevenlabs_status": metadata.get("elevenlabs_status", "NOT_CONFIGURED"),
        "false_positive_count": false_positives,
        "negative_control_count": negative_count,
    }
    nodes = [] if lineage is None else lineage.get("nodes", [])
    edges = [{"source": node["parent_id"], "target": node["id"]} for node in nodes if node.get("parent_id")]
    return {"status": "RECORDED", "receipt": view, "lineage": {"nodes": nodes, "edges": edges}, "metrics": metrics, "diff": diff}
