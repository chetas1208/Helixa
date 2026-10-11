from __future__ import annotations

import time
from pathlib import Path
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field

from services.integrations.contracts import AdjudicationVerdict, GenomicIncident
from services.integrations.ebi_vcf.validator import EbiValidationReport, EbiVcfValidator
from services.runtime.genomics.contracts import CheckStatus, ValidationPolicy, ValidationReport
from services.runtime.genomics.hasher import compute_sha256
from services.runtime.genomics.validator import DeterministicGenomicsValidator


class DualAdjudicationResult(BaseModel):
    verdict: AdjudicationVerdict
    native_status: str
    ebi_status: str
    dataset_sha256: str
    reference_sha256: str | None = None
    incident: GenomicIncident | None = None
    divergence_summary: str = ""
    diverging_checks: list[dict[str, Any]] = Field(default_factory=list)
    native_report: dict[str, Any] = Field(default_factory=dict)
    ebi_report: dict[str, Any] = Field(default_factory=dict)
    runtime_ms: float = 0.0

    @property
    def is_concordant(self) -> bool:
        return self.verdict in (AdjudicationVerdict.AGREE_PASS, AdjudicationVerdict.AGREE_FAIL)

    @property
    def requires_quarantine(self) -> bool:
        return self.verdict in (AdjudicationVerdict.DISAGREE, AdjudicationVerdict.TOOL_ERROR)


