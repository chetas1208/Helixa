from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from services.api.app.config import config
from services.runtime.evolution.candidate_search import BoundedCandidateSearch
from services.runtime.harness.baseline import get_baseline_harness
from services.runtime.incidents.investigator import IncidentInvestigator
from services.runtime.optimization.optimizer import ReflectiveHarnessOptimizer

router = APIRouter(prefix="/api/runs", tags=["Investigations & Evolution"])

investigator = IncidentInvestigator()
optimizer = ReflectiveHarnessOptimizer()
candidate_search = BoundedCandidateSearch()


class InvestigateRequest(BaseModel):
    vcf_path: str = "fixtures/invalid/ref_mismatch.vcf"
    fasta_path: str = "fixtures/references/ref_synthetic_chr22.fasta"
    harness_version_id: str = "harness-v1-baseline"


class EvolveRequest(BaseModel):
    failure_finding: dict
    harness_version_id: str = "harness-v1-baseline"

    @field_validator("failure_finding")
    @classmethod
    def _details_must_be_text(cls, value: dict) -> dict:
        if "details" in value and not isinstance(value["details"], str):
            raise ValueError("failure_finding.details must be a string")
        return value


def _resolve_input_file(raw: str, label: str) -> Path:
    try:
        path = Path(raw).resolve()
    except (ValueError, OSError):
        raise HTTPException(status_code=400, detail=f"Invalid {label} path")
    roots = (Path(config.fixtures_dir).resolve(), Path("artifacts/cas").resolve())
    if not any(path.is_relative_to(root) for root in roots):
        raise HTTPException(
            status_code=400,
            detail=f"{label} must be inside the fixtures or artifacts/cas directory",
        )
    try:
        is_file = path.is_file()
    except OSError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid {label} path") from exc
    if not is_file:
        raise HTTPException(status_code=404, detail=f"{label} not found at {raw}")
    return path


@router.post("/{run_id}/investigate")
async def investigate_run(run_id: str, req: InvestigateRequest):
    vcf = _resolve_input_file(req.vcf_path, "VCF file")
    fasta = _resolve_input_file(req.fasta_path, "FASTA reference")

    record = investigator.investigate_run_failure(
        run_id=run_id,
        vcf_path=vcf,
        fasta_path=fasta,
        harness_version_id=req.harness_version_id,
    )
    return {
        "incident_id": record.incident_id,
        "run_id": record.run_id,
        "status": record.status,
        "error_signature": record.error_signature,
        "source_artifact_sha256": record.source_artifact_sha256,
        "reference_sha256": record.reference_sha256,
        "causal_chain_length": len(record.causal_chain),
        "reproducibility_bundle": record.reproducibility_bundle,
    }


@router.post("/{run_id}/evolve")
async def evolve_harness(run_id: str, req: EvolveRequest):
    baseline = get_baseline_harness()
    candidates = optimizer.propose_candidates(
        parent=baseline,
        failure_finding=req.failure_finding,
    )
    if not candidates:
        raise HTTPException(status_code=400, detail="Optimizer could not propose any safe candidate.")

    branches = candidate_search.generate_candidate_branches(
        parent=baseline,
        hypothesis=candidates[0].hypothesis,
    )

    return {
        "run_id": run_id,
        "parent_version": baseline.version_id,
        "hypothesis": {
            "failure_type": candidates[0].hypothesis.failure_type,
            "target_locus": candidates[0].hypothesis.target_locus,
            "rationale": candidates[0].hypothesis.rationale,
        },
        "proposed_candidates_count": len(candidates),
        "candidate_branches": [
            {
                "version_id": spec.version_id,
                "config_hash": c_hash,
                "require_ref_check": spec.validation_policy.require_reference_allele_check,
                "require_contig_check": spec.validation_policy.require_contig_compatibility,
            }
            for spec, c_hash in branches
        ],
    }
