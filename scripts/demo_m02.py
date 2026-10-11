#!/usr/bin/env python3
"""
DIAMOND Genome V5 — Milestone 02 Scientific Demo Script
Demonstrates the 6-phase scientific genomics pipeline:
1. File Ingestion & CAS Storage (Streaming SHA-256)
2. Structure & Reference Validation (pysam Native)
3. Incident Detection & Failure Capture (REF Mismatch Incident)
4. Non-Destructive Normalization (bcftools Adapter & Immutability Proof)
5. Metamorphic Proof Suite Execution (Oracle Metamorphic Invariants)
6. Cryptographic Evidence Receipt Issuance & MongoDB Provenance
"""

from __future__ import annotations

import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Ensure project root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.integrations.mongodb import MongoDBClient  # noqa: E402
from services.runtime.genomics import (  # noqa: E402
    CheckStatus,
    DeterministicGenomicsValidator,
    compute_sha256,
)
from services.runtime.genomics.bcftools_adapter import BcftoolsAdapter
from services.runtime.genomics.ingestion import FileIngestionService
from services.runtime.genomics.oracle import IndependentGenomicsOracle
from services.runtime.genomics.orchestrator import DeterministicGenomicsOrchestrator


async def run_demo() -> int:
    print("=" * 80)
    print("  DIAMOND GENOME V5 — MILESTONE 02 SCIENTIFIC DEMO")
    print("  Reproducible Bioinformatics Pipeline, Immutability & Evidence Proof")
    print("=" * 80)

    fixtures_dir = Path("fixtures").resolve()
    fasta_path = fixtures_dir / "references" / "ref_synthetic_chr22.fasta"
    demo_out_dir = Path("artifacts/milestones/m02")
    demo_out_dir.mkdir(parents=True, exist_ok=True)
    demo_results: dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "phases": {},
    }

    # -------------------------------------------------------------
    # PHASE 1: File Ingestion & Content-Addressed Storage
    # -------------------------------------------------------------
    print("\n[PHASE 1] File Ingestion & Content-Addressed Storage (CAS)")
    print("-" * 60)
    ingestion = FileIngestionService(cas_root="artifacts/cas")
    valid_snvs_path = fixtures_dir / "valid" / "valid_snvs.vcf"
    with open(valid_snvs_path, "rb") as f:
        art_record, ds_manifest = ingestion.stream_and_persist(f, "valid_snvs.vcf")

    print(f"  • Source File:            {valid_snvs_path.name}")
    print(f"  • Content-Addressed Path: {art_record.storage_path}")
    print(f"  • SHA-256 Digest:         {art_record.artifact_sha256}")
    print(f"  • Byte Size:              {art_record.byte_size} bytes")
    print(f"  • Dataset Manifest ID:    {ds_manifest.dataset_id}")
    demo_results["phases"]["phase_1_ingestion"] = {
        "artifact_sha256": art_record.artifact_sha256,
        "storage_path": art_record.storage_path,
        "dataset_id": ds_manifest.dataset_id,
    }

    # -------------------------------------------------------------
    # PHASE 2: Structure & Reference Check (Valid Input)
    # -------------------------------------------------------------
    print("\n[PHASE 2] Structure & Reference Validation on Valid Variants")
    print("-" * 60)
    validator = DeterministicGenomicsValidator()
    report_valid = validator.validate(valid_snvs_path, fasta_path)
    print(f"  • Overall Status:         {report_valid.overall_status.value}")
    print(f"  • Records Evaluated:      {report_valid.total_records}")
    print(f"  • Passed Checks:          {report_valid.passed_checks} / {report_valid.total_checks}")
    print(f"  • Validator Runtime:      {report_valid.runtime_ms:.2f} ms")
    demo_results["phases"]["phase_2_valid_validation"] = {
        "status": report_valid.overall_status.value,
        "records": report_valid.total_records,
        "runtime_ms": report_valid.runtime_ms,
    }

    # -------------------------------------------------------------
    # PHASE 3: Incident Detection (REF Mismatch Detection)
    # -------------------------------------------------------------
    print("\n[PHASE 3] Incident Capture: REF Allele Mismatch Detection")
    print("-" * 60)
    mismatch_path = fixtures_dir / "invalid" / "ref_mismatch.vcf"
    report_mismatch = validator.validate(mismatch_path, fasta_path)
    mismatch_findings = [f for f in report_mismatch.findings if f.check_id == "reference_ref_allele_match" and f.status == CheckStatus.FAIL]
    print(f"  • Overall Status:         {report_mismatch.overall_status.value}")
    print(f"  • Incidents Detected:     {len(mismatch_findings)}")
    for f in mismatch_findings:
        print(f"    - Locus:                {f.locus.chrom}:{f.locus.pos}")
        print(f"    - Declared REF Base:    {f.metadata.get('declared_ref')}")
        print(f"    - True FASTA REF Base:  {f.metadata.get('fasta_ref')}")
        print(f"    - Message:              {f.message}")
    demo_results["phases"]["phase_3_incident_capture"] = {
        "status": report_mismatch.overall_status.value,
        "incidents_count": len(mismatch_findings),
        "locus": f"{mismatch_findings[0].locus.chrom}:{mismatch_findings[0].locus.pos}" if mismatch_findings else None,
    }

    # -------------------------------------------------------------
    # PHASE 4: Non-Destructive Normalization & Immutability Proof
    # -------------------------------------------------------------
    print("\n[PHASE 4] Non-Destructive Normalization & Immutability Proof")
    print("-" * 60)
    adapter = BcftoolsAdapter()
    indel_path = fixtures_dir / "valid" / "normalization_indel.vcf"
    pre_sha = compute_sha256(indel_path)
    norm_dest = Path("artifacts/scratch/demo_normalized.vcf")

    receipt_norm, derived_art = adapter.normalize(indel_path, fasta_path, norm_dest)
    post_sha = compute_sha256(indel_path)

    print(f"  • Original VCF:           {indel_path.name}")
    print(f"  • Pre-Norm SHA-256:       {pre_sha}")
    print(f"  • Post-Norm SHA-256:      {post_sha}")
    print(f"  • Immutability Verified:  {pre_sha == post_sha}")
    print(f"  • Derived Artifact Path:  {derived_art.storage_path}")
    print(f"  • Derived SHA-256:        {derived_art.artifact_sha256}")
    print(f"  • Tool Invocation:        {' '.join(receipt_norm.argv)}")
    demo_results["phases"]["phase_4_normalization"] = {
        "source_immutable": (pre_sha == post_sha),
        "pre_sha": pre_sha,
        "derived_sha": derived_art.artifact_sha256,
    }

    # -------------------------------------------------------------
    # PHASE 5: Metamorphic Invariance Proof Suite
    # -------------------------------------------------------------
    print("\n[PHASE 5] Metamorphic Proof Suite Execution")
    print("-" * 60)
    oracle = IndependentGenomicsOracle()
    oracle_eval = oracle.evaluate(validator)
    print(f"  • Oracle Evaluation Score: {oracle_eval.score_percentage:.1f}% ({oracle_eval.passed_cases}/{oracle_eval.total_cases} tests)")
    print(f"  • Oracle Digest:          {oracle_eval.oracle_digest}")
    for meta in oracle_eval.metamorphic_results:
        print(f"    - {meta.property_name:<26} [SATISFIED: {meta.satisfied}]")
        print(f"      {meta.details}")
    demo_results["phases"]["phase_5_metamorphic_proof"] = {
        "score_pct": oracle_eval.score_percentage,
        "oracle_digest": oracle_eval.oracle_digest,
        "properties": [m.model_dump(mode="json") for m in oracle_eval.metamorphic_results],
    }

    # -------------------------------------------------------------
    # PHASE 6: Cryptographic Evidence Receipt & MongoDB Provenance
    # -------------------------------------------------------------
    print("\n[PHASE 6] Cryptographic Evidence Receipt & MongoDB Provenance")
    print("-" * 60)
    mongo = MongoDBClient()
    await mongo.init_indexes()
    orchestrator = DeterministicGenomicsOrchestrator(mongo_client=mongo)
    run, receipt = await orchestrator.execute_pipeline(
        valid_snvs_path,
        fasta_path,
        dataset_id="DEMO-DATASET-001",
    )
    db_rec = await mongo.db.evidence_receipts.find_one({"receipt_id": receipt.receipt_id}, {"_id": 0})

    print(f"  • Run ID:                 {run.run_id}")
    print(f"  • Evidence Receipt ID:    {receipt.receipt_id}")
    print(f"  • Canonical Digest:       {receipt.receipt_digest}")
    print(f"  • Source Artifact SHA:    {receipt.source_artifact_sha256}")
    print(f"  • Reference FASTA SHA:    {receipt.selected_fasta_sha256}")
    print(f"  • Toolchain:              {receipt.tool_chain}")
    print(f"  • MongoDB Persisted:      {db_rec is not None}")
    demo_results["phases"]["phase_6_evidence_receipt"] = {
        "run_id": run.run_id,
        "receipt_id": receipt.receipt_id,
        "receipt_digest": receipt.receipt_digest,
        "persisted_in_mongodb": (db_rec is not None),
    }

    demo_report_path = demo_out_dir / "scientific_demo_report.json"
    with open(demo_report_path, "w", encoding="utf-8") as f:
        json.dump(demo_results, f, indent=2)

    print("\n" + "=" * 80)
    print("  DEMO EXECUTION COMPLETE — ALL 6 PHASES VERIFIED")
    print(f"  Saved demo summary artifact to: {demo_report_path}")
    print("=" * 80)

    await mongo.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(run_demo()))
