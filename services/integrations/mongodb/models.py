from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class TaskStatus(str, Enum):
    CREATED = "CREATED"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"

class RunState(str, Enum):
    CREATED = "CREATED"
    RUNNING = "RUNNING"
    VALIDATING = "VALIDATING"
    DIAGNOSING = "DIAGNOSING"
    MUTATING = "MUTATING"
    EVALUATING = "EVALUATING"
    PROMOTED = "PROMOTED"
    REJECTED = "REJECTED"
    INCONCLUSIVE = "INCONCLUSIVE"
    COMPLETED = "COMPLETED"
    PAUSED = "PAUSED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"

class HarnessStatus(str, Enum):
    BASELINE = "BASELINE"
    CANDIDATE = "CANDIDATE"
    PROMOTED = "PROMOTED"
    REJECTED = "REJECTED"

class InvalidStateTransitionError(ValueError):
    """Raised when an illegal run state transition is attempted."""

class FencingTokenConflictError(RuntimeError):
    """Raised when a worker attempts an update with a stale fencing token."""

ALLOWED_RUN_TRANSITIONS: dict[RunState, set[RunState]] = {
    RunState.CREATED: {RunState.RUNNING, RunState.VALIDATING, RunState.PAUSED, RunState.FAILED, RunState.CANCELLED},
    RunState.RUNNING: {RunState.VALIDATING, RunState.DIAGNOSING, RunState.PAUSED, RunState.FAILED, RunState.CANCELLED},
    RunState.VALIDATING: {RunState.DIAGNOSING, RunState.COMPLETED, RunState.PAUSED, RunState.FAILED, RunState.CANCELLED},
    RunState.DIAGNOSING: {RunState.MUTATING, RunState.COMPLETED, RunState.PAUSED, RunState.FAILED, RunState.CANCELLED},
    RunState.MUTATING: {RunState.EVALUATING, RunState.PAUSED, RunState.FAILED, RunState.CANCELLED},
    RunState.EVALUATING: {RunState.PROMOTED, RunState.REJECTED, RunState.INCONCLUSIVE, RunState.PAUSED, RunState.FAILED, RunState.CANCELLED},
    RunState.PROMOTED: {RunState.COMPLETED, RunState.FAILED, RunState.CANCELLED},
    RunState.REJECTED: {RunState.COMPLETED, RunState.FAILED, RunState.CANCELLED},
    RunState.INCONCLUSIVE: {RunState.COMPLETED, RunState.FAILED, RunState.CANCELLED},
    RunState.PAUSED: {RunState.RUNNING, RunState.VALIDATING, RunState.DIAGNOSING, RunState.MUTATING, RunState.EVALUATING, RunState.CANCELLED},
    RunState.COMPLETED: set(),
    RunState.FAILED: set(),
    RunState.CANCELLED: set(),
}

def validate_state_transition(current: RunState, target: RunState) -> None:
    if current == target:
        return
    allowed = ALLOWED_RUN_TRANSITIONS.get(current, set())
    if target not in allowed:
        raise InvalidStateTransitionError(
            f"Illegal state transition from '{current.value}' to '{target.value}'. Allowed targets: {sorted(s.value for s in allowed)}"
        )

# 1. Dataset Model
class DatasetModel(BaseModel):
    dataset_id: str
    manifest_version: str = "1.0.0"
    declared_assembly: str = "GRCh38"
    is_synthetic: bool = True
    reference: dict[str, Any] = Field(default_factory=dict)
    fixtures: dict[str, Any] | list[Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())

# 2. Artifact Model
class ArtifactModel(BaseModel):
    artifact_id: str
    artifact_sha256: str
    dataset_id: str | None = None
    run_id: str | None = None
    filename: str
    file_format: str
    byte_size: int
    storage_path: str
    storage_backend: str = "local_cas"
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())

