from __future__ import annotations

import hashlib
import json
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from .contracts import CheckStatus
from .hasher import compute_sha256
from .validator import DeterministicGenomicsValidator

ORACLE_VERSION = "DIAMOND-ORACLE-v5.0.0"

class OracleTestCase(BaseModel):
    test_id: str
    fixture_path: str
    expected_status: CheckStatus
    expected_check_ids: list[str] = Field(default_factory=list)
    description: str
    category: str  # "valid", "invalid", "heldout", "metamorphic"

class OracleCaseResult(BaseModel):
    test_id: str
    category: str
    passed: bool
    observed_status: CheckStatus
    expected_status: CheckStatus
    runtime_ms: float
    details: str = ""

class MetamorphicTestResult(BaseModel):
    property_name: str
    description: str
    satisfied: bool
    details: str
    source_sha256: str
    transformed_sha256: str | None = None

class OracleEvaluationReport(BaseModel):
    oracle_version: str = ORACLE_VERSION
    oracle_digest: str
    evaluated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    total_cases: int
    passed_cases: int
    score_percentage: float
    case_results: list[OracleCaseResult]
    metamorphic_results: list[MetamorphicTestResult]
    summary_digest: str

    @classmethod
    def create(
        cls,
        oracle_digest: str,
        case_results: list[OracleCaseResult],
        metamorphic_results: list[MetamorphicTestResult],
    ) -> OracleEvaluationReport:
        passed = sum(1 for r in case_results if r.passed) + sum(1 for m in metamorphic_results if m.satisfied)
        total = len(case_results) + len(metamorphic_results)
        score_pct = (passed / total * 100.0) if total > 0 else 0.0

        canonical_summary = json.dumps(
            {
                "oracle_version": ORACLE_VERSION,
                "oracle_digest": oracle_digest,
                "passed": passed,
                "total": total,
                "cases": [r.model_dump(mode="json", exclude={"runtime_ms"}) for r in case_results],
                "metamorphic": [m.model_dump(mode="json") for m in metamorphic_results],
            },
            sort_keys=True,
        )
        summary_digest = hashlib.sha256(canonical_summary.encode("utf-8")).hexdigest()

        return cls(
            oracle_digest=oracle_digest,
            total_cases=total,
            passed_cases=passed,
            score_percentage=score_pct,
            case_results=case_results,
            metamorphic_results=metamorphic_results,
            summary_digest=summary_digest,
        )


