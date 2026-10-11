import hashlib
import json


def file_info(path):
    with open(path, "rb") as f:
        content = f.read()
    return {
        "path": path,
        "sha256": hashlib.sha256(content).hexdigest(),
        "size_bytes": len(content),
    }

manifest = {
    "manifest_version": "1.0.0",
    "dataset_id": "SYNTH-GENOME-INCIDENT-001",
    "created_at": "2026-10-11T06:00:00Z",
    "is_synthetic": True,
    "attribution_required": False,
    "declared_assembly": "GRCh38",
    "reference": {
        **file_info("fixtures/references/ref_synthetic_chr22.fasta"),
        "fai_sha256": file_info("fixtures/references/ref_synthetic_chr22.fasta.fai")["sha256"],
        "contigs": [{"name": "chr22", "length": 120000}],
        "provenance": "Deterministic synthetic chromosome 22 sequence for research verification"
    },
    "fixtures": {
        "valid_snvs": {
            **file_info("fixtures/valid/valid_snvs.vcf"),
            "expected_outcome": "PASS",
            "category": "positive_control"
        },
        "multiallelic_snvs": {
            **file_info("fixtures/valid/multiallelic_snvs.vcf"),
            "expected_outcome": "PASS",
            "category": "positive_control"
        },
        "normalization_indel": {
            **file_info("fixtures/valid/normalization_indel.vcf"),
            "expected_outcome": "PASS",
            "category": "positive_control"
        },
        "ref_mismatch": {
            **file_info("fixtures/invalid/ref_mismatch.vcf"),
            "expected_outcome": "FAIL",
            "failing_check": "reference_ref_allele_match",
            "category": "incident_target"
        },
        "absent_assembly": {
            **file_info("fixtures/invalid/absent_assembly.vcf"),
            "expected_outcome": "WARNING",
            "failing_check": "declared_assembly_check",
            "category": "metadata_gap"
        },
        "unsupported_contig": {
            **file_info("fixtures/invalid/unsupported_contig.vcf"),
            "expected_outcome": "FAIL",
            "failing_check": "contig_compatibility_check",
            "category": "contig_gap"
        },
        "malformed_record": {
            **file_info("fixtures/invalid/malformed_record.vcf"),
            "expected_outcome": "ERROR",
            "failing_check": "vcf_syntax_check",
            "category": "syntax_gap"
        },
        "length_mismatch": {
            **file_info("fixtures/invalid/length_mismatch.vcf"),
            "expected_outcome": "FAIL",
            "failing_check": "contig_length_boundary_check",
            "category": "boundary_gap"
        },
        "unseen_mismatch": {
            **file_info("fixtures/heldout/unseen_mismatch.vcf"),
            "expected_outcome": "FAIL",
            "failing_check": "reference_ref_allele_match",
            "category": "heldout_transfer"
        }
    }
}

manifest_path = "fixtures/manifests/dataset_manifest.json"
with open(manifest_path, "w") as f:
    json.dump(manifest, f, indent=2)

print("Generated manifest at", manifest_path)
