#!/usr/bin/env python3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.runtime.genomics import DeterministicGenomicsValidator, ValidationPolicy


def benchmark():
    print("=" * 60)
    print("DIAMOND Genome V4: Bioinformatic Validator Benchmark")
    print("=" * 60)

    validator = DeterministicGenomicsValidator(policy=ValidationPolicy())
    fixtures = [
        ("fixtures/valid/valid_snvs.vcf", "Valid SNVs"),
        ("fixtures/valid/multiallelic_snvs.vcf", "Multi-allelic SNVs"),
        ("fixtures/valid/normalization_indel.vcf", "Indels"),
        ("fixtures/invalid/ref_mismatch.vcf", "REF Mismatch Incident"),
        ("fixtures/heldout/unseen_mismatch.vcf", "Held-out Transfer Set"),
    ]
    fasta = "fixtures/references/ref_synthetic_chr22.fasta"

    total_runs = 50
    start = time.perf_counter()

    for _ in range(total_runs):
        for path, name in fixtures:
            validator.validate(path, fasta)

    duration = time.perf_counter() - start
    total_validations = total_runs * len(fixtures)
    avg_latency = (duration / total_validations) * 1000

    print(f"Total Validations Executed: {total_validations}")
    print(f"Total Elapsed Time:        {duration:.3f} s")
    print(f"Average Latency per File:  {avg_latency:.2f} ms")
    print(f"Throughput:                {total_validations / duration:.1f} validations/sec")
    print("=" * 60)

if __name__ == "__main__":
    benchmark()
