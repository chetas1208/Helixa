from __future__ import annotations

from pathlib import Path

import pysam

from services.runtime.genomics import CheckStatus, DeterministicGenomicsValidator, ValidationPolicy
from services.runtime.harness.baseline import get_baseline_harness
from services.runtime.harness.models import HarnessStatus, PolicyEnvelope
from services.runtime.optimization import (
    BudgetTracker,
    FailureTraceReflector,
    OptimizationBudget,
    ReflectiveHarnessOptimizer,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
FASTA_PATH = REPO_ROOT / "fixtures" / "references" / "ref_synthetic_chr22.fasta"

HEADER = (
    "##fileformat=VCFv4.2\n"
    "##reference=GRCh38\n"
    "##contig=<ID=chr22,length=117500>\n"
    "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\n"
)


def _real_failing_finding(tmp_path: Path, record: str) -> dict:
    vcf = tmp_path / "case.vcf"
    vcf.write_text(HEADER + record)
    validator = DeterministicGenomicsValidator(policy=ValidationPolicy(require_reference_allele_check=True))
    report = validator.validate(vcf, FASTA_PATH)
    failing = [f for f in report.findings if f.status != CheckStatus.PASS]
    assert failing
    finding = failing[0].model_dump(mode="json")
    # Same adaptation the incident investigator applies before reflecting.
    finding["details"] = finding.get("message", "")
    finding["code"] = finding.get("check_id", "")
    return finding


def test_real_coordinate_overflow_finding_is_not_diagnosed_as_missing_contig(tmp_path):
    finding = _real_failing_finding(tmp_path, "chr22\t999999\t.\tA\tG\t.\t.\t.\n")
    assert finding["check_id"] == "contig_length_boundary_check"

    hypothesis = FailureTraceReflector().reflect_on_discrepancy(finding)

    assert hypothesis.failure_type == "COORDINATE_OVERFLOW"
    assert hypothesis.recommended_policy_action == "enforce_boundary_guards"


def test_real_finding_locus_is_read_from_nested_locus(tmp_path):
    with pysam.FastaFile(str(FASTA_PATH)) as fasta:
        wrong = "A" if fasta.fetch("chr22", 10000, 10001).upper() != "A" else "C"
    finding = _real_failing_finding(tmp_path, f"chr22\t10001\t.\t{wrong}\tG\t.\t.\t.\n")
    assert finding["check_id"] == "reference_ref_allele_match"

    hypothesis = FailureTraceReflector().reflect_on_discrepancy(finding)

    assert hypothesis.failure_type == "REF_ALLELE_MISMATCH"
    assert hypothesis.target_locus == "chr22:10001"


def test_out_of_bounds_detail_match_is_case_insensitive():
    hypothesis = FailureTraceReflector().reflect_on_discrepancy(
        {"code": "SOMETHING", "chrom": "chr22", "pos": 5, "details": "Position Out Of Bounds"}
    )
    assert hypothesis.failure_type == "COORDINATE_OVERFLOW"


def test_reflector_tolerates_null_details():
    hypothesis = FailureTraceReflector().reflect_on_discrepancy({"code": "PARSE_ERROR", "details": None})
    assert hypothesis.failure_type == "MALFORMED_VCF"


def test_proposed_candidate_spec_records_lineage_and_candidate_status():
    parent = get_baseline_harness()
    candidates = ReflectiveHarnessOptimizer().propose_candidates(
        parent, {"code": "REF_MISMATCH", "details": "REF allele does not match"}
    )

    assert len(candidates) == 2
    for cand in candidates:
        assert cand.harness_spec.parent_version_id == parent.version_id
        assert cand.harness_spec.status == HarnessStatus.CANDIDATE
        assert cand.harness_spec.version_id == cand.candidate_id


def test_optimizer_does_not_mutate_parent_and_is_deterministic():
    parent = get_baseline_harness()
    before = parent.model_dump()
    finding = {"code": "REF_MISMATCH", "details": "REF allele does not match"}
    first = ReflectiveHarnessOptimizer().propose_candidates(parent, finding)
    second = ReflectiveHarnessOptimizer().propose_candidates(parent, finding)

    assert parent.model_dump() == before
    assert [c.canonical_hash for c in first] == [c.canonical_hash for c in second]
    envelope = PolicyEnvelope()
    assert all(envelope.validate_candidate(c.harness_spec)[0] for c in first)


def test_optimizer_respects_proposal_budget():
    parent = get_baseline_harness()
    finding = {"code": "REF_MISMATCH", "details": "REF allele does not match"}
    optimizer = ReflectiveHarnessOptimizer()

    assert optimizer.propose_candidates(parent, finding, OptimizationBudget(max_proposals=0)) == []
    assert len(optimizer.propose_candidates(parent, finding, OptimizationBudget(max_proposals=1))) == 1
    assert len(optimizer.propose_candidates(parent, finding, OptimizationBudget(max_proposals=5))) == 2


def test_budget_tracker_stop_reason_only_set_when_exceeded():
    tracker = BudgetTracker(budget=OptimizationBudget(max_proposals=1))
    assert tracker.can_propose()
    assert tracker.stopped_reason is None
    tracker.record_proposal()
    assert not tracker.can_propose()
    assert "max_proposals" in tracker.stopped_reason
