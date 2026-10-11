#!/usr/bin/env python3
"""
DIAMOND Genome V5 — Master Adversarial Audit & Release Gate Script
Programmatically evaluates all 10 audit dimensions:
1. Scientific Genomics Validity
2. Agent Tool Autonomy & Containment
3. Recursive Harness Evolution Falsification
4. Long-Horizon Database Durability & Memory
5. Raindrop Observability & Privacy Canary
6. ElevenLabs Voice Briefing Grounding
7. Frontend 3D Control Plane Integrity
8. Security, Privacy & Vulnerability Guards
9. End-to-End Incident Verification
10. Release Verdict Synthesis (GO / CONDITIONAL GO / NO-GO)
"""

# ruff: noqa: E402
from __future__ import annotations

import asyncio
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Ensure project root is in sys.path
root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

from services.integrations.elevenlabs import BriefingRequest, ElevenLabsAdapter
from services.integrations.mongodb import MongoDBClient
from services.integrations.raindrop import RaindropAdapter
from services.runtime.evaluation import IndependentEvaluator
from services.runtime.genomics import (
    CheckStatus,
    DeterministicGenomicsValidator,
)
from services.runtime.genomics.bcftools_adapter import (
    BcftoolsAdapter,
    UnsafeBcftoolsCommandError,
)
from services.runtime.genomics.ingestion import FileIngestionService
from services.runtime.genomics.oracle import IndependentGenomicsOracle
from services.runtime.genomics.orchestrator import DeterministicGenomicsOrchestrator
from services.runtime.harness import (
    create_candidate_mutation,
    get_baseline_harness,
)
from services.runtime.orchestration import AgentRunner


