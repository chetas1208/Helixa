from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from enum import Enum
from typing import Any, ClassVar
from uuid import uuid4

from pydantic import BaseModel, Field, model_validator


class CheckStatus(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    WARNING = "WARNING"
    INCONCLUSIVE = "INCONCLUSIVE"
    ERROR = "ERROR"

class Severity(str, Enum):
    INFO = "INFO"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"

class PipelinePhase(str, Enum):
    INGESTED = "INGESTED"
    PARSED = "PARSED"
    REFERENCE_RESOLVED = "REFERENCE_RESOLVED"
    STRUCTURE_CHECKED = "STRUCTURE_CHECKED"
    REF_CHECKED = "REF_CHECKED"
    NORMALIZATION_CHECKED = "NORMALIZATION_CHECKED"
    EVIDENCE_COMMITTED = "EVIDENCE_COMMITTED"

class ValidationPolicy(BaseModel):
    require_reference_allele_check: bool = True
    require_contig_compatibility: bool = True
    require_normalization_check: bool = True
    require_assembly_declaration: bool = True

class LocusCoordinate(BaseModel):
    chrom: str
    pos: int  # 1-based genomic position
    ref: str
    alt: list[str] = Field(default_factory=list)
    id: str | None = None

class DatasetManifest(BaseModel):
    dataset_id: str
    manifest_version: str = "1.0.0"
    file_type: str = "vcf"  # "vcf" or "vcf.gz"
    artifact_sha256: str
    byte_size: int
    declared_assembly: str | None = None  # e.g. "GRCh38"
    reference_checksum: str | None = None
    contigs: dict[str, int] = Field(default_factory=dict)  # contig_name -> length
    pseudonymous_sample_id: str | None = None
    is_synthetic: bool = True
    provenance: dict[str, Any] = Field(default_factory=dict)
    parser_version: str = "pysam 0.24.1"
    tool_version: str = "bcftools 1.24"
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    metadata: dict[str, Any] = Field(default_factory=dict)

class ReferenceManifest(BaseModel):
    reference_id: str
    assembly_name: str  # e.g. "GRCh38"
    fasta_filename: str
    fasta_sha256: str
    fai_sha256: str
    contigs: dict[str, int] = Field(default_factory=dict)
    aliases: dict[str, str] = Field(default_factory=dict)  # e.g. "22" -> "chr22"
    is_synthetic: bool = True
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class ArtifactRecord(BaseModel):
    artifact_id: str
    artifact_sha256: str
    dataset_id: str | None = None
    run_id: str | None = None
    filename: str
    file_format: str
    byte_size: int
    is_compressed: bool = False
    is_derived: bool = False
    parent_artifact_sha256: str | None = None
    storage_path: str
    storage_backend: str = "local_cas"
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    metadata: dict[str, Any] = Field(default_factory=dict)

class ValidationFinding(BaseModel):
    check_id: str
    rule_version: str = "1.0.0"
    severity: Severity = Severity.INFO
    status: CheckStatus = CheckStatus.PASS
    source_artifact_sha256: str = "UNKNOWN"
    artifact_id: str | None = None
    reference_sha256: str | None = None
    reference_artifact_id: str | None = None
    locus: LocusCoordinate | None = None
    observed_value: str | None = None
    expected_value: str | None = None
    message: str = ""
    confidence_basis: str = ""
    evidence_pointers: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)
    tool_name: str = "pysam / bcftools"
    tool_version: str = "0.24.1 / 1.24"
    run_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def sync_legacy_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "artifact_id" in data and "source_artifact_sha256" not in data:
                data["source_artifact_sha256"] = data["artifact_id"]
            elif "source_artifact_sha256" in data and "artifact_id" not in data:
                data["artifact_id"] = data["source_artifact_sha256"]
            if "reference_artifact_id" in data and "reference_sha256" not in data:
                data["reference_sha256"] = data["reference_artifact_id"]
            elif "reference_sha256" in data and "reference_artifact_id" not in data:
                data["reference_artifact_id"] = data["reference_sha256"]
            if "evidence_ids" in data and "evidence_pointers" not in data:
                data["evidence_pointers"] = data["evidence_ids"]
            elif "evidence_pointers" in data and "evidence_ids" not in data:
                data["evidence_ids"] = data["evidence_pointers"]
        return data

class ToolExecutionReceipt(BaseModel):
    receipt_id: str = Field(default_factory=lambda: f"rcpt-{uuid4().hex[:8]}")
    tool_name: str
    tool_version: str
    argv: list[str] = Field(default_factory=list)
    args: list[str] = Field(default_factory=list)
    exit_code: int = 0
    input_hashes: list[str] = Field(default_factory=list)
    output_artifact_hashes: list[str] = Field(default_factory=list)
    stdout_summary: str = ""
    stdout_snippet: str = ""
    stderr_summary: str = ""
    stderr_snippet: str = ""
    runtime_ms: float = 0.0
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    @model_validator(mode="before")
    @classmethod
    def sync_trace_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "args" in data and "argv" not in data:
                data["argv"] = data["args"]
            elif "argv" in data and "args" not in data:
                data["args"] = data["argv"]
            if "stdout_snippet" in data and "stdout_summary" not in data:
                data["stdout_summary"] = data["stdout_snippet"]
            elif "stdout_summary" in data and "stdout_snippet" not in data:
                data["stdout_snippet"] = data["stdout_summary"]
            if "stderr_snippet" in data and "stderr_summary" not in data:
                data["stderr_summary"] = data["stderr_snippet"]
            elif "stderr_summary" in data and "stderr_snippet" not in data:
                data["stderr_snippet"] = data["stderr_summary"]
        return data

