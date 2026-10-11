# DIAMOND Genome V5 — Milestone 02: Scientific Rules & Deterministic Specification
> **Research Use Only (RUO)**
> This document specifies the deterministic scientific validation rules enforced by the DIAMOND Genome pipeline.
> The pipeline strictly forbids medical diagnosis, disease risk claims, pathogenicity assertions, or treatment advice.

---

## 1. Coordinate Systems & Indexing Invariants

Genomic coordinates exist in multiple conventions across file formats. DIAMOND Genome enforces exact, mathematically verified conversion invariants:

1. **VCF Coordinate Convention (1-based, fully closed):**
   - In standard VCFv4.2, `POS` represents the 1-based start position of the reference allele `REF`.
   - The genomic span covered by the `REF` allele is $[POS, POS + \text{len}(REF) - 1]$.
   - A valid `POS` must strictly satisfy: $1 \le POS \le \text{contig\_length}$.
   - Violations where $POS \le 0$ or $(POS + \text{len}(REF) - 1) > \text{contig\_length}$ trigger `contig_length_boundary_check` with status `FAIL`.

2. **FASTA Coordinate Convention (0-based, half-open):**
   - Native indexing tools (e.g. `pysam.FastaFile.fetch` / htslib faidx) expect 0-based coordinates $[start, end)$.
   - The deterministic coordinate conversion formula is:
     $$start = POS - 1$$
     $$end = (POS - 1) + \text{len}(REF)$$
   - The reference sequence slice extracted from the reference FASTA is:
     $$seq = FASTA.fetch(chrom, start, end)$$

---

## 2. Scientific Truth Invariants

DIAMOND Genome enforces the following fundamental epistemological invariants to prevent hallucinated assertions:

| Property | Rule | Enforcement & Status |
| :--- | :--- | :--- |
| **Assembly Declaration $\ne$ Assembly Proof** | The presence of `##reference=GRCh38` in a VCF header is a declaration, not proof. | If missing or unverifiable against reference checksums, status is `WARNING` or `INCONCLUSIVE`. |
| **Contig Prefix $\ne$ Build Identity** | Contig names like `chr22` or `22` do not prove GRCh38 vs GRCh37. | Cross-checked against FASTA `.fai` index lengths; length mismatches trigger `contig_length_compatibility_check` with status `FAIL`. |
| **Missing Assembly Declaration** | A file without explicit `##reference=` or `##assembly=` header metadata cannot be confirmed. | Emits `declared_assembly_check` with status `WARNING` / `INCONCLUSIVE`. |
| **Symbolic & Structural Alleles** | Alleles containing `<DEL>`, `<DUP>`, or breakends (`[` or `]`) cannot be evaluated as simple point SNVs. | Classified as `symbolic_allele_check` with status `INCONCLUSIVE` (severity `INFO`), preventing crashes. |
| **Source Byte Immutability** | Read-only validation and normalization must never mutate input VCF bytes. | Pre-execution and post-execution SHA-256 hashes are asserted to be byte-identical ($pre == post$). |

---

## 3. Reference Allele Verification & Incident Detection

When a candidate VCF is evaluated against a declared indexed reference FASTA:
1. Every variant record is inspected for allele match:
   $$\text{declared\_ref} == \text{actual\_ref\_base}$$
2. If $\text{declared\_ref} \ne \text{actual\_ref\_base}$:
   - Emits `ValidationFinding`:
     - `check_id`: `"reference_ref_allele_match"`
     - `status`: `CheckStatus.FAIL`
     - `severity`: `Severity.CRITICAL`
     - `metadata`: `{"declared_ref": declared_ref, "fasta_ref": actual_ref_base}`
     - Locus coordinate: `chrom:pos`
3. If all records match:
   - Emits `reference_ref_allele_match` with status `CheckStatus.PASS`.

---

## 4. Normalization Invariants & Prohibition of `--check-ref s`

- **Strict Prohibition:** The bcftools flag `--check-ref s` (which silently rewrites the input VCF's declared REF alleles to match the reference) is strictly prohibited. Attempting to pass `--check-ref s` raises `UnsafeBcftoolsCommandError`.
- **Read-Only Verification:** Tool-level verification uses `--check-ref e` (which exits with error upon mismatch without modifying bytes).
- **Non-Destructive Normalization:** Normalization (`bcftools norm -m-any --fasta-ref <ref> -o <derived> <source>`) generates a separate derived artifact. The original input file remains byte-identical.