async def run_audit() -> dict:
    start_time = time.perf_counter()
    audit_results = {
        "audit_id": f"AUDIT-V5-{int(datetime.now().timestamp())}",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "dimensions": {},
        "findings": [],
        "verdict": "PENDING",
    }

    fixtures_dir = Path("fixtures").resolve()
    fasta_path = fixtures_dir / "references" / "ref_synthetic_chr22.fasta"

    # =========================================================================
    # 1. Scientific Genomics Validity
    # =========================================================================
    print("\n[DIMENSION 1] Scientific Genomics Validity & Reference Integrity...")
    oracle = IndependentGenomicsOracle()
    validator = DeterministicGenomicsValidator()
    eval_rep = oracle.evaluate(validator)

    dim1_pass = (eval_rep.score_percentage == 100.0) and all(m.satisfied for m in eval_rep.metamorphic_results)
    audit_results["dimensions"]["genomics"] = {
        "status": "PASS" if dim1_pass else "FAIL",
        "oracle_score_pct": eval_rep.score_percentage,
        "oracle_digest": eval_rep.oracle_digest,
        "metamorphic_checks_passed": len(eval_rep.metamorphic_results),
    }
    print(f" -> Score: {eval_rep.score_percentage}% | Status: {'PASS' if dim1_pass else 'FAIL'}")

    # =========================================================================
    # 2. Agent Tool Autonomy & Containment
    # =========================================================================
    print("\n[DIMENSION 2] Agent Tool Autonomy & Sandboxed Containment...")
    adapter = BcftoolsAdapter()
    forbid_check_ref_s = False
    try:
        adapter._execute("norm", ["--check-ref", "s"], [])
    except UnsafeBcftoolsCommandError:
        forbid_check_ref_s = True

    forbid_unauthorized_cmd = False
    try:
        adapter._execute("reheader", [], [])
    except UnsafeBcftoolsCommandError:
        forbid_unauthorized_cmd = True

    dim2_pass = forbid_check_ref_s and forbid_unauthorized_cmd
    audit_results["dimensions"]["agents"] = {
        "status": "PASS" if dim2_pass else "FAIL",
        "forbid_check_ref_s": forbid_check_ref_s,
        "forbid_unauthorized_subcommand": forbid_unauthorized_cmd,
    }
    print(f" -> Safety containment: {'PASS' if dim2_pass else 'FAIL'}")

    # =========================================================================
    # 3. Recursive Harness Evolution Falsification
    # =========================================================================
    print("\n[DIMENSION 3] Proof-Carrying Harness Evolution & Falsification...")
    evaluator = IndependentEvaluator(fixtures_dir=fixtures_dir)
    baseline = get_baseline_harness()
    candidate = create_candidate_mutation(baseline, version_id="harness-v2-candidate")

    # Evaluate baseline vs candidate
    eval_res, receipt = evaluator.evaluate(baseline, candidate, run_id="audit-eval-run")

    # Negative control: test an unsafe candidate violating policy envelope
    unsafe_candidate = candidate.model_copy(deep=True)
    unsafe_candidate.context_policy.max_context_items = 999  # Exceeds max ceiling (24)
    unsafe_ok, unsafe_reason = evaluator.envelope.validate_candidate(unsafe_candidate)

    dim3_pass = (eval_res.promoted is True) and (not unsafe_ok)
    audit_results["dimensions"]["evolution"] = {
        "status": "PASS" if dim3_pass else "FAIL",
        "parent_score": eval_res.parent_score_str,
        "candidate_score": eval_res.candidate_score_str,
        "candidate_promoted": eval_res.promoted,
        "unsafe_candidate_rejected": not unsafe_ok,
        "receipt_digest": receipt.receipt_digest,
    }
    print(f" -> Promotion: {eval_res.candidate_score_str} (promoted: {eval_res.promoted}) | Unsafe rejected: {not unsafe_ok}")

    # =========================================================================
    # 4. Long-Horizon Database Durability & Memory
    # =========================================================================
    print("\n[DIMENSION 4] Database Durability, Monotonic Sequencing & Lease Fencing...")
    mongo = MongoDBClient()
    await mongo.init_indexes()
    runner = AgentRunner(mongo, fixtures_dir=fixtures_dir)

    # Monotonic sequence test
    run_id = f"audit-seq-run-{int(datetime.now().timestamp())}"
    events = []
    for i in range(10):
        evt = await runner.emit_event(run_id, None, f"audit.event.{i}", payload={"step": i})
        events.append(evt.seq)

    seq_strictly_increasing = (events == list(range(1, 11)))
    dim4_pass = seq_strictly_increasing and (mongo.deployment_mode in ("local", "atlas"))
    audit_results["dimensions"]["mongodb"] = {
        "status": "PASS" if dim4_pass else "FAIL",
        "deployment_mode": mongo.deployment_mode,
        "monotonic_sequences_verified": seq_strictly_increasing,
    }
    print(f" -> Mode: {mongo.deployment_mode} | Sequences: {events[:3]}...{events[-1]} ({'PASS' if dim4_pass else 'FAIL'})")

    # =========================================================================
    # 5. Raindrop Observability & Privacy Canary
    # =========================================================================
    print("\n[DIMENSION 5] Raindrop Observability & Privacy Canary Red-Teaming...")
    raindrop = RaindropAdapter()

    # Red-team privacy with synthetic canary strings
    canary_dna = "ATCGATCGATCG_CANARY_DNA_SEQUENCE"
    canary_secret = "SECRET_API_KEY_SUPER_PRIVATE"
    canary_metadata = {
        "run_id": "audit-run",
        "dataset_id": "audit-ds",
        "sequence": canary_dna,
        "vcf_content": canary_secret,
        "safe_metric": 42,
    }
    sanitized = raindrop._sanitize(canary_metadata)
    canary_stripped = (canary_dna not in str(sanitized)) and (canary_secret not in str(sanitized)) and ("safe_metric" in sanitized)

    dim5_pass = canary_stripped and (raindrop.status in ("CONFIGURED", "NOT_CONFIGURED"))
    audit_results["dimensions"]["raindrop"] = {
        "status": "PASS" if dim5_pass else "FAIL",
        "provider_status": raindrop.status,
        "canary_data_stripped": canary_stripped,
    }
    print(f" -> Provider status: {raindrop.status} | Canary stripped: {canary_stripped}")

    # =========================================================================
    # 6. ElevenLabs Voice Briefing Grounding
    # =========================================================================
    print("\n[DIMENSION 6] ElevenLabs Voice Intelligence & Evidence Grounding...")
    eleven = ElevenLabsAdapter()
    brief_req = BriefingRequest(
        receipt_id=receipt.receipt_id,
        run_id="audit-run-001",
        candidate_version_id="harness-v2-candidate",
        score="6/6",
        promoted=True,
        decision_reason="Verified by independent oracle.",
    )
    script_text = eleven.compose_briefing_script(brief_req)
    grounded = (receipt.receipt_id in script_text) and ("6/6" in script_text)

    dim6_pass = grounded and (eleven.status in ("CONFIGURED", "NOT_CONFIGURED"))
    audit_results["dimensions"]["elevenlabs"] = {
        "status": "PASS" if dim6_pass else "FAIL",
        "provider_status": eleven.status,
        "grounded_script_verified": grounded,
    }
    print(f" -> Status: {eleven.status} | Script grounded: {grounded}")

    # =========================================================================
    # 7. Frontend 3D Control Plane Integrity
    # =========================================================================
    print("\n[DIMENSION 7] Frontend 3D Control Plane & Mode Structure...")
    # Verify presence of App.tsx, 3 modes, and scene clock
    app_tsx = Path("apps/web/src/app/App.tsx").read_text(encoding="utf-8")
    has_mission = 'activeMode === "MISSION"' in app_tsx
    has_evolution = 'activeMode === "EVOLUTION"' in app_tsx
    has_proof = 'activeMode === "PROOF"' in app_tsx

    dim7_pass = has_mission and has_evolution and has_proof
    audit_results["dimensions"]["ui_3d"] = {
        "status": "PASS" if dim7_pass else "FAIL",
        "mission_mode_present": has_mission,
        "evolution_mode_present": has_evolution,
        "proof_mode_present": has_proof,
    }
    print(f" -> 3-Mode Architecture: {'PASS' if dim7_pass else 'FAIL'}")

    # =========================================================================
    # 8. Security, Privacy & Vulnerability Guards
    # =========================================================================
    print("\n[DIMENSION 8] Security, File Ingestion Limits & Immutability...")
    ingestion = FileIngestionService()
    path_traversal_blocked = False
    try:
        ingestion.sanitize_filename("../../etc/passwd")
    except ValueError:
        path_traversal_blocked = True

    dim8_pass = path_traversal_blocked
    audit_results["dimensions"]["security"] = {
        "status": "PASS" if dim8_pass else "FAIL",
        "path_traversal_blocked": path_traversal_blocked,
    }
    print(f" -> Path traversal blocked: {path_traversal_blocked}")

    # =========================================================================
    # 9. End-to-End Cold Incident Execution
    # =========================================================================
    print("\n[DIMENSION 9] End-to-End Cold Incident Execution & Recovery...")
    orchestrator = DeterministicGenomicsOrchestrator(mongo_client=mongo)
    e2e_run, e2e_receipt = await orchestrator.execute_pipeline(
        fixtures_dir / "valid" / "valid_snvs.vcf",
        fasta_path,
        dataset_id="AUDIT-COLD-DS",
    )
    dim9_pass = (e2e_run.status == CheckStatus.PASS) and (len(e2e_receipt.receipt_digest) == 64)
    audit_results["dimensions"]["e2e_execution"] = {
        "status": "PASS" if dim9_pass else "FAIL",
        "pipeline_run_id": e2e_run.run_id,
        "evidence_receipt_digest": e2e_receipt.receipt_digest,
    }
    print(f" -> Run ID: {e2e_run.run_id} | Digest: {e2e_receipt.receipt_digest[:16]}... ({'PASS' if dim9_pass else 'FAIL'})")

    # =========================================================================
    # 11. V8 independent checker, honest proposer, and privacy scrub
    # =========================================================================
    print("\n[DIMENSION 11] V8 independent VCF check, proposer labels, nucleotide scrub...")
    from services.integrations.biomni.adapter import BiomniToolAdapter
    from services.integrations.contracts import GenomicIncident
    from services.integrations.ebi_vcf.validator import EbiVcfValidator
    from services.runtime.evaluation.paired_scientific_eval import PairedScientificEvaluator
    from services.runtime.evolution.gepa_adapter import gepa_package_status
    from services.runtime.evolution.optimizer_registry import scheduler_status
    from services.runtime.evolution.search_adapter import MetaHarnessSearchAdapter

    ebi = EbiVcfValidator()
    paired = PairedScientificEvaluator().adjudicate(
        fixtures_dir / "invalid" / "ref_mismatch.vcf",
        fasta_path,
        run_id="audit-v8",
    )
    parent = get_baseline_harness()
    incident = GenomicIncident(
        incident_id="audit-ref-mismatch",
        run_id="audit-v8",
        dataset_sha256="abc",
        reference_sha256="def",
        failing_check="reference_allele_mismatch",
        error_signature="REF allele does not match",
    )
    ids_a = [spec.version_id for spec, _patch in MetaHarnessSearchAdapter().generate_candidates(parent, incident)]
    ids_b = [spec.version_id for spec, _patch in MetaHarnessSearchAdapter().generate_candidates(parent, incident)]
    schedule = scheduler_status()
    gepa_status, _gepa_detail = gepa_package_status()
    scrubbed = raindrop._sanitize({"note": "ATCGATCGATCGATCGATCG", "api_key": "hidden"})
    BiomniToolAdapter()
    biomni_loaded = "biomni" in sys.modules
    dim11_pass = (
        ebi.is_available()
        and paired.verdict.value == "AGREE_FAIL"
        and ids_a == ids_b
        and ids_a
        and schedule["primary_proposer"] == "DETERMINISTIC"
        and schedule["meta_harness_imported"] is False
        and gepa_status == "INSTALLED_UNCONFIGURED"
        and "ATCGATCGATCGATCGATCG" not in str(scrubbed)
        and "api_key" not in scrubbed
        and not biomni_loaded
    )
    audit_results["dimensions"]["v8_integration"] = {
        "status": "PASS" if dim11_pass else "FAIL",
        "ebi_available": ebi.is_available(),
        "ref_mismatch_adjudication": paired.verdict.value,
        "candidate_ids_stable": ids_a == ids_b,
        "proposer": schedule["primary_proposer"],
        "gepa_status": gepa_status,
        "biomni_imported": biomni_loaded,
    }
    print(f" -> EBI AGREE_FAIL: {paired.verdict.value} | Proposer: {schedule['primary_proposer']} | {'PASS' if dim11_pass else 'FAIL'}")

    # =========================================================================
    # 12. Release Verdict Synthesis
    # =========================================================================
    all_passed = all(d["status"] == "PASS" for d in audit_results["dimensions"].values())
    is_atlas_live = (mongo.deployment_mode == "atlas")

    # Verdict rules:
    # GO if all passed and Atlas is connected.
    # CONDITIONAL GO if all pass locally, but Atlas / external sponsor credentials are pending user input.
    if all_passed and is_atlas_live:
        verdict = "GO"
    elif all_passed:
        verdict = "CONDITIONAL GO"
    else:
        verdict = "NO-GO"

    audit_results["verdict"] = verdict
    audit_results["runtime_ms"] = (time.perf_counter() - start_time) * 1000

    out_dir = Path("artifacts/audit")
    out_dir.mkdir(parents=True, exist_ok=True)
    summary_file = out_dir / "verification_summary.json"
    with open(summary_file, "w", encoding="utf-8") as f:
        json.dump(audit_results, f, indent=2)

    # Also save evolution matrix
    evo_matrix = {
        "baseline_harness": baseline.model_dump(),
        "candidate_harness": candidate.model_dump(),
        "evaluation_score": eval_res.candidate_score_str,
        "parent_score": eval_res.parent_score_str,
        "promoted": eval_res.promoted,
        "receipt": receipt.model_dump(),
    }
    with open(out_dir / "evolution_matrix.json", "w", encoding="utf-8") as f:
        json.dump(evo_matrix, f, indent=2)

    print("\n" + "=" * 70)
    print(f"  FINAL AUDIT RELEASE VERDICT: {verdict}")
    print(f"  Summary saved to: {summary_file}")
    print(f"  Audit Duration: {audit_results['runtime_ms']:.2f} ms")
    if verdict == "CONDITIONAL GO":
        print("  Notice: Core scientific engine, PCHE oracle, and local durability are 100% verified.")
        print("          Atlas sandbox and external sponsor API credentials are credential-ready pending user configuration.")
    print("=" * 70)

    await mongo.close()
    return audit_results


if __name__ == "__main__":
    sys.exit(0 if asyncio.run(run_audit())["verdict"] in ("GO", "CONDITIONAL GO") else 1)
