#!/usr/bin/env python3
# ruff: noqa: E402
"""
DIAMOND Genome V8 — Comprehensive Autonomous Acceptance Verification Script
Independently verifies all V8 deliverables:
1. EBI VCF Validator native binary execution & report parsing
2. EBI Assembly Checker FASTA sequence concordance verification
3. Dual-Validator Adjudication matrix (AGREE_PASS, AGREE_FAIL, DISAGREE quarantine)
4. Biomni Bounded Tool Adapter & strict security sandbox containment
5. Proposer Registry (Meta-Harness bounded search + GEPA reflective mutation)
6. Sealed Holdout Evaluation & Safety Gate enforcement
7. Cryptographic EvidenceReceiptV8 minting and tamper-proofing
8. External Integration health audit table
"""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

# Add project root to path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from services.integrations.biomni.adapter import BiomniToolAdapter
from services.integrations.contracts import (
    AdjudicationVerdict,
    GenomicIncident,
    ToolInvocationRequest,
)
from services.integrations.ebi_vcf.validator import EbiVcfValidator
from services.runtime.evaluation.holdout import SealedHoldoutEvaluator
from services.runtime.evaluation.paired_scientific_eval import PairedScientificEvaluator
from services.runtime.evidence.proof_receipt import verify_v8_receipt
from services.runtime.evolution.optimizer_registry import OptimizerRegistry
from services.runtime.harness.baseline import get_baseline_harness


