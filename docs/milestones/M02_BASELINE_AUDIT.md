# DIAMOND Genome V5 — Milestone 02: Baseline Audit
## Scientific Genomics Engine: Deterministic Validation, Reference Integrity, and Proof

**Audit Timestamp:** 2026-10-11T06:43:00Z  
**Branch / Commit:** `main` / `17739fa`  
**Auditor:** Principal Computational Genomics & Distributed Systems Engineer  

---

### 1. Executive Summary

Milestone 01 established durable MongoDB persistence, generation fencing tokens, and atomic event sequencing. Milestone 02 establishes the rigorous bioinformatics and scientific integrity engine. This baseline audit assesses existing VCF/FASTA parsing components, fixture coverage, toolchain availability (`pysam 0.24.1`, `bcftools 1.24`), and identifies the exact architectural delta required for research-grade deterministic validation.

---

### 2. Toolchain and Environment Inventory

| Component | Path / Spec | Detected Version | Operational Status |
|---|---|---|---|
| **Python Runtime** | `.venv/bin/python` | 3.12.3 | **ACTIVE** |
| **Pysam (htslib)** | Python extension | 0.24.1 | **ACTIVE & VERIFIED** |
| **bcftools CLI** | `/home/923873155/.local/bin/bcftools` | 1.24 | **ACTIVE & VERIFIED** |
| **MongoDB Daemon** | `/home/923873155/.local/mongodb/bin/mongod` | 7.0.14 | **ACTIVE (`127.0.0.1:27017`)** |
| **Synthetic Reference** | `fixtures/references/ref_synthetic_chr22.fasta` | 119,466 bp, GRCh38 | **INDEXED (`.fai` present)** |

---

### 3. Current Genomic Components Audit

#### 3.1 Existing Implementations (`services/runtime/genomics/`)
- `validator.py` (`DeterministicGenomicsValidator`):
  - Uses `pysam.VariantFile` for VCF parsing and `pysam.FastaFile` for 1-based to 0-based REF allele comparisons.
  - Benchmarked throughput: 1,436+ records/sec.
  - **Deficiencies Identified:**
    1. Symbolic alleles (`<DEL>`, `<INS>`, `<DUP>`) and structural variant breakends (`BND`) are not explicitly classified; they could be misidentified as malformed single bases.
    2. Missing assembly metadata (`##reference=`) defaults to a generic warning rather than enforcing the scientific invariant of `INCONCLUSIVE`.
    3. Normalization detection flags multi-allelic records but lacks a dedicated non-destructive left-alignment checking engine.
    4. Coordinate out-of-bounds checks relative to contig lengths are partially handled but lack explicit tests for POS <= 0 or POS > contig length.
- `hasher.py`:
  - Implements SHA-256 digest computation and path traversal guards (`safe_resolve_path`).
  - **Deficiency:** Computes SHA-256 on small files by reading all bytes into memory. Needs streaming chunks (`64KB`) to safely handle multi-megabyte VCFs and protect against memory exhaustion.
- `models.py`:
  - Contains `CheckStatus`, `Severity`, `Finding`, `LocusInfo`, `ValidationPolicy`, `ValidationReport`.
  - **Deficiency:** Lacks the explicit M02 typed contracts (`DatasetManifest`, `ReferenceManifest`, `ArtifactRecord`, `ToolExecutionReceipt`, `ScientificEvidenceReceipt`).

#### 3.2 Fixture Coverage Audit (`fixtures/`)
- Currently present:
  - `valid/`: `valid_snvs.vcf`, `normalization_indel.vcf`, `multiallelic_snvs.vcf` (3 fixtures).
  - `invalid/`: `absent_assembly.vcf`, `length_mismatch.vcf`, `malformed_record.vcf`, `ref_mismatch.vcf`, `unsupported_contig.vcf` (5 fixtures).
  - `heldout/`: `unseen_mismatch.vcf` (1 fixture).
- **Missing Required Cases (Section 7):**
  - Valid short indels (`valid_indels.vcf`).
  - Truncated gzip compressed VCF (`truncated.vcf.gz`).
  - Ambiguous declared assembly (`ambiguous_assembly.vcf`).
  - Invalid POS bounds (`invalid_pos_bounds.vcf` with POS <= 0 and POS > contig length).
  - Benign header variation (`benign_header_variant.vcf`).
  - Symbolic / complex structural variants (`symbolic_structural.vcf`).
  - Second independent held-out case (`heldout_contig_mismatch.vcf`).

#### 3.3 bcftools Subprocess Integration
- **Status:** Currently, `validator.py` embeds tool version metadata (`bcftools 1.24`) but does not execute external `bcftools` subprocesses.
- **Required:** A sandboxed, allowlisted subprocess adapter (`bcftools_adapter.py`) with strict argument lists, no `shell=True`, isolated temporary directories, explicit timeouts (15s), and output size caps.
- **Critical Policy:** Strictly forbid `bcftools norm --check-ref s` (which silently mutates REF alleles). Read-only checking must use `--check-ref e`.

---

### 4. Prioritized Milestone 02 Implementation Plan

1. **Step 1: Scientific Data Contracts (`services/runtime/genomics/contracts.py`)**
   - Implement `DatasetManifest`, `ReferenceManifest`, `ArtifactRecord`, `ValidationFinding`, `ToolExecutionReceipt`, `ScientificEvidenceReceipt`.
2. **Step 2: Hardened Ingestion & Content-Addressed Storage (`services/runtime/genomics/ingestion.py`)**
   - Streamed SHA-256, magic-byte inspection (VCF vs BGZF gzip), upload size limits, atomic write/rename, decompression bomb protection.
3. **Step 3: Allowlisted bcftools Subprocess Adapter (`services/runtime/genomics/bcftools_adapter.py`)**
   - Sandboxed execution, timeout enforcement, `check_ref` (`--check-ref e`), non-destructive normalization producing separate derived artifacts.
4. **Step 4: Enhanced Deterministic Validator (`services/runtime/genomics/validator.py`)**
   - Symbolic variant handling, out-of-bounds coordinate checks, scientific truth distinctions (inconclusive assembly metadata).
5. **Step 5: Deterministic Validation Pipeline (`services/runtime/genomics/orchestrator.py`)**
   - Phased execution: `INGESTED -> PARSED -> REFERENCE_RESOLVED -> STRUCTURE_CHECKED -> REF_CHECKED -> NORMALIZATION_CHECKED -> EVIDENCE_COMMITTED`.
6. **Step 6: Synthetic Fixtures & Independent Oracle (`fixtures/` & `services/runtime/genomics/oracle.py`)**
   - Generate all 14 required fixtures; freeze ground truth mapping outside candidate harness space; metamorphic invariance tests.
7. **Step 7: API Endpoints & Provenance Persistence (`services/api/app/routes/`)**
   - Upload, reference listing, validation execution, SSE event streaming, artifact retrieval.
8. **Step 8: Verification Suite & Demo (`make verify-m02`, `make demo-m02`)**
   - Automated test runner and 6-phase scientific demo.
9. **Step 9: Documentation Deliverables**
   - Detailed scientific documentation, updating `PROGRESS.md` and `DECISIONS.md`.
