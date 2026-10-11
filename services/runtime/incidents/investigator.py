from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from services.runtime.genomics.contracts import CheckStatus
from services.runtime.genomics.hasher import compute_sha256
from services.runtime.genomics.validator import DeterministicGenomicsValidator, ValidationPolicy
from services.runtime.optimization.reflection import FailureTraceReflector


@dataclass(frozen=True)
class CausalLink:
    stage: str
    action: str
    artifact_id_or_hash: str
    details: str


@dataclass
class IncidentRecord:
    incident_id: str
    run_id: str
    source_artifact_sha256: str
    reference_sha256: str
    harness_version_id: str
    error_signature: str
    causal_chain: list[CausalLink] = field(default_factory=list)
    status: str = "investigating"  # investigating, resolved, inconclusive, quarantined
    reproducibility_bundle: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class IncidentInvestigator:
    """
    Forensic incident investigation and replay engine (TraceCase-inspired).
    Reproduces genomic validation failures from content-addressed inputs,
    tracks the full causal trajectory, and generates sanitized reproducibility bundles.
    """

    def __init__(self, reflector: FailureTraceReflector | None = None):
        self.reflector = reflector or FailureTraceReflector()

    def investigate_run_failure(
        self,
        run_id: str,
        vcf_path: str | Path,
        fasta_path: str | Path,
        harness_version_id: str,
        policy: ValidationPolicy | None = None,
    ) -> IncidentRecord:
        vcf_file = Path(vcf_path).resolve()
        fasta_file = Path(fasta_path).resolve()

        vcf_hash = compute_sha256(vcf_file)
        fasta_hash = compute_sha256(fasta_file)
        incident_id = f"inc-{hashlib.sha256(f'{run_id}-{vcf_hash}'.encode()).hexdigest()[:12]}"

        record = IncidentRecord(
            incident_id=incident_id,
            run_id=run_id,
            source_artifact_sha256=vcf_hash,
            reference_sha256=fasta_hash,
            harness_version_id=harness_version_id,
            error_signature="",
        )

        record.causal_chain.append(
            CausalLink(
                stage="ingestion",
                action="inspect_source_artifact",
                artifact_id_or_hash=vcf_hash,
                details=f"Read {vcf_file.name} ({vcf_file.stat().st_size} bytes)",
            )
        )

        # Replay validation with active policy
        validator = DeterministicGenomicsValidator(policy=policy or ValidationPolicy())
        res = validator.validate(vcf_file, fasta_file)
        failing_findings = [f for f in res.findings if f.status != CheckStatus.PASS]

        record.causal_chain.append(
            CausalLink(
                stage="validation",
                action="run_deterministic_validator",
                artifact_id_or_hash=res.target_artifact_sha256 or "no_digest",
                details=f"Status: {res.overall_status.value}, Discrepancies: {len(failing_findings)}",
            )
        )

        if res.overall_status == CheckStatus.PASS:
            record.status = "resolved"
            record.error_signature = "NO_ERROR"
        else:
            first_disc = failing_findings[0].model_dump() if failing_findings else {}
            first_disc["details"] = first_disc.get("message", "")
            first_disc["code"] = first_disc.get("check_id", "")
            hypothesis = self.reflector.reflect_on_discrepancy(first_disc)
            record.error_signature = f"{hypothesis.failure_type}:{hypothesis.target_locus}"
            record.status = "quarantined" if hypothesis.failure_type != "UNKNOWN_INTEGRITY_FAILURE" else "inconclusive"

            record.causal_chain.append(
                CausalLink(
                    stage="reflection",
                    action="synthesize_failure_hypothesis",
                    artifact_id_or_hash=hypothesis.failure_type,
                    details=hypothesis.rationale,
                )
            )

        # Build sanitized reproducibility bundle
        record.reproducibility_bundle = {
            "incident_id": incident_id,
            "vcf_sha256": vcf_hash,
            "reference_sha256": fasta_hash,
            "harness_version": harness_version_id,
            "error_signature": record.error_signature,
            "causal_chain": [asdict(c) for c in record.causal_chain],
            "sanitized": True,
        }

        return record
