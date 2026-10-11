from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class AdjudicationVerdict(str, Enum):
    AGREE_PASS = "AGREE_PASS"
    AGREE_FAIL = "AGREE_FAIL"
    DISAGREE = "DISAGREE"
    INCONCLUSIVE = "INCONCLUSIVE"
    TOOL_ERROR = "TOOL_ERROR"


class ScientificToolManifest(BaseModel):
    name: str
    version: str = "1.0.0"
    description: str
    category: str = "genomics_inspection"  # inspection, validation, normalization, reflection
    accepted_formats: list[str] = Field(default_factory=lambda: ["vcf", "vcf.gz", "fasta"])
    supported_outputs: list[str] = Field(default_factory=lambda: ["json", "receipt"])
    deterministic: bool = True
    permission_level: str = "read_only"  # read_only, sandboxed_scratch, restricted_exec
    resource_budget: dict[str, Any] = Field(
        default_factory=lambda: {"timeout_sec": 15.0, "max_memory_mb": 512}
    )


class ToolInvocationRequest(BaseModel):
    tool_id: str
    artifact_id_or_path: str
    reference_id_or_path: str | None = None
    arguments: dict[str, Any] = Field(default_factory=dict)
    context_budget: dict[str, Any] = Field(default_factory=dict)


class ToolInvocationResult(BaseModel):
    tool_id: str
    status: str = "SUCCESS"  # SUCCESS, FAIL, ERROR
    findings: list[dict[str, Any]] = Field(default_factory=list)
    exit_code: int = 0
    stdout: str = ""
    stderr: str = ""
    output_artifact_hashes: list[str] = Field(default_factory=list)
    runtime_ms: float = 0.0


class ScientificCheckResult(BaseModel):
    validator_id: str
    tool_version: str
    status: str  # PASS, FAIL, WARNING, INCONCLUSIVE, ERROR
    check_id: str
    locus: str | None = None
    message: str = ""
    details: dict[str, Any] = Field(default_factory=dict)


class GenomicIncident(BaseModel):
    incident_id: str
    run_id: str
    dataset_sha256: str
    reference_sha256: str
    failing_check: str
    error_signature: str
    disagreement_detected: bool = False
    status: str = "INVESTIGATING"  # INVESTIGATING, RESOLVED, QUARANTINED, INCONCLUSIVE
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class HarnessCandidatePatch(BaseModel):
    patch_id: str
    parent_version_id: str
    candidate_version_id: str
    optimizer_source: str  # META_HARNESS, GEPA, REFLECTIVE_DETERMINISTIC
    policy_diff: dict[str, Any] = Field(default_factory=dict)
    canonical_hash: str
    rationale: str = ""


class SafetyGateOutcome(BaseModel):
    gate_id: str
    passed: bool
    reason: str


class EvaluationRun(BaseModel):
    eval_id: str
    run_id: str
    parent_version: str
    candidate_version: str
    oracle_results: list[dict[str, Any]] = Field(default_factory=list)
    parent_score: str
    candidate_score: str
    promoted: bool
    safety_gates: list[SafetyGateOutcome] = Field(default_factory=list)


class EvidenceReceiptV8(BaseModel):
    receipt_id: str
    run_id: str
    incident_id: str
    candidate_hash: str
    dual_validator_agreement: AdjudicationVerdict
    safety_gates: dict[str, bool] = Field(default_factory=dict)
    decision: str  # PROMOTED, REJECTED
    receipt_digest: str
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    metadata: dict[str, Any] = Field(default_factory=dict)


class ExternalIntegrationHealth(BaseModel):
    name: str
    status: str  # CONNECTED, TESTED_MOCK_ONLY, INSTALLED_UNCONFIGURED, DISABLED, UNSUPPORTED, FAILED
    version: str = "unknown"
    mode: str = "sandbox"
    details: str = ""