class IndependentGenomicsOracle:
    """
    Isolated, immutable ground-truth evaluation oracle for genomics validation pipelines.
    Runs frozen ground truth fixtures and metamorphic property invariants.
    Kept separate from agent-modifiable harness code to ensure tamper-proof evaluation.
    """

    FROZEN_SUITE: list[dict[str, Any]] = [
        {
            "id": "valid_snvs_oracle",
            "rel_path": "fixtures/valid/valid_snvs.vcf",
            "expected_status": CheckStatus.PASS,
            "expected_checks": ["reference_ref_allele_match"],
            "desc": "Valid SNVs matching reference FASTA perfectly",
            "category": "valid",
        },
        {
            "id": "valid_multiallelic_oracle",
            "rel_path": "fixtures/valid/multiallelic_snvs.vcf",
            "expected_status": CheckStatus.PASS,
            "expected_checks": ["multiallelic_site_check", "reference_ref_allele_match"],
            "desc": "Valid multi-allelic site",
            "category": "valid",
        },
        {
            "id": "valid_indels_oracle",
            "rel_path": "fixtures/valid/valid_indels.vcf",
            "expected_status": CheckStatus.PASS,
            "expected_checks": ["indel_normalization_check", "reference_ref_allele_match"],
            "desc": "Valid indels matching anchor bases in reference FASTA",
            "category": "valid",
        },
        {
            "id": "ref_mismatch_incident_oracle",
            "rel_path": "fixtures/invalid/ref_mismatch.vcf",
            "expected_status": CheckStatus.FAIL,
            "expected_checks": ["reference_ref_allele_match"],
            "desc": "Detection of REF allele mismatch at POS 105002",
            "category": "invalid",
        },
        {
            "id": "absent_assembly_oracle",
            "rel_path": "fixtures/invalid/absent_assembly.vcf",
            "expected_status": CheckStatus.WARNING,
            "expected_checks": ["declared_assembly_check"],
            "desc": "Absence of declared assembly emits warning",
            "category": "invalid",
        },
        {
            "id": "unsupported_contig_oracle",
            "rel_path": "fixtures/invalid/unsupported_contig.vcf",
            "expected_status": CheckStatus.FAIL,
            "expected_checks": ["contig_compatibility_check"],
            "desc": "Rejection of unsupported chromosome / contig name",
            "category": "invalid",
        },
        {
            "id": "length_mismatch_oracle",
            "rel_path": "fixtures/invalid/length_mismatch.vcf",
            "expected_status": CheckStatus.FAIL,
            "expected_checks": ["contig_length_boundary_check"],
            "desc": "Rejection of variant beyond contig length boundary",
            "category": "invalid",
        },
        {
            "id": "malformed_record_oracle",
            "rel_path": "fixtures/invalid/malformed_record.vcf",
            "expected_status": CheckStatus.ERROR,
            "expected_checks": ["vcf_syntax_check"],
            "desc": "Detection of syntactically unparseable record columns",
            "category": "invalid",
        },
        {
            "id": "heldout_unseen_mismatch_oracle",
            "rel_path": "fixtures/heldout/unseen_mismatch.vcf",
            "expected_status": CheckStatus.FAIL,
            "expected_checks": ["reference_ref_allele_match"],
            "desc": "Held-out generalization test for REF mismatch at POS 110000",
            "category": "heldout",
        },
        {
            "id": "heldout_contig_mismatch_oracle",
            "rel_path": "fixtures/heldout/heldout_contig_mismatch.vcf",
            "expected_status": CheckStatus.FAIL,
            "expected_checks": ["contig_compatibility_check"],
            "desc": "Held-out generalization test for unseen unsupported contig",
            "category": "heldout",
        },
    ]

    def __init__(self, base_dir: Path | str | None = None):
        self.base_dir = Path(base_dir).resolve() if base_dir else Path.cwd()
        self.fasta_path = self.base_dir / "fixtures" / "references" / "ref_synthetic_chr22.fasta"
        self._oracle_digest = self._calculate_oracle_digest()

    def _calculate_oracle_digest(self) -> str:
        suite_json = json.dumps(self.FROZEN_SUITE, sort_keys=True)
        fasta_hash = compute_sha256(self.fasta_path) if self.fasta_path.exists() else "NO_FASTA"
        combined = f"{ORACLE_VERSION}:{suite_json}:{fasta_hash}"
        return hashlib.sha256(combined.encode("utf-8")).hexdigest()

    @property
    def oracle_digest(self) -> str:
        return self._oracle_digest

    def evaluate(self, validator: DeterministicGenomicsValidator) -> OracleEvaluationReport:
        case_results: list[OracleCaseResult] = []

        for case in self.FROZEN_SUITE:
            vcf_path = self.base_dir / case["rel_path"]
            start_t = time.perf_counter()
            if not vcf_path.exists():
                case_results.append(
                    OracleCaseResult(
                        test_id=case["id"],
                        category=case["category"],
                        passed=False,
                        observed_status=CheckStatus.ERROR,
                        expected_status=case["expected_status"],
                        runtime_ms=0.0,
                        details=f"Missing fixture file: {vcf_path}",
                    )
                )
                continue

            report = validator.validate(vcf_path, self.fasta_path)
            runtime_ms = (time.perf_counter() - start_t) * 1000

            status_matches = (report.overall_status == case["expected_status"])
            checks_present = all(
                any(f.check_id == exp_chk and f.status == case["expected_status"] for f in report.findings)
                for exp_chk in case["expected_checks"]
            )
            passed = status_matches and checks_present
            details = (
                f"Observed: {report.overall_status.value}, Expected: {case['expected_status'].value}. "
                f"Checks checked: {case['expected_checks']}"
            )

            case_results.append(
                OracleCaseResult(
                    test_id=case["id"],
                    category=case["category"],
                    passed=passed,
                    observed_status=report.overall_status,
                    expected_status=case["expected_status"],
                    runtime_ms=runtime_ms,
                    details=details,
                )
            )

        # Run metamorphic property checks
        metamorphic_results = self.run_metamorphic_suite(validator)

        return OracleEvaluationReport.create(
            oracle_digest=self._oracle_digest,
            case_results=case_results,
            metamorphic_results=metamorphic_results,
        )

    def run_metamorphic_suite(self, validator: DeterministicGenomicsValidator) -> list[MetamorphicTestResult]:
        results: list[MetamorphicTestResult] = []

        # Property 1: Benign header invariance
        results.append(self._test_benign_header_invariance(validator))

        # Property 2: Single-base REF mutation sensitivity
        results.append(self._test_ref_mutation_sensitivity(validator))

        # Property 3: Read-only byte immutability
        results.append(self._test_byte_immutability(validator))

        return results

    def _test_benign_header_invariance(self, validator: DeterministicGenomicsValidator) -> MetamorphicTestResult:
        base_vcf = self.base_dir / "fixtures" / "valid" / "valid_snvs.vcf"
        benign_vcf = self.base_dir / "fixtures" / "valid" / "benign_header_variant.vcf"

        if not base_vcf.exists() or not benign_vcf.exists():
            return MetamorphicTestResult(
                property_name="benign_header_invariance",
                description="Validator status must be invariant under harmless header comment additions",
                satisfied=False,
                details="Fixtures not found",
                source_sha256="UNKNOWN",
            )

        report_base = validator.validate(base_vcf, self.fasta_path)
        report_benign = validator.validate(benign_vcf, self.fasta_path)

        satisfied = (report_base.overall_status == report_benign.overall_status == CheckStatus.PASS)
        details = (
            f"Base status: {report_base.overall_status.value}, "
            f"Benign transformed status: {report_benign.overall_status.value}"
        )

        return MetamorphicTestResult(
            property_name="benign_header_invariance",
            description="Validator status must be invariant under harmless header comment additions",
            satisfied=satisfied,
            details=details,
            source_sha256=compute_sha256(base_vcf),
            transformed_sha256=compute_sha256(benign_vcf),
        )

    def _test_ref_mutation_sensitivity(self, validator: DeterministicGenomicsValidator) -> MetamorphicTestResult:
        base_vcf = self.base_dir / "fixtures" / "valid" / "valid_snvs.vcf"
        if not base_vcf.exists():
            return MetamorphicTestResult(
                property_name="ref_mutation_sensitivity",
                description="Perturbing declared REF allele must predictably flip PASS to FAIL",
                satisfied=False,
                details="Base valid_snvs.vcf not found",
                source_sha256="UNKNOWN",
            )

        with tempfile.TemporaryDirectory() as tmp_dir:
            mutated_vcf = Path(tmp_dir) / "mutated_ref.vcf"
            content = base_vcf.read_text(encoding="utf-8")
            # In valid_snvs.vcf, line is: chr22\t10001\trs101\tA\tG
            # Mutate REF from A to T (which mismatches FASTA base A)
            mutated_content = content.replace("10001\trs101\tA\tG", "10001\trs101\tT\tG")
            mutated_vcf.write_text(mutated_content, encoding="utf-8")

            report_mutated = validator.validate(mutated_vcf, self.fasta_path)
            satisfied = (report_mutated.overall_status == CheckStatus.FAIL) and any(
                f.check_id == "reference_ref_allele_match" and f.status == CheckStatus.FAIL
                for f in report_mutated.findings
            )
            details = (
                f"Mutated VCF status: {report_mutated.overall_status.value}. "
                f"Caught mismatch finding: {satisfied}"
            )

            return MetamorphicTestResult(
                property_name="ref_mutation_sensitivity",
                description="Perturbing declared REF allele must predictably flip PASS to FAIL",
                satisfied=satisfied,
                details=details,
                source_sha256=compute_sha256(base_vcf),
                transformed_sha256=compute_sha256(mutated_vcf),
            )

    def _test_byte_immutability(self, validator: DeterministicGenomicsValidator) -> MetamorphicTestResult:
        base_vcf = self.base_dir / "fixtures" / "invalid" / "ref_mismatch.vcf"
        if not base_vcf.exists():
            return MetamorphicTestResult(
                property_name="byte_immutability",
                description="Validator must never modify original file bytes during execution",
                satisfied=False,
                details="ref_mismatch.vcf not found",
                source_sha256="UNKNOWN",
            )

        pre_hash = compute_sha256(base_vcf)
        validator.validate(base_vcf, self.fasta_path)
        post_hash = compute_sha256(base_vcf)

        satisfied = (pre_hash == post_hash)
        details = f"Pre-validation SHA-256: {pre_hash}, Post-validation SHA-256: {post_hash}"

        return MetamorphicTestResult(
            property_name="byte_immutability",
            description="Validator must never modify original file bytes during execution",
            satisfied=satisfied,
            details=details,
            source_sha256=pre_hash,
            transformed_sha256=post_hash,
        )
