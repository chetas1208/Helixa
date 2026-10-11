from __future__ import annotations

import hashlib
import json
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class HarnessStatus(str, Enum):
    BASELINE = "BASELINE"
    CANDIDATE = "CANDIDATE"
    EVALUATING = "EVALUATING"
    PROMOTED = "PROMOTED"
    REJECTED = "REJECTED"
    ROLLED_BACK = "ROLLED_BACK"

class ContextPolicy(BaseModel):
    include_reference_metadata: bool = True
    include_prior_failures: bool = True
    max_context_items: int = 12

class ValidationPolicySpec(BaseModel):
    require_reference_allele_check: bool = True
    require_contig_compatibility: bool = True
    require_normalization_check: bool = True
    require_assembly_declaration: bool = True

class ExecutionPolicy(BaseModel):
    checkpoint_every_steps: int = 3
    max_attempts: int = 2

class HarnessSpec(BaseModel):
    schema_version: int = 1
    harness_id: str = "diamond-genome"
    version_id: str
    parent_version_id: str | None = None
    status: HarnessStatus = HarnessStatus.BASELINE
    context_policy: ContextPolicy
    validation_policy: ValidationPolicySpec
    execution_policy: ExecutionPolicy
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
    metadata: dict[str, Any] = Field(default_factory=dict)

    def canonical_json(self) -> str:
        data = self.model_dump(exclude={"status", "metadata"})
        return json.dumps(data, sort_keys=True)

    def compute_spec_hash(self) -> str:
        return hashlib.sha256(self.canonical_json().encode("utf-8")).hexdigest()

    def stable_version_id(self, role: str) -> str:
        """Content-addressed id. The random suffix is not part of the identity."""
        body = self.model_dump(exclude={"version_id", "status", "metadata", "parent_version_id"})
        token = hashlib.sha256(json.dumps(body, sort_keys=True).encode("utf-8")).hexdigest()[:8]
        parent = self.parent_version_id or self.version_id
        return f"{parent}-{role}-{token}"

class PolicyEnvelope(BaseModel):
    """
    Immutable bounds and permissions. Candidate harnesses are never allowed
    to exceed these limits or tamper with the evaluation oracle.
    """
    max_context_items_limit: int = 24
    max_attempts_limit: int = 5
    immutable_allowed_tools_whitelist: list[str] = Field(
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

    def validate_candidate(self, candidate: HarnessSpec) -> tuple[bool, str]:
        # 1. Allowed tools boundary
        for tool in candidate.allowed_tools:
            if tool not in self.immutable_allowed_tools_whitelist:
                return False, f"Unauthorized tool requested: {tool}"
        # 2. Context limits
        if candidate.context_policy.max_context_items > self.max_context_items_limit:
            return False, f"Context items ({candidate.context_policy.max_context_items}) exceeds envelope ceiling ({self.max_context_items_limit})"
        # 3. Execution attempts
        if candidate.execution_policy.max_attempts > self.max_attempts_limit:
            return False, f"Max attempts exceeds ceiling ({self.max_attempts_limit})"
        return True, "Candidate strictly complies with immutable PolicyEnvelope."
