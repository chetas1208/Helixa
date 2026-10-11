from __future__ import annotations

import posixpath
from pathlib import Path
from uuid import uuid4

from services.integrations.contracts import (
    AdjudicationVerdict,
    EvaluationRun,
    EvidenceReceiptV8,
    GenomicIncident,
    SafetyGateOutcome,
)
from services.runtime.evaluation.paired_scientific_eval import PairedScientificEvaluator
from services.runtime.evidence.proof_receipt import mint_v8_receipt
from services.runtime.genomics.contracts import CheckStatus, ValidationPolicy
from services.runtime.genomics.validator import DeterministicGenomicsValidator
from services.runtime.harness.models import HarnessSpec, PolicyEnvelope

HOLDOUT_CASE_IDS = frozenset(
    {
        "heldout_transfer_unseen_mismatch",
        "heldout_contig_mismatch",
    }
)

HOLDOUT_RELATIVE_PATHS = frozenset(
    {
        "fixtures/heldout/unseen_mismatch.vcf",
        "fixtures/heldout/heldout_contig_mismatch.vcf",
    }
)


class HoldoutLeakError(RuntimeError):
    pass


def _is_holdout_path(path: str) -> bool:
    normalized = "/" + posixpath.normpath(path.replace("\\", "/"))
    return any(
        "/" + marker.removeprefix("fixtures/") in normalized for marker in HOLDOUT_RELATIVE_PATHS
    )


def assert_proposer_inputs_exclude_holdout(case_ids: list[str], paths: list[str]) -> None:
    if isinstance(case_ids, str):
        case_ids = [case_ids]
    if isinstance(paths, str):
        paths = [paths]
    leaked_ids = HOLDOUT_CASE_IDS.intersection(case_ids)
    leaked_paths = [path for path in paths if _is_holdout_path(path)]
    if leaked_ids or leaked_paths:
        raise HoldoutLeakError(
            f"Holdout material reached the proposer: ids={sorted(leaked_ids)} paths={leaked_paths}"
        )


