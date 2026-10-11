from __future__ import annotations

import time
from datetime import UTC, datetime
from pathlib import Path

from services.runtime.genomics import (
    CheckStatus,
    DeterministicGenomicsValidator,
    ValidationPolicy,
    compute_sha256,
)
from services.runtime.harness.models import HarnessSpec, PolicyEnvelope

from .models import EvaluationResult, EvidenceReceipt, TestCaseResult

EVALUATOR_VERSION = "PCHE-ORACLE-v4.0.0"

class IndependentEvaluator:
    """
    Protected evaluation oracle for Proof-Carrying Harness Evolution (PCHE).
    Compares candidate harnesses against parents across incident fixtures,
    negative controls, held-out transfer sets, and policy envelopes.
    """

    def __init__(self, fixtures_dir: str | Path = "fixtures"):
        self.fixtures_dir = Path(fixtures_dir).resolve()
        self.fasta_path = self.fixtures_dir / "references" / "ref_synthetic_chr22.fasta"
        self.envelope = PolicyEnvelope()
        self._evaluator_hash = compute_sha256(self.fasta_path)

    @property
    def evaluator_digest(self) -> str:
        return self._evaluator_hash

    def evaluate(self, parent: HarnessSpec, candidate: HarnessSpec, run_id: str = "run-default") -> tuple[EvaluationResult, EvidenceReceipt]:
        start_time = time.perf_counter()
        test_results: list[TestCaseResult] = []

        # 1. Policy Envelope Compliance Check
        envelope_ok, envelope_reason = self.envelope.validate_candidate(candidate)
        test_results.append(
            TestCaseResult(
                test_id="policy_envelope_compliance",
                description="Verify candidate does not expand permissions or exceed safety envelope",
                category="envelope_check",
                parent_passed=True,
                candidate_passed=envelope_ok,
                details=envelope_reason,
            )
        )

        # 2. Run Test Cases
        cases = [
            {
                "id": "incident_target_ref_mismatch",
                "vcf": self.fixtures_dir / "invalid" / "ref_mismatch.vcf",
                "desc": "Detect REF allele mismatch at POS 105002",
                "category": "incident_target",
                "expected_incident_caught": True,
            },
            {
                "id": "negative_control_valid_snvs",
                "vcf": self.fixtures_dir / "valid" / "valid_snvs.vcf",
                "desc": "Preserve valid SNVs without false positive rejection",
                "category": "negative_control",
                "expected_incident_caught": False,
            },
            {
                "id": "negative_control_multiallelic",
                "vcf": self.fixtures_dir / "valid" / "multiallelic_snvs.vcf",
                "desc": "Preserve valid multiallelic variants without false positive rejection",
                "category": "negative_control",
                "expected_incident_caught": False,
            },
            {
                "id": "negative_control_indel",
                "vcf": self.fixtures_dir / "valid" / "normalization_indel.vcf",
                "desc": "Preserve valid indels without false positive rejection",
                "category": "negative_control",
                "expected_incident_caught": False,
            },
            {
                "id": "heldout_transfer_unseen_mismatch",
                "vcf": self.fixtures_dir / "heldout" / "unseen_mismatch.vcf",
                "desc": "Detect unobserved transfer mismatch at POS 110000 on held-out dataset",
                "category": "heldout_transfer",
                "expected_incident_caught": True,
            },
        ]

        parent_validator = DeterministicGenomicsValidator(
            policy=ValidationPolicy(
                require_reference_allele_check=parent.validation_policy.require_reference_allele_check,
                require_contig_compatibility=parent.validation_policy.require_contig_compatibility,
                require_normalization_check=parent.validation_policy.require_normalization_check,
                require_assembly_declaration=parent.validation_policy.require_assembly_declaration,
            )
        )

        candidate_validator = DeterministicGenomicsValidator(
            policy=ValidationPolicy(
                require_reference_allele_check=candidate.validation_policy.require_reference_allele_check,
                require_contig_compatibility=candidate.validation_policy.require_contig_compatibility,
                require_normalization_check=candidate.validation_policy.require_normalization_check,
                require_assembly_declaration=candidate.validation_policy.require_assembly_declaration,
            )
        )

        false_positive_count = 0
        neg_control_count = 0

        for case in cases:
            vcf_path = case["vcf"]
            p_report = parent_validator.validate(vcf_path, self.fasta_path)
            c_report = candidate_validator.validate(vcf_path, self.fasta_path)

            if case["expected_incident_caught"]:
                # The fixture is invalid; a good harness must detect the failure (overall_status == FAIL)
                p_pass = (p_report.overall_status == CheckStatus.FAIL)
                c_pass = (c_report.overall_status == CheckStatus.FAIL)
                details = f"Parent status: {p_report.overall_status.value}, Candidate status: {c_report.overall_status.value}"
            else:
                # Negative control: fixture is valid; harness must pass (overall_status == PASS)
                p_pass = (p_report.overall_status == CheckStatus.PASS)
                c_pass = (c_report.overall_status == CheckStatus.PASS)
                neg_control_count += 1
                if not c_pass:
                    false_positive_count += 1
                details = f"Parent valid: {p_pass}, Candidate valid: {c_pass}"

            test_results.append(
                TestCaseResult(
                    test_id=case["id"],
                    description=case["desc"],
                    category=case["category"],
                    parent_passed=p_pass,
                    candidate_passed=c_pass,
                    details=details,
                )
            )

        total_tests = len(test_results)
        candidate_passed = sum(1 for t in test_results if t.candidate_passed)
        parent_passed = sum(1 for t in test_results if t.parent_passed)
        fpr = (false_positive_count / neg_control_count) if neg_control_count > 0 else 0.0

        # Promotion Gate Logic:
        # 1. Envelope compliance must be True
        # 2. FPR must be 0.0 (no false positive inflation)
        # 3. Candidate score strictly >= Parent score
        # 4. Incident case must be caught by candidate
        incident_caught = any(
            t.test_id == "incident_target_ref_mismatch" and t.candidate_passed for t in test_results
        )
        heldout_caught = any(
            t.test_id == "heldout_transfer_unseen_mismatch" and t.candidate_passed for t in test_results
        )

        should_promote = (
            envelope_ok
            and fpr == 0.0
            and candidate_passed > parent_passed
            and incident_caught
            and heldout_caught
        )

        if should_promote:
            reason = (
                f"Candidate promoted: improved integrity score to {candidate_passed}/{total_tests} "
                f"(vs parent {parent_passed}/{total_tests}), zero false-positive inflation (FPR=0.0%), "
                f"successfully transferred to heldout case."
            )
        else:
            reason = (
                f"Candidate rejected: score {candidate_passed}/{total_tests} insufficient or "
                f"envelope/FPR constraint violated (envelope={envelope_ok}, FPR={fpr:.1%})."
            )

        runtime_ms = (time.perf_counter() - start_time) * 1000

        eval_result = EvaluationResult(
            candidate_version_id=candidate.version_id,
            parent_version_id=parent.version_id,
            score_numerator=candidate_passed,
            score_denominator=total_tests,
            parent_score_numerator=parent_passed,
            parent_score_denominator=total_tests,
            false_positive_rate=fpr,
            envelope_compliance=envelope_ok,
            promoted=should_promote,
            decision_reason=reason,
            test_results=test_results,
            runtime_ms=runtime_ms,
        )

        # Build Evidence Receipt
        timestamp = datetime.now(UTC).isoformat()
        receipt_id = f"receipt-{candidate.version_id}-{time.time_ns()}"
        input_hashes = [compute_sha256(c["vcf"]) for c in cases] + [self._evaluator_hash]
        receipt = EvidenceReceipt.create(
            receipt_id=receipt_id,
            run_id=run_id,
            eval_result=eval_result,
            parent_hash=parent.compute_spec_hash(),
            candidate_hash=candidate.compute_spec_hash(),
            evaluator_hash=self._evaluator_hash,
            input_hashes=input_hashes,
            timestamp=timestamp,
        )

        return eval_result, receipt
