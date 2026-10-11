"""Typed contracts for the V8 scientific integration layer."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class IntegrationStatus(str, Enum):
    CONNECTED = "CONNECTED"
    TESTED_MOCK_ONLY = "TESTED_MOCK_ONLY"
    INSTALLED_UNCONFIGURED = "INSTALLED_UNCONFIGURED"
    DISABLED = "DISABLED"
    UNSUPPORTED = "UNSUPPORTED"
    FAILED = "FAILED"
    NOT_CONFIGURED = "NOT_CONFIGURED"


class Adjudication(str, Enum):
    AGREE_PASS = "AGREE_PASS"
    AGREE_FAIL = "AGREE_FAIL"
    DISAGREE = "DISAGREE"
    INCONCLUSIVE = "INCONCLUSIVE"
    TOOL_ERROR = "TOOL_ERROR"


class OptimizerProvenance(str, Enum):
    GEPA = "GEPA"
    META_HARNESS = "META_HARNESS"
    DETERMINISTIC = "DETERMINISTIC"


class ScientificToolManifest(BaseModel):
    schema_version: int = 1
    tool_id: str
    name: str
    description: str
    allowed_purpose: str
    biological_safety_class: str = "research_read_only"
    category: str  # deterministic | model_driven | schema_only
    input_formats: list[str] = Field(default_factory=list)
    output_kinds: list[str] = Field(default_factory=list)
    executable: bool = False
    source: str
    source_revision: str | None = None


class ToolInvocationRequest(BaseModel):
    schema_version: int = 1
    tool_id: str
    artifact_ids: list[str] = Field(default_factory=list)
    artifact_sha256: list[str] = Field(default_factory=list)
    arguments: dict[str, Any] = Field(default_factory=dict)
    purpose: str = "research_metadata"
    timeout_sec: float = 15.0


class ToolInvocationResult(BaseModel):
    schema_version: int = 1
    tool_id: str
    status: str
    findings: list[dict[str, Any]] = Field(default_factory=list)
    stdout_summary: str = ""
    stderr_summary: str = ""
    exit_code: int | None = None
    evidence_sha256: str | None = None
    provenance: str
    elapsed_ms: float = 0.0
    timestamp: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class ScientificCheckResult(BaseModel):
    schema_version: int = 1
    check_id: str
    adjudication: Adjudication
    native_status: str
    external_status: str
    assertion: str
    native_detail: str = ""
    external_detail: str = ""
    tool_versions: dict[str, str] = Field(default_factory=dict)


class GenomicIncident(BaseModel):
    schema_version: int = 1
    incident_id: str
    fixture_id: str
    summary: str
    harness_defect: str
    input_corruption_fixable_by_policy: bool = False
    training_case_ids: list[str] = Field(default_factory=list)


class HarnessCandidatePatch(BaseModel):
    schema_version: int = 1
    candidate_id: str
    parent_version_id: str
    provenance: OptimizerProvenance
    spec: dict[str, Any]
    spec_hash: str
    diff: dict[str, Any]
    intentionally_unsafe: bool = False
    rationale: str


class SafetyGateOutcome(BaseModel):
    schema_version: int = 1
    candidate_id: str
    accepted_for_evaluation: bool
    reason: str
    violated_rules: list[str] = Field(default_factory=list)


class ExternalIntegrationHealth(BaseModel):
    schema_version: int = 1
    component: str
    status: IntegrationStatus
    detail: str
    revision: str | None = None
    version: str | None = None


class EvidenceReceiptV8(BaseModel):
    schema_version: int = 1
    receipt_id: str
    run_id: str
    parent_version_id: str
    candidate_version_id: str
    optimizer_provenance: OptimizerProvenance
    promoted: bool
    decision_reason: str
    parent_passed: int
    parent_total: int
    candidate_passed: int
    candidate_total: int
    false_positive_count: int
    negative_control_count: int
    holdout_case_ids: list[str]
    adjudication: Adjudication
    reference_artifact_sha256: str
    configuration_hashes: dict[str, str]
    checkpoint_id: str | None = None
    raindrop_status: str
    elevenlabs_status: str
    fingerprint_sha256: str = ""
