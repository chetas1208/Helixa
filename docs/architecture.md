# DIAMOND Genome Architecture

## System Overview

DIAMOND Genome enforces computational integrity in AI-driven genomic workflows through **Proof-Carrying Harness Evolution (PCHE)**.

```mermaid
flowchart TD
    User([Genomics Researcher]) --> UI[3-Mode React + 3D UI]
    UI -->|SSE / REST| API[FastAPI Orchestrator]
    
    subgraph Execution Engine
        API --> Worker[Durable Worker]
        Worker --> Validator[Deterministic Validator\npysam / bcftools]
        Validator --> Fixtures[FASTA / VCF Artifacts\nSHA256 Addressed]
    end

    subgraph Proof-Carrying Harness Evolution
        Worker --> Diag[Diagnosis Engine]
        Diag --> Proposer[Deterministic Proposer / LLM]
        Proposer --> Branch[Harness Mutation Branch]
        Branch --> Eval[Independent Evaluator]
        Eval -->|Holdout + Negative Controls| Gate{Promotion Gate}
        Gate -->|Promoted| PromotedHarness[New Canonical Harness]
        Gate -->|Rejected| RetainedHarness[Retain Parent]
    end

    subgraph Persistence & Lineage
        Worker --> Mongo[(MongoDB Async Native\nLineage & Receipts)]
        Eval --> Receipt[Immutable Evidence Receipt]
        Receipt --> Mongo
    end

    subgraph Telemetry & Voice
        Worker -.-> Raindrop[Raindrop Tracing]
        Receipt -.-> ElevenLabs[ElevenLabs TTS Briefings]
    end
```

## Core Subsystems

1. **Deterministic Scientific Validator**:
   - Parses VCF headers and variant records with `pysam.VariantFile`.
   - Compares declared REF allele against sequence at coordinates in `pysam.FastaFile`.
   - Verifies contig availability, lengths, and normalization assumptions.
   - Emits structured findings (`PASS`, `FAIL`, `WARNING`, `INCONCLUSIVE`).

2. **Harness Evolution State Machine**:
   - Explicit versioned `HarnessSpec` separated from immutable `PolicyEnvelope`.
   - Bounded mutation proposals modifying context policies and validation requirements.
   - Isolated replay of parent and candidate harnesses under equivalent conditions.
   - Independent Evaluator with private holdouts and negative controls to prevent over-filtering.

3. **Durable Persistence & Chaos Recovery**:
   - MongoDB native async driver managing tasks, runs, checkpoints, mutations, and evidence receipts.
   - Leases with timeouts for workers.
   - Idempotent tool execution and recovery after process termination (`SIGKILL`).

4. **3D DNA & Evolution Scene**:
   - Right-handed double helix rendered in Three.js / React Three Fiber.
   - Continuous rotation on elapsed-time clock (not frame-dependent).
   - 300-second deterministic procedural morph between visual modes.
   - Real scientific evidence markers linked directly to locus findings.