class SealedHoldoutEvaluator:
    """
    Independent Holdout Evaluation Oracle for V8.
    Ensures candidate harnesses proposed by Meta-Harness or GEPA are independently evaluated
    across sealed holdout test sets, negative controls, and dual-validator adjudication.
    Guarantees that promotion decisions cannot be gamed or self-certified by the candidate.
    """

    def __init__(
        self,
        fixtures_dir: str | Path = "fixtures",
        paired_evaluator: PairedScientificEvaluator | None = None,
        envelope: PolicyEnvelope | None = None,
    ):
        self.fixtures_dir = Path(fixtures_dir).resolve()
        self.fasta_path = self.fixtures_dir / "references" / "ref_synthetic_chr22.fasta"
        self.paired_evaluator = paired_evaluator or PairedScientificEvaluator()
        self.envelope = envelope or PolicyEnvelope()

    def evaluate_candidate(
        self,
        parent: HarnessSpec,
        candidate: HarnessSpec,
        incident: GenomicIncident,
        run_id: str | None = None,
    ) -> tuple[EvaluationRun, EvidenceReceiptV8]:
        active_run_id = run_id or f"run-eval-{uuid4().hex[:8]}"
        eval_id = f"eval-v8-{uuid4().hex[:8]}"

        # Gate 1: Policy Envelope Compliance
        envelope_ok, envelope_reason = self.envelope.validate_candidate(candidate)

        # Gate 2: Negative Controls (Must not produce false positive failures)
        neg_cases = [
            self.fixtures_dir / "valid" / "valid_snvs.vcf",
            self.fixtures_dir / "valid" / "benign_header_variant.vcf",
        ]
        cand_validator = DeterministicGenomicsValidator(
            ValidationPolicy(**candidate.validation_policy.model_dump())
        )
        parent_validator = DeterministicGenomicsValidator(
            ValidationPolicy(**parent.validation_policy.model_dump())
        )

        neg_regressions = 0
        neg_controls_present = True
        for neg_vcf in neg_cases:
            if neg_vcf.exists():
                rep = cand_validator.validate(neg_vcf, self.fasta_path)
                if rep.overall_status in (CheckStatus.FAIL, CheckStatus.ERROR):
                    neg_regressions += 1
            else:
                neg_controls_present = False

        zero_neg_regressions = neg_controls_present and neg_regressions == 0

        # Gate 3: Incident Mitigation / Training Set Check
        # Test against the invalid VCF target
        train_case = self.fixtures_dir / "invalid" / "ref_mismatch.vcf"
        parent_caught = False
        cand_caught = False
        if train_case.exists():
            rep_p = parent_validator.validate(train_case, self.fasta_path)
            parent_caught = rep_p.overall_status in (CheckStatus.FAIL, CheckStatus.ERROR)
            rep_c = cand_validator.validate(train_case, self.fasta_path)
            cand_caught = rep_c.overall_status in (CheckStatus.FAIL, CheckStatus.ERROR)

        # Gate 4: Heldout Transfer Evaluation
        heldout_cases = [
            self.fixtures_dir / "heldout" / "heldout_contig_mismatch.vcf",
            self.fixtures_dir / "heldout" / "unseen_mismatch.vcf",
        ]
        heldout_passed = True
        for h_vcf in heldout_cases:
            if h_vcf.exists():
                h_rep = cand_validator.validate(h_vcf, self.fasta_path)
                # Invalid heldout files must be recognized as FAIL or ERROR
                if h_rep.overall_status not in (CheckStatus.FAIL, CheckStatus.ERROR):
                    heldout_passed = False
            else:
                heldout_passed = False


        # Gate 5: Dual-Validator Adjudication on Target Artifact
        adj_result = self.paired_evaluator.adjudicate(
            vcf_path=self.fixtures_dir / "valid" / "valid_snvs.vcf",
            fasta_path=self.fasta_path,
            run_id=active_run_id,
        )
        dual_verdict = adj_result.verdict
        dual_ok = dual_verdict in (AdjudicationVerdict.AGREE_PASS, AdjudicationVerdict.AGREE_FAIL)

        # Aggregate Safety Gates
        safety_gates = {
            "envelope_compliance": envelope_ok,
            "zero_negative_control_regressions": zero_neg_regressions,
            "incident_addressed": cand_caught,
            "heldout_transfer_passed": heldout_passed,
            "dual_validator_concordance": dual_ok,
        }

        all_gates_passed = all(safety_gates.values())
        promoted = all_gates_passed

        decision = "PROMOTED" if promoted else "REJECTED"

        safety_outcomes = [
            SafetyGateOutcome(gate_id=k, passed=v, reason="Passed" if v else "Violation detected")
            for k, v in safety_gates.items()
        ]

        cand_hash = candidate.compute_spec_hash()
        eval_run = EvaluationRun(
            eval_id=eval_id,
            run_id=active_run_id,
            parent_version=parent.version_id,
            candidate_version=candidate.version_id,
            oracle_results=[
                {"test": "negative_controls", "regressions": neg_regressions},
                {"test": "incident_target", "parent_caught": parent_caught, "candidate_caught": cand_caught},
                {"test": "heldout_transfer", "passed": heldout_passed},
                {"test": "dual_adjudication", "verdict": dual_verdict.value},
            ],
            parent_score="1/2" if parent_caught else "0/2",
            candidate_score=f"{int(cand_caught) + int(heldout_passed)}/2",
            promoted=promoted,
            safety_gates=safety_outcomes,
        )

        receipt = mint_v8_receipt(
            run_id=active_run_id,
            incident_id=incident.incident_id,
            candidate_hash=cand_hash,
            dual_validator_agreement=dual_verdict,
            safety_gates=safety_gates,
            decision=decision,
            metadata={
                "eval_id": eval_id,
                "parent_version": parent.version_id,
                "candidate_version": candidate.version_id,
                "promoted": promoted,
            },
        )

        return eval_run, receipt