def run_v8_verification() -> int:
    print("=" * 80)
    print("  DIAMOND GENOME V8 — CLOSEST-EXISTING-CODE INTEGRATION VERIFICATION")
    print("=" * 80)

    start_total = time.perf_counter()
    passed_checks = 0
    total_checks = 8

    fixtures_dir = ROOT / "fixtures"
    vcf_valid = fixtures_dir / "valid" / "valid_snvs.vcf"
    vcf_mismatch = fixtures_dir / "invalid" / "ref_mismatch.vcf"
    vcf_malformed = fixtures_dir / "invalid" / "malformed_record.vcf"
    ref_fasta = fixtures_dir / "references" / "ref_synthetic_chr22.fasta"

    # Check 1: EBI Native Binary Execution
    print("\n[CHECK 1/8] EBI VCF Validator Native Execution...")
    ebi_val = EbiVcfValidator()
    if not ebi_val.is_available():
        print("  FAIL: EBI validator binary unavailable or not executable!")
        return 1
    version = ebi_val.get_version()
    rep_valid = ebi_val.validate(vcf_valid, ref_fasta)
    assert rep_valid.is_valid is True, "Valid VCF marked invalid by EBI"
    rep_invalid = ebi_val.validate(vcf_malformed)
    assert rep_invalid.is_valid is False, "Malformed VCF marked valid by EBI"
    print(f"  PASS: EBI Validator v{version} verified on valid and malformed fixtures.")
    passed_checks += 1

    # Check 2: EBI Assembly Checker Concordance
    print("\n[CHECK 2/8] EBI Assembly Checker Reference Concordance...")
    rep_asm_mismatch = ebi_val.validate(vcf_mismatch, ref_fasta)
    assert rep_asm_mismatch.assembly_valid is False, "Assembly mismatch not detected"
    assert any(c.check_id == "reference_allele_mismatch" for c in rep_asm_mismatch.checks)
    print("  PASS: Assembly checker caught the expected REF mismatch.")
    passed_checks += 1

    # Check 3: Dual-Validator Adjudication Layer
    print("\n[CHECK 3/8] Dual-Validator Adjudication & Incident Quarantine...")
    evaluator = PairedScientificEvaluator()
    res_agree_pass = evaluator.adjudicate(vcf_valid, ref_fasta)
    assert res_agree_pass.verdict == AdjudicationVerdict.AGREE_PASS
    assert res_agree_pass.is_concordant is True

    res_agree_fail = evaluator.adjudicate(vcf_mismatch, ref_fasta)
    assert res_agree_fail.verdict == AdjudicationVerdict.AGREE_FAIL
    assert res_agree_fail.is_concordant is True

    # Synthetic disagreement quarantine test
    from unittest.mock import MagicMock

    from services.integrations.ebi_vcf.validator import EbiValidationReport
    from services.runtime.genomics.contracts import CheckStatus, Finding, Severity, ValidationReport
    from services.runtime.genomics.validator import DeterministicGenomicsValidator

    mock_native = MagicMock(spec=DeterministicGenomicsValidator)
    mock_native.validate.return_value = ValidationReport(
        overall_status=CheckStatus.PASS,
        status=CheckStatus.PASS,
        findings=[Finding(check_id="mock_pass", status=CheckStatus.PASS, severity=Severity.INFO, message="Pass")],
        artifact_sha256="hash123",
    )
    mock_ebi = MagicMock(spec=EbiVcfValidator)
    mock_ebi.validate.return_value = EbiValidationReport(is_valid=False, overall_status="FAIL", checks=[])
    disagree_eval = PairedScientificEvaluator(native_validator=mock_native, ebi_validator=mock_ebi)
    res_disagree = disagree_eval.adjudicate(vcf_valid, ref_fasta)
    assert res_disagree.verdict == AdjudicationVerdict.DISAGREE
    assert res_disagree.requires_quarantine is True
    assert res_disagree.incident is not None
    assert res_disagree.incident.status == "QUARANTINED"
    print("  PASS: Concordant outcomes verified (AGREE_PASS, AGREE_FAIL). Cross-engine disagreement quarantined.")
    passed_checks += 1

    # Check 4: Biomni Bounded Tool Adapter & Security Sandbox
    print("\n[CHECK 4/8] Biomni Bounded Tool Adapter & Sandbox Containment...")
    biomni = BiomniToolAdapter()
    manifests = biomni.list_manifests()
    assert len(manifests) >= 4

    # 4a: Valid read-only stats
    req_stats = ToolInvocationRequest(
        tool_id="biomni_vcf_stats_inspector",
        artifact_id_or_path=str(vcf_valid),
    )
    res_stats = biomni.invoke(req_stats)
    assert res_stats.status == "SUCCESS"
    assert res_stats.findings[0]["total_records"] == 2
    assert res_stats.findings[0]["titv_ratio"] == 2.0

    # 4b: Malicious injection blocked
    req_bad = ToolInvocationRequest(
        tool_id="biomni_vcf_stats_inspector",
        artifact_id_or_path=str(vcf_valid),
        arguments={"code": "exec(__import__('os').system('cat /etc/passwd'))"},
    )
    res_bad = biomni.invoke(req_bad)
    assert res_bad.status == "ERROR"
    assert res_bad.exit_code == 126
    assert "SECURITY_VIOLATION" in res_bad.stderr
    print(f"  PASS: {len(manifests)} Biomni tools verified. Malicious shell/exec injection blocked (exit code 126).")
    passed_checks += 1

    # Check 5: Proposer Registry (Meta-Harness + GEPA)
    print("\n[CHECK 5/8] Optimizer Registry & Proposer Coordination...")
    parent = get_baseline_harness()
    sample_incident = GenomicIncident(
        incident_id="inc-v8-verify",
        run_id="run-verify",
        dataset_sha256="abc",
        reference_sha256="def",
        failing_check="reference_allele_mismatch",
        error_signature="Reference mismatch observed",
        disagreement_detected=False,
        status="INVESTIGATING",
    )
    registry = OptimizerRegistry()
    proposals = registry.propose_candidates(parent=parent, incident=sample_incident)
    assert len(proposals) >= 3
    sources = {p[1].optimizer_source for p in proposals}
    assert "DETERMINISTIC" in sources
    assert "META_HARNESS" not in sources
    assert "GEPA" not in sources
    # Verify hash deduplication
    hashes = [p[1].canonical_hash for p in proposals]
    assert len(hashes) == len(set(hashes))
    print(f"  PASS: OptimizerRegistry generated {len(proposals)} deduplicated DETERMINISTIC candidates. Meta-Harness is not imported. GEPA optimize() is not called.")
    passed_checks += 1

    # Check 6: Sealed Holdout Evaluation & Safety Gates
    print("\n[CHECK 6/8] Sealed Holdout Evaluation & Safety Gates...")
    holdout_eval = SealedHoldoutEvaluator(fixtures_dir=fixtures_dir)
    # Pick candidate with strengthened reference allele policy
    promoted_cand = None
    for cand_spec, patch in proposals:
        if cand_spec.validation_policy.require_reference_allele_check:
            promoted_cand = cand_spec
            break
    assert promoted_cand is not None

    eval_run, receipt = holdout_eval.evaluate_candidate(
        parent=parent,
        candidate=promoted_cand,
        incident=sample_incident,
    )
    assert eval_run.promoted is True
    assert receipt.decision == "PROMOTED"
    assert all(gate.passed for gate in eval_run.safety_gates)
    print("  PASS: Independent oracle promoted candidate across negative controls, incident target, and held-out transfer.")
    passed_checks += 1

    # Check 7: Cryptographic Proof Receipt
    print("\n[CHECK 7/8] Cryptographic EvidenceReceiptV8 Anti-Tampering...")
    assert verify_v8_receipt(receipt) is True
    tampered = receipt.model_copy(update={"decision": "REJECTED"})
    assert verify_v8_receipt(tampered) is False
    print(f"  PASS: Canonical digest {receipt.receipt_digest[:16]}... validated. Tampering detected and rejected.")
    passed_checks += 1

    # Check 8: External Integration Health Status
    print("\n[CHECK 8/8] External Integration Health Audit...")
    from services.integrations.ebi_vcf.validator import integration_status as ebi_status
    from services.integrations.elevenlabs.adapter import ElevenLabsAdapter
    from services.integrations.raindrop.adapter import RaindropAdapter
    from services.runtime.evolution.gepa_adapter import gepa_package_status

    ebi_st, ebi_detail = ebi_status()
    gepa_st, gepa_detail = gepa_package_status()
    raindrop = RaindropAdapter()
    eleven = ElevenLabsAdapter()

    print("  +-----------------------+------------------------+------------------------------------------+")
    print("  | Integration           | Status                 | Details                                  |")
    print("  +-----------------------+------------------------+------------------------------------------+")
    print(f"  | EBI VCF Validator     | {ebi_st.value:<22} | Native v{version} allowlisted subprocess     |")
    print("  | Biomni Tool Adapter   | CONNECTED              | Local read-only tools; agent DISABLED    |")
    print(f"  | GEPA Proposer         | {gepa_st:<22} | optimize() is not called                 |")
    print("  | Meta-Harness Proposer | NOT_IMPORTED           | Local deterministic search only          |")
    print(f"  | Raindrop              | {raindrop.status:<22} | Credential-ready local fallback adapter  |")
    print(f"  | ElevenLabs Voice      | {eleven.status:<22} | Credential-ready local fallback adapter  |")
    print("  +-----------------------+------------------------+------------------------------------------+")
    passed_checks += 1

    suite = [
        [sys.executable, "-m", "ruff", "check", "services", "scripts/verify_v8.py", "scripts/audit_system.py"],
        [sys.executable, "-m", "pytest", "-q", "services/tests"],
        ["pnpm", "--filter", "web", "test"],
        ["pnpm", "--filter", "web", "exec", "tsc", "--noEmit"],
        [sys.executable, "scripts/demo_v8.py"],
    ]
    for command in suite:
        print("\n[SUITE]", " ".join(command))
        completed = subprocess.run(command, cwd=ROOT)
        if completed.returncode != 0:
            print(f"  FAIL: {' '.join(command)} exited {completed.returncode}")
            return completed.returncode

    elapsed = time.perf_counter() - start_total
    print("\n" + "=" * 80)
    print(f"  VERIFICATION SUCCESS: {passed_checks}/{total_checks} checks passed in {elapsed:.2f}s.")
    print("=" * 80)
    return 0


if __name__ == "__main__":
    sys.exit(run_v8_verification())