class PairedScientificEvaluator:
    """
    Dual-validator adjudication layer uniting native pysam/bcftools deterministic checks
    with EBI VCF specification and assembly validation binaries.
    Detects cross-engine divergence, isolates conflicting checks, and issues quarantined
    GenomicIncident records on non-concordance.
    """

    def __init__(
        self,
        native_validator: DeterministicGenomicsValidator | None = None,
        ebi_validator: EbiVcfValidator | None = None,
        policy: ValidationPolicy | None = None,
    ):
        self.policy = policy or ValidationPolicy()
        self.native_validator = native_validator or DeterministicGenomicsValidator(self.policy)
        self.ebi_validator = ebi_validator or EbiVcfValidator()

    def adjudicate(
        self,
        vcf_path: str | Path,
        fasta_path: str | Path | None = None,
        run_id: str | None = None,
        artifact_id: str = "target_vcf",
    ) -> DualAdjudicationResult:
        start_time = time.perf_counter()
        vcf_file = Path(vcf_path).resolve()
        active_run_id = run_id or f"run-adj-{uuid4().hex[:8]}"

        if not vcf_file.is_file():
            vcf_hash = "MISSING"
            fasta_hash = "NONE"
            incident = GenomicIncident(
                incident_id=f"inc-missing-{uuid4().hex[:8]}",
                run_id=active_run_id,
                dataset_sha256=vcf_hash,
                reference_sha256=fasta_hash,
                failing_check="file_existence_check",
                error_signature=f"Target VCF not found at {vcf_file}",
                disagreement_detected=False,
                status="QUARANTINED",
            )
            return DualAdjudicationResult(
                verdict=AdjudicationVerdict.TOOL_ERROR,
                native_status="ERROR",
                ebi_status="ERROR",
                dataset_sha256=vcf_hash,
                reference_sha256=fasta_hash,
                incident=incident,
                divergence_summary=f"VCF file not found at {vcf_file}",
                runtime_ms=(time.perf_counter() - start_time) * 1000,
            )

        vcf_hash = compute_sha256(vcf_file)
        fasta_hash = compute_sha256(fasta_path) if fasta_path and Path(fasta_path).is_file() else None

        # 1. Native pysam/bcftools validation
        native_report: ValidationReport = self.native_validator.validate(
            vcf_path=vcf_file,
            fasta_path=fasta_path,
            artifact_id=artifact_id,
        )

        # 2. EBI external binary validation
        ebi_report: EbiValidationReport = self.ebi_validator.validate(
            vcf_path=vcf_file,
            fasta_path=fasta_path,
        )

        # 3. Adjudication Analysis
        native_stat = native_report.overall_status.value if hasattr(native_report.overall_status, "value") else str(native_report.overall_status)
        ebi_stat = ebi_report.overall_status

        native_is_pass = native_stat in (CheckStatus.PASS.value, CheckStatus.WARNING.value)
        native_is_fail = native_stat == CheckStatus.FAIL.value
        native_is_error = native_stat == CheckStatus.ERROR.value

        ebi_is_pass = ebi_stat == "PASS"
        ebi_is_fail = ebi_stat == "FAIL"
        ebi_is_error = ebi_stat == "ERROR"

        verdict: AdjudicationVerdict
        incident: GenomicIncident | None = None
        divergence_summary = ""
        diverging_checks: list[dict[str, Any]] = []

        if native_is_error or ebi_is_error:
            verdict = AdjudicationVerdict.TOOL_ERROR
            divergence_summary = f"Tool execution failure detected: native={native_stat}, ebi={ebi_stat}"
            incident = GenomicIncident(
                incident_id=f"inc-toolerr-{uuid4().hex[:8]}",
                run_id=active_run_id,
                dataset_sha256=vcf_hash,
                reference_sha256=fasta_hash or "NONE",
                failing_check="tool_execution_integrity",
                error_signature=divergence_summary,
                disagreement_detected=False,
                status="QUARANTINED",
            )
        elif native_is_pass and ebi_is_pass:
            verdict = AdjudicationVerdict.AGREE_PASS
            divergence_summary = "Both native and EBI validators concordantly confirmed dataset validity."
        elif native_is_fail and ebi_is_fail:
            verdict = AdjudicationVerdict.AGREE_FAIL
            divergence_summary = "Both native and EBI validators concordantly detected specification violations."
        elif (native_is_pass and ebi_is_fail) or (native_is_fail and ebi_is_pass):
            verdict = AdjudicationVerdict.DISAGREE
            divergence_summary = (
                f"Cross-validator divergence: Native evaluated {native_stat} while EBI evaluated {ebi_stat}."
            )
            # Collect conflicting checks
            native_failures = [
                {
                    "check_id": finding.check_id,
                    "status": finding.status.value if hasattr(finding.status, "value") else str(finding.status),
                    "message": finding.message,
                    "locus": _locus_text(finding.locus),
                }
                for finding in native_report.findings
                if finding.status in (CheckStatus.FAIL, CheckStatus.ERROR)
            ]
            ebi_failures = [
                {"check_id": c.check_id, "status": c.status, "message": c.message, "locus": c.locus, "details": c.details}
                for c in ebi_report.checks
                if c.status in ("FAIL", "ERROR")
            ]
            diverging_checks = [
                {"validator": "native_pysam", "findings": native_failures},
                {"validator": "ebi_validator", "findings": ebi_failures},
            ]

            incident = GenomicIncident(
                incident_id=f"inc-disagree-{uuid4().hex[:8]}",
                run_id=active_run_id,
                dataset_sha256=vcf_hash,
                reference_sha256=fasta_hash or "NONE",
                failing_check=f"dual_validator_divergence_{native_stat}_vs_{ebi_stat}",
                error_signature=divergence_summary,
                disagreement_detected=True,
                status="QUARANTINED",
            )
        else:
            verdict = AdjudicationVerdict.INCONCLUSIVE
            divergence_summary = f"Inconclusive verification state: native={native_stat}, ebi={ebi_stat}"

        if fasta_hash is None and verdict == AdjudicationVerdict.AGREE_PASS:
            verdict = AdjudicationVerdict.INCONCLUSIVE
            divergence_summary = (
                "Syntax checks agreed. REF allele agreement is INCONCLUSIVE because no usable FASTA was supplied. "
                "Header text is not proof of genome build identity."
            )
        elif ebi_report.assembly_valid is not True and verdict == AdjudicationVerdict.AGREE_PASS:
            verdict = AdjudicationVerdict.INCONCLUSIVE
            divergence_summary = (
                "Native and EBI syntax checks passed, but the EBI assembly checker did not confirm REF alleles "
                "against the FASTA. REF allele agreement is INCONCLUSIVE."
            )

        return DualAdjudicationResult(
            verdict=verdict,
            native_status=native_stat,
            ebi_status=ebi_stat,
            dataset_sha256=vcf_hash,
            reference_sha256=fasta_hash,
            incident=incident,
            divergence_summary=divergence_summary,
            diverging_checks=diverging_checks,
            native_report=native_report.model_dump(mode="json"),
            ebi_report=ebi_report.model_dump(mode="json"),
            runtime_ms=(time.perf_counter() - start_time) * 1000,
        )


def _locus_text(locus: Any) -> str | None:
    if locus is None:
        return None
    if isinstance(locus, str):
        return locus
    chrom = getattr(locus, "chrom", None)
    pos = getattr(locus, "pos", None)
    if chrom is not None and pos is not None:
        return f"{chrom}:{pos}"
    return str(locus)
