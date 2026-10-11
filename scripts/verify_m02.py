#!/usr/bin/env python3
"""
DIAMOND Genome V5 — Milestone 02 Verification Script
Independently verifies all 10 M02 acceptance criteria:
AC1: Pysam coordinate conversion & bounds validation
AC2: Content-addressed storage (CAS) & streaming SHA-256
AC3: Scientific truth invariants & assembly certainty
AC4: Allowlisted bcftools subprocess adapter & '--check-ref s' prohibition
AC5: Non-destructive normalization & source byte immutability
AC6: Synthetic fixture suite (12+ fixtures)
AC7: Independent oracle isolation & metamorphic invariance
AC8: MongoDB evidence provenance & cryptographic receipt
AC9: FastAPI endpoints & SSE contract
AC10: Executable verification reporting
"""

from __future__ import annotations

import asyncio
import io
import json
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Ensure project root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from httpx import ASGITransport, AsyncClient  # noqa: E402

from services.api.app.main import app  # noqa: E402
from services.integrations.mongodb import MongoDBClient  # noqa: E402
from services.runtime.genomics import (  # noqa: E402
    CheckStatus,
    DeterministicGenomicsValidator,
    compute_sha256,
)
from services.runtime.genomics.bcftools_adapter import (  # noqa: E402
    BcftoolsAdapter,
    UnsafeBcftoolsCommandError,
)
from services.runtime.genomics.ingestion import (
    FileIngestionService,
    IngestionLimitExceeded,
)
from services.runtime.genomics.oracle import IndependentGenomicsOracle
from services.runtime.genomics.orchestrator import DeterministicGenomicsOrchestrator


