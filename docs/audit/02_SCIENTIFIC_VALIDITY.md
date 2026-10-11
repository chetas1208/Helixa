# DIAMOND Genome V5 — Scientific Genomics Validity Audit
**Audit Phase:** Full-System Adversarial Audit & Release Gate  
**Compliance Target:** Research Use Only (RUO), Deterministic Genomics Validation, Reference Integrity  

---

## 1. Scientific Engine Architecture

The DIAMOND Genome scientific validation engine (`services/runtime/genomics/`) provides reproducible, bit-exact verification of genomic variant files (VCF v4.2) against standard reference assemblies (FASTA).

### Core Components
1. **`DeterministicGenomicsValidator`:** Performs record-by-record reference verification, contig boundary validation, and allele checks using `pysam` 0.24.1.
2. **`BcftoolsAdapter`:** Sandboxed interface to `bcftools 1.20` enforcing execution allowlists, prohibiting silent mutations, and operating strictly on temporary paths.
3. **`FileIngestionService`:** Content-addressed storage (CAS) manager computing streaming SHA-256 digests, enforcing size limits (25MB raw, 100MB decompressed), and rejecting path traversal attacks.
4. **`IndependentGenomicsOracle`:** Independent ground-truth evaluator running 13 targeted tests and 3 metamorphic property checks against synthetic reference genomes.

---

## 2. Coordinate System & Reference Matching

A critical source of bioinformatics errors is the 1-based closed indexing of VCFs versus 0-based half-open indexing of memory buffers and FASTA APIs:
- `pysam.VariantFile` exposes variants with 1-based POS attribute `record.pos`.
- In `services/runtime/genomics/validator.py`, FASTA slices are retrieved using `fasta.fetch(reference=chrom, start=pos - 1, end=pos - 1 + len(ref))`.
- Length verification ensures multi-base insertions and deletions verify all prefix and reference bases accurately against the reference assembly.
- Contig compatibility is checked via header matching (`##contig=<ID=...>` and `fasta.references`).

---

## 3. Sandboxed Bcftools & Non-Destructive Invariance

### Prohibiting `--check-ref s` Silent Mutation
In standard bioinformatics workflows, running `bcftools norm --check-ref s` will silently alter the `REF` allele column to match the reference genome, destroying evidence of discrepancies.
- **Enforcement:** `BcftoolsAdapter._validate_options()` explicitly detects and blocks `--check-ref s`, raising `UnsafeBcftoolsCommandError`.
- **Allowed Options:** Only `--check-ref w` (warn) or `--check-ref x` (exit/reject) are permitted.

### Byte-Identity Invariance
The engine guarantees that user source files are treated as immutable:
$$\text{SHA256}(\text{source\_file}_{\text{pre}}) \equiv \text{SHA256}(\text{source\_file}_{\text{post}})$$
All normalization outputs, indexes, and reports are written to isolated Content-Addressed Storage (`artifacts/cas/`) paths.

---

## 4. Synthetic Fixture Inventory & Oracle Benchmark

The system maintains 16 synthetic genomic fixtures in `fixtures/`:

| Fixture Path | Description | Expected Evaluation |
|---|---|---|
| `fixtures/references/ref_synthetic_chr22.fasta` | Synthetic reference contig chr22 (120,000 bp) | Valid Reference |
| `fixtures/valid/valid_snvs.vcf` | Canonical single nucleotide variants | `PASS` |
| `fixtures/valid/multiallelic_snvs.vcf` | Multiallelic sites (e.g. `A -> G,T`) | `PASS` |
| `fixtures/valid/normalization_indel.vcf` | Normalized insertions and deletions | `PASS` |
| `fixtures/invalid/ref_mismatch.vcf` | Erroneous REF allele at chr22:105002 | `FAIL` (REF_MISMATCH) |
| `fixtures/invalid/corrupt_header.vcf` | Malformed VCF header format | `FAIL` (PARSE_ERROR) |
| `fixtures/invalid/unknown_contig.vcf` | Contig not present in reference | `FAIL` (CONTIG_MISMATCH) |
| `fixtures/invalid/out_of_bounds.vcf` | POS coordinates beyond contig length | `FAIL` (COORDINATE_OUT_OF_BOUNDS) |
| `fixtures/heldout/unseen_mismatch.vcf` | Held-out transfer test dataset | `FAIL` (REF_MISMATCH) |

### Benchmark Results
The `IndependentGenomicsOracle` benchmark executed during system audit achieved:
- **Baseline Test Pass Rate:** 13/13 (100.0%)
- **Metamorphic Invariant 1 (Contig prefix neutrality):** PASS
- **Metamorphic Invariant 2 (Reference allele case neutrality):** PASS
- **Metamorphic Invariant 3 (Idempotent validation execution):** PASS
- **Overall Score:** **100.0%**

---

## 5. Research Use Only (RUO) Boundary Assertion

The software operates strictly within Research Use Only boundaries:
- **Prohibited Operations:** No medical diagnoses, health risk prognostications, therapeutic recommendations, or gene editing instructions are generated.
- **Permitted Operations:** Structural VCF validation, reference assembly integrity verification, reproducibility reporting, and cryptographic evidence generation.