class ValidationRun(BaseModel):
    run_id: str = Field(default_factory=lambda: f"run-{uuid4().hex[:12]}")
    dataset_id: str = "default_dataset"
    target_artifact_sha256: str = "UNKNOWN"
    artifact_sha256: str = "UNKNOWN"
    reference_id: str | None = None
    reference_sha256: str | None = None
    current_phase: PipelinePhase = PipelinePhase.INGESTED
    status: CheckStatus = CheckStatus.PASS
    overall_status: CheckStatus = CheckStatus.PASS
    findings: list[ValidationFinding] = Field(default_factory=list)
    tool_receipts: list[ToolExecutionReceipt] = Field(default_factory=list)
    tool_traces: list[ToolExecutionReceipt] = Field(default_factory=list)
    derived_artifact_records: list[ArtifactRecord] = Field(default_factory=list)
    evidence_receipt_id: str | None = None
    started_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    completed_at: str | None = None
    total_records: int = 0
    passed_checks: int = 0
    total_checks: int = 0
    runtime_ms: float = 0.0

    _ALIASES: ClassVar[dict[str, str]] = {
        "status": "overall_status",
        "overall_status": "status",
        "tool_receipts": "tool_traces",
        "tool_traces": "tool_receipts",
    }

    def __setattr__(self, name: str, value: Any) -> None:
        super().__setattr__(name, value)
        alias = self._ALIASES.get(name)
        if alias is not None:
            super().__setattr__(alias, value)

    @model_validator(mode="after")
    def share_tool_receipt_list(self) -> ValidationRun:
        if self.tool_receipts == self.tool_traces:
            self.tool_traces = self.tool_receipts
        return self

    @model_validator(mode="before")
    @classmethod
    def sync_report_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "overall_status" in data and "status" not in data:
                data["status"] = data["overall_status"]
            elif "status" in data and "overall_status" not in data:
                data["overall_status"] = data["status"]
            if "artifact_sha256" in data and "target_artifact_sha256" not in data:
                data["target_artifact_sha256"] = data["artifact_sha256"]
            elif "target_artifact_sha256" in data and "artifact_sha256" not in data:
                data["artifact_sha256"] = data["target_artifact_sha256"]
            if "tool_traces" in data and "tool_receipts" not in data:
                data["tool_receipts"] = data["tool_traces"]
            elif "tool_receipts" in data and "tool_traces" not in data:
                data["tool_traces"] = data["tool_receipts"]
        return data

class ScientificEvidenceReceipt(BaseModel):
    receipt_id: str
    receipt_digest: str
    run_id: str
    source_artifact_sha256: str
    declared_reference: str | None = None
    selected_fasta_sha256: str | None = None
    tool_chain: dict[str, str] = Field(default_factory=dict)
    findings_summary: dict[str, int] = Field(default_factory=dict)
    overall_status: CheckStatus
    derived_artifact_hashes: list[str] = Field(default_factory=list)
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    metadata: dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def create(
        cls,
        receipt_id: str,
        run_id: str,
        source_sha256: str,
        declared_ref: str | None,
        selected_fasta_sha256: str | None,
        tool_chain: dict[str, str],
        findings_summary: dict[str, int],
        overall_status: CheckStatus,
        derived_artifact_hashes: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ScientificEvidenceReceipt:
        payload = {
            "receipt_id": receipt_id,
            "run_id": run_id,
            "source_artifact_sha256": source_sha256,
            "declared_reference": declared_ref,
            "selected_fasta_sha256": selected_fasta_sha256,
            "tool_chain": tool_chain,
            "findings_summary": findings_summary,
            "overall_status": overall_status.value,
            "derived_artifact_hashes": derived_artifact_hashes or [],
        }
        canonical_str = json.dumps(payload, sort_keys=True)
        digest = hashlib.sha256(canonical_str.encode("utf-8")).hexdigest()

        return cls(
            receipt_id=receipt_id,
            receipt_digest=digest,
            run_id=run_id,
            source_artifact_sha256=source_sha256,
            declared_reference=declared_ref,
            selected_fasta_sha256=selected_fasta_sha256,
            tool_chain=tool_chain,
            findings_summary=findings_summary,
            overall_status=overall_status,
            derived_artifact_hashes=derived_artifact_hashes or [],
            metadata=metadata or {},
        )

# Backward compatibility aliases
LocusInfo = LocusCoordinate
Finding = ValidationFinding
ToolTrace = ToolExecutionReceipt
ValidationReport = ValidationRun