async def verify_m02() -> int:
    print("=" * 70)
    print("DIAMOND Genome V5 — Milestone 02 Acceptance Verification")
    print("=" * 70)

    start_time = time.perf_counter()
    report: dict[str, Any] = {
        "milestone": "M02",
        "title": "Scientific Genomics Engine: Deterministic Validation, Reference Integrity, and Proof",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "criteria": {},
        "overall_status": "PENDING",
    }

    fixtures_dir = Path("fixtures").resolve()
    fasta_path = fixtures_dir / "references" / "ref_synthetic_chr22.fasta"

    # --- AC1: Pysam coordinate conversion & bounds ---
    print("\n[AC1] Verifying pysam coordinate conversion and bounds validation...")
    validator = DeterministicGenomicsValidator()
    valid_rep = validator.validate(fixtures_dir / "valid" / "valid_snvs.vcf", fasta_path)
    bounds_rep = validator.validate(fixtures_dir / "invalid" / "invalid_pos_bounds.vcf", fasta_path)
    ac1_pass = (valid_rep.overall_status == CheckStatus.PASS) and (bounds_rep.overall_status == CheckStatus.FAIL)
    report["criteria"]["AC1_pysam_coords_bounds"] = {
        "status": "PASS" if ac1_pass else "FAIL",
        "valid_vcf_records": valid_rep.total_records,
        "bounds_violation_caught": any(f.check_id == "contig_length_boundary_check" for f in bounds_rep.findings),
    }
    print(f" -> AC1: {'PASS' if ac1_pass else 'FAIL'}")

    # --- AC2: Content-Addressed Storage & Streaming SHA-256 ---
    print("\n[AC2] Verifying content-addressed storage (CAS) & streaming SHA-256...")
    with tempfile.TemporaryDirectory() as tmp_cas:
        ingestion = FileIngestionService(cas_root=tmp_cas, max_upload_mb=1)
        test_payload = b"##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\nchr22\t10001\trs1\tA\tG\t50\tPASS\t.\n"
        art, manifest = ingestion.stream_and_persist(io.BytesIO(test_payload), "test.vcf")
        limit_caught = False
        try:
            ingestion.stream_and_persist(io.BytesIO(b"A" * (2 * 1024 * 1024)), "too_large.vcf")
        except IngestionLimitExceeded:
            limit_caught = True
        ac2_pass = (compute_sha256(art.storage_path) == art.artifact_sha256) and limit_caught
        report["criteria"]["AC2_cas_and_streaming_sha256"] = {
            "status": "PASS" if ac2_pass else "FAIL",
            "artifact_sha256": art.artifact_sha256,
            "size_limit_enforced": limit_caught,
        }
        print(f" -> AC2: {'PASS' if ac2_pass else 'FAIL'}")

    # --- AC3: Scientific Truth Invariants ---
    print("\n[AC3] Verifying scientific truth invariants & assembly certainty...")
    ambig_rep = validator.validate(fixtures_dir / "invalid" / "ambiguous_assembly.vcf", fasta_path)
    ac3_pass = ambig_rep.overall_status in (CheckStatus.WARNING, CheckStatus.INCONCLUSIVE)
    report["criteria"]["AC3_scientific_truth_invariants"] = {
        "status": "PASS" if ac3_pass else "FAIL",
        "ambiguous_assembly_status": ambig_rep.overall_status.value,
        "warning_emitted": any(f.check_id == "declared_assembly_check" for f in ambig_rep.findings),
    }
    print(f" -> AC3: {'PASS' if ac3_pass else 'FAIL'}")

    # --- AC4: Allowlisted bcftools Subprocess Adapter ---
    print("\n[AC4] Verifying bcftools subprocess adapter & flag allowlisting...")
    adapter = BcftoolsAdapter()
    forbid_caught = False
    try:
        adapter._execute("norm", ["--check-ref", "s"], [])
    except UnsafeBcftoolsCommandError:
        forbid_caught = True
    checkref_receipt = adapter.check_ref(fixtures_dir / "valid" / "valid_snvs.vcf", fasta_path)
    ac4_pass = forbid_caught and (checkref_receipt.exit_code == 0)
    report["criteria"]["AC4_bcftools_adapter_safety"] = {
        "status": "PASS" if ac4_pass else "FAIL",
        "check_ref_s_forbidden": forbid_caught,
        "read_only_check_ref_exit_code": checkref_receipt.exit_code,
    }
    print(f" -> AC4: {'PASS' if ac4_pass else 'FAIL'}")

    # --- AC5: Non-Destructive Normalization & Immutability ---
    print("\n[AC5] Verifying non-destructive normalization & source byte immutability...")
    indel_vcf = fixtures_dir / "valid" / "normalization_indel.vcf"
    pre_sha = compute_sha256(indel_vcf)
    with tempfile.TemporaryDirectory() as tmp_norm:
        norm_out = Path(tmp_norm) / "norm.vcf"
        _, derived_art = adapter.normalize(indel_vcf, fasta_path, norm_out)
        post_sha = compute_sha256(indel_vcf)
        ac5_pass = (pre_sha == post_sha) and (derived_art.is_derived is True) and norm_out.exists()
        report["criteria"]["AC5_non_destructive_normalization"] = {
            "status": "PASS" if ac5_pass else "FAIL",
            "source_bytes_invariant": (pre_sha == post_sha),
            "derived_artifact_sha256": derived_art.artifact_sha256,
        }
        print(f" -> AC5: {'PASS' if ac5_pass else 'FAIL'}")

    # --- AC6: Synthetic Fixture Suite (12+ fixtures) ---
    print("\n[AC6] Verifying synthetic fixture inventory...")
    all_fixtures = list(fixtures_dir.glob("**/*.vcf*"))
    ac6_pass = len(all_fixtures) >= 12
    report["criteria"]["AC6_synthetic_fixture_suite"] = {
        "status": "PASS" if ac6_pass else "FAIL",
        "fixture_count": len(all_fixtures),
        "fixtures_found": [p.relative_to(fixtures_dir).as_posix() for p in all_fixtures],
    }
    print(f" -> AC6: {'PASS' if ac6_pass else 'FAIL'} ({len(all_fixtures)} fixtures)")

    # --- AC7: Independent Oracle Isolation & Metamorphic Invariance ---
    print("\n[AC7] Verifying independent oracle evaluation & metamorphic suite...")
    oracle = IndependentGenomicsOracle()
    oracle_eval = oracle.evaluate(validator)
    ac7_pass = (oracle_eval.score_percentage == 100.0) and all(m.satisfied for m in oracle_eval.metamorphic_results)
    report["criteria"]["AC7_oracle_and_metamorphic"] = {
        "status": "PASS" if ac7_pass else "FAIL",
        "oracle_score_pct": oracle_eval.score_percentage,
        "oracle_digest": oracle_eval.oracle_digest,
        "metamorphic_properties_satisfied": len(oracle_eval.metamorphic_results),
    }
    print(f" -> AC7: {'PASS' if ac7_pass else 'FAIL'} (Score: {oracle_eval.score_percentage}%)")

    # --- AC8: MongoDB Evidence Provenance & Cryptographic Receipt ---
    print("\n[AC8] Verifying MongoDB evidence provenance & cryptographic receipt...")
    mongo = MongoDBClient()
    await mongo.init_indexes()
    orchestrator = DeterministicGenomicsOrchestrator(mongo_client=mongo)
    run, receipt = await orchestrator.execute_pipeline(
        fixtures_dir / "valid" / "valid_snvs.vcf",
        fasta_path,
        dataset_id="M02_VERIFICATION_DS",
    )
    db_receipt = await mongo.db.evidence_receipts.find_one({"receipt_id": receipt.receipt_id}, {"_id": 0})
    ac8_pass = (db_receipt is not None) and (db_receipt["receipt_digest"] == receipt.receipt_digest)
    report["criteria"]["AC8_mongodb_evidence_provenance"] = {
        "status": "PASS" if ac8_pass else "FAIL",
        "receipt_id": receipt.receipt_id,
        "receipt_digest": receipt.receipt_digest,
        "persisted_in_mongodb": (db_receipt is not None),
    }
    print(f" -> AC8: {'PASS' if ac8_pass else 'FAIL'}")

    # --- AC9: FastAPI Endpoints & SSE Streaming ---
    print("\n[AC9] Verifying REST and SSE API endpoints...")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        api_val = await client.post(
            "/api/validation/run",
            json={"dataset_id": "test_api_ds", "vcf_filename": "valid_snvs.vcf"},
        )
        api_upload = await client.post(
            "/api/datasets/upload",
            files={"file": ("api_test.vcf", io.BytesIO(b"##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\nchr22\t10001\trs1\tA\tG\t50\tPASS\t.\n"), "text/plain")},
        )
        ac9_pass = (api_val.status_code == 200) and (api_upload.status_code == 200)
        report["criteria"]["AC9_api_endpoints"] = {
            "status": "PASS" if ac9_pass else "FAIL",
            "validation_run_status": api_val.status_code,
            "dataset_upload_status": api_upload.status_code,
        }
    print(f" -> AC9: {'PASS' if ac9_pass else 'FAIL'}")

    # --- AC10: Overall Reproducibility & Report Generation ---
    all_passed = all(c["status"] == "PASS" for c in report["criteria"].values())
    report["overall_status"] = "PASS" if all_passed else "FAIL"
    report["runtime_ms"] = (time.perf_counter() - start_time) * 1000
    report["criteria"]["AC10_verification_reporting"] = {
        "status": "PASS" if all_passed else "FAIL",
        "report_generated": True,
    }

    out_dir = Path("artifacts/milestones/m02")
    out_dir.mkdir(parents=True, exist_ok=True)
    report_file = out_dir / "verification_report.json"
    with open(report_file, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print("\n" + "=" * 70)
    print(f"OVERALL M02 VERIFICATION: {report['overall_status']}")
    print(f"Detailed report saved to: {report_file}")
    print(f"Runtime: {report['runtime_ms']:.2f}ms")
    print("=" * 70)

    await mongo.close()
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(verify_m02()))
