# Threat Model & Security Boundaries

## 1. Trust Boundaries
- **Untrusted Input**: User-uploaded VCF and FASTA files, user-supplied sample annotations, external LLM suggestions.
- **Trusted Domain**: Local deterministic validators (`pysam`, `bcftools`), immutable evaluation oracle, MongoDB persistence.
- **Semi-Trusted**: External telemetry and TTS providers (Raindrop, ElevenLabs).

## 2. Threat Analysis & Mitigations

### A. Malicious VCF Payloads / Prompt Injections
- **Threat**: Uploaded VCF files containing prompt injection payloads in header lines or INFO tags designed to hijack LLM behavior.
- **Mitigation**: LLM is never given direct arbitrary execution privileges. Genetic data is parsed exclusively through deterministic C-based parser (`pysam.VariantFile`). Only typed, validated summaries are passed to diagnosis engines.

### B. Evaluator Tampering & Capability Expansion
- **Threat**: A candidate harness proposes modifying the evaluator test suite or granting itself arbitrary shell execution permissions.
- **Mitigation**: The `PolicyEnvelope` is strictly immutable in code. Proposed mutations that expand `allowed_tools` beyond the envelope or attempt to modify evaluation truth sets are rejected before evaluation.

### C. Genomic Privacy & Sensitive Data Leakage
- **Threat**: Genetic sequence payloads or patient identifiers leaking to telemetry or voice APIs.
- **Mitigation**:
  - Telemetry allowlists only pseudonymous task IDs, run IDs, check names, and error codes.
  - Zero raw nucleotide sequences are ever transmitted to Raindrop or ElevenLabs.
  - ElevenLabs briefings synthesize only high-level status summaries based on verified evidence receipts.

### D. Subprocess Hijacking
- **Threat**: Arbitrary command injection through shell execution.
- **Mitigation**: All subprocess calls use structured argument lists (`list[str]`), restrictive timeouts, bounded stdout/stderr buffers, and fixed working directories. Shell strings (`shell=True`) are strictly forbidden.