# 3. Task Model
class TaskModel(BaseModel):
    task_id: str
    dataset_id: str = "SYNTH-GENOME-INCIDENT-001"
    status: TaskStatus = TaskStatus.CREATED
    worker_lease_owner: str | None = None
    worker_lease_expiry: str | None = None
    fence_token: int = 1
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())

# 4. Run Model
class RunModel(BaseModel):
    run_id: str
    task_id: str
    status: RunState = RunState.CREATED
    active_harness_version: str = "harness-v1"
    candidate_harness_version: str | None = None
    evidence_receipt_id: str | None = None
    worker_lease_owner: str | None = None
    worker_lease_expiry: str | None = None
    fence_token: int = 1
    seq_counter: int = 0
    vcf_filename: str | None = None
    fasta_filename: str | None = None
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())

# 5. Run Event Model
class RunEventModel(BaseModel):
    event_id: str
    run_id: str
    seq: int
    timestamp: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    event_type: str
    entity_id: str | None = None
    evidence_digest: str | None = None
    idempotency_key: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)

# 6. Checkpoint Model
class CheckpointModel(BaseModel):
    checkpoint_id: str
    run_id: str
    step_index: int
    state: RunState
    active_harness_id: str
    candidate_harness_id: str | None = None
    evidence_receipt_id: str | None = None
    fence_token: int = 1
    timestamp: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    payload: dict[str, Any] = Field(default_factory=dict)

# 7. Harness Version Model
class HarnessVersionModel(BaseModel):
    schema_version: int = 1
    harness_id: str = "diamond-genome"
    version_id: str
    parent_version_id: str | None = None
    status: HarnessStatus = HarnessStatus.BASELINE
    validation_policy: dict[str, Any] = Field(default_factory=dict)
    context_policy: dict[str, Any] = Field(default_factory=dict)
    execution_policy: dict[str, Any] = Field(
        default_factory=lambda: {"checkpoint_every_steps": 3, "max_attempts": 2}
    )
    allowed_tools: list[str] = Field(
        default_factory=lambda: [
            "inspect_manifest",
            "inspect_reference",
            "inspect_vcf",
            "run_validation",
            "query_prior_evidence",
            "read_harness_version",
            "propose_mutation",
            "request_evaluation",
            "inspect_receipt",
        ]
    )
    mutation_rationale: str | None = None
    diff_summary: dict[str, Any] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())

# 8. Harness Mutation Model
class HarnessMutationModel(BaseModel):
    mutation_id: str
    parent_version_id: str
    candidate_version_id: str
    run_id: str
    proposed_by: str = "deterministic-proposer"
    changes: dict[str, Any] = Field(default_factory=dict)
    rationale: str = ""
    timestamp: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())

# 9. Evaluation Model
class EvaluationModel(BaseModel):
    evaluation_id: str
    run_id: str
    candidate_version_id: str
    parent_version_id: str
    candidate_score: str
    parent_score: str
    false_positive_rate: float
    promoted: bool
    receipt_id: str
    metrics: dict[str, Any] = Field(default_factory=dict)
    timestamp: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())

# 10. Evidence Receipt Model
class EvidenceReceiptModel(BaseModel):
    receipt_id: str
    receipt_digest: str
    run_id: str
    parent_version_id: str | None = None
    candidate_version_id: str
    score: str
    parent_score: str | None = None
    false_positive_rate: float = 0.0
    promoted: bool
    fixtures_evaluated: int = 6
    parent_spec_hash: str | None = None
    candidate_spec_hash: str | None = None
    decision_reason: str = ""
    sha256: str = ""
    timestamp: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    signature: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

# 11. Research Memory Model
class ResearchMemoryModel(BaseModel):
    memory_id: str
    run_id: str
    memory_type: str = "incident"
    content: str
    tags: list[str] = Field(default_factory=list)
    timestamp: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())

# 12. Integration Event Model
class IntegrationEventModel(BaseModel):
    event_id: str
    component: str
    action: str
    status: str
    payload: dict[str, Any] = Field(default_factory=dict)
    timestamp: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
