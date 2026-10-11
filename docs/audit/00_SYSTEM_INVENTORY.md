# DIAMOND Genome V5 — Master System Inventory
**Audit Phase:** Full-System Adversarial Audit & Release Gate  
**Timestamp:** 2026-10-11T07:10:00Z  
**Verdict Scope:** Dimensions 1 through 10  

---

## 1. Executive Architecture Summary

DIAMOND Genome V5 is a high-assurance, reproducible computational genomics research control plane and self-evolving agent harness. The system is architected as an integrated high-performance monorepo:

- **Scientific Genomics Engine:** Deterministic VCF/FASTA validation, reference integrity checking, non-destructive normalization, coordinate conversion, and content-addressed storage (CAS) built on `pysam` 0.24.1 and sandboxed `bcftools`.
- **Proof-Carrying Harness Evolution (PCHE):** Self-improving agent harness with an independent evaluation oracle, immutable policy envelopes, metamorphic invariant checking, and cryptographic evidence receipts.
- **Durable Persistence & Memory:** MongoDB Atlas & local resilient async storage with monotonic event sequencing (`uniq_run_seq`), heartbeat leases, and worker generation fencing tokens.
- **Observability & Intelligence Adapters:** Server-side privacy-first telemetry for Raindrop and evidence-grounded voice briefings for ElevenLabs with graceful local fallback.
- **Interactive 3D Control Plane:** React 18, React Three Fiber (Three.js), TailwindCSS, and IGV.js featuring a revolving DNA double helix with 5-minute gradual phase transitions across three primary modes: **Mission**, **Evolution**, and **Proof**.

```
Diamond_Proj/
├── apps/
│   └── web/                                # React 18 + R3F + Vite Control Plane
│       ├── src/
│       │   ├── app/                        # App shell, Mode Router (Mission, Evolution, Proof)
│       │   ├── components/                 # 3D Canvas, Helix, IGV Browser, Control Panels
│       │   ├── state/                      # Zustand store, Scene Clock (5-min transitions)
│       │   └── tests/                      # Vitest unit & integration tests (9 passed)
│       ├── package.json
│       └── vite.config.ts
├── services/                               # Python 3.12 High-Performance Backend
│   ├── api/                                # FastAPI application, Lifespan, Endpoints
│   ├── integrations/
│   │   ├── mongodb/                        # PyMongo async driver, Repositories, Lease fencing
│   │   ├── raindrop/                       # Raindrop telemetry adapter, Privacy canary filter
│   │   └── elevenlabs/                     # ElevenLabs voice adapter, Grounded briefings
│   ├── runtime/
│   │   ├── evaluation/                     # PCHE Independent Evaluator & Oracle
│   │   ├── genomics/                       # Deterministic Validator, Bcftools, Ingestion, CAS
│   │   ├── harness/                        # Harness specs, Mutations, Policy envelopes
│   │   └── orchestration/                  # Agent runner, Worker loop, Fenced state machines
│   └── tests/                              # Pytest test suite (45 passed)
├── fixtures/                               # 16 Deterministic synthetic genomic fixtures
│   ├── references/                         # Synthetic chr22 FASTA reference & index
│   ├── valid/                              # SNVs, multiallelic, indels, canonical VCFs
│   ├── invalid/                            # REF mismatches, parse errors, boundary violations
│   └── heldout/                            # Unseen transfer test cases for PCHE evaluation
├── scripts/                                # Verification, audit, and chaos automation
│   ├── audit_system.py                     # 10-Dimension adversarial audit engine
│   ├── audit_system.sh                     # Audit shell entrypoint
│   ├── check_atlas.py                      # Atlas connectivity & write validator
│   ├── demo_chaos.py                       # Worker failure & fence recovery demo
│   ├── demo_m02.py                         # End-to-end scientific genomics demo
│   ├── verify_m01.py                       # Milestone 1 persistence test runner
│   └── verify_m02.py                       # Milestone 2 genomics test runner
├── artifacts/                              # Content-addressed storage, logs, and audit outputs
│   ├── audit/                              # Machine-readable audit summaries & evolution matrices
│   └── cas/                                # Content-addressed genomic storage by SHA-256
├── docs/                                   # Architectural records, ADRs, and milestone audit reports
├── Makefile                                # Unified build, test, demo, and audit targets
├── PROGRESS.md                             # Persistent engineering execution log
└── DECISIONS.md                            # Append-only Architecture Decision Records (ADRs)
```

---

## 2. Monorepo Integration & External Dependency Wiring

Rather than fragmenting the project across disparate cloned repositories, external references and dependencies have been natively integrated and wired directly into the monorepo:

| External Reference / Dependency | Integration Point | Status | Wiring Strategy |
|---|---|---|---|
| **bcftools & pysam** | `services/runtime/genomics/bcftools_adapter.py` | ACTIVE | Native C-extension (`pysam 0.24.1`) & sandboxed `/home/923873155/.local/bin/bcftools` allowlist wrapper. |
| **Three.js & R3F** | `apps/web/src/components/canvas/` | ACTIVE | `@react-three/fiber` & `@react-three/drei` npm dependencies in `apps/web`. |
| **MongoDB Async** | `services/integrations/mongodb/` | ACTIVE | `pymongo.AsyncMongoClient` scoped to FastAPI lifespan with connection pooling. |
| **Raindrop Observability** | `services/integrations/raindrop/` | CREDENTIAL-READY | Server-side adapter with zero-leak privacy canary filter. |
| **ElevenLabs Speech** | `services/integrations/elevenlabs/` | CREDENTIAL-READY | Server-side streaming audio with grounded fallback script generation. |
| **IGV.js** | `apps/web/src/components/igv/` | ACTIVE | Modular genome track visualizer embedded in Proof mode. |

---

## 3. Runtime Environment & Toolchain

- **Operating System:** Linux x86_64 (Debian/Ubuntu kernel)
- **Python Runtime:** Python 3.12.3 in virtual environment `.venv/`
- **Node.js Runtime:** Node.js v20.19.0, pnpm 9.15.4
- **Database Engine:** MongoDB Community Server 7.0.14 running on `127.0.0.1:27017`
- **Linters & Formatters:** Ruff 0.8.4 (Python), Biome / ESLint (TypeScript)
- **Test Frameworks:** Pytest 9.1.1, Vitest 1.6.1

---

## 4. Active Service Processes & Port Allocations

- **MongoDB Service:** `127.0.0.1:27017` (Active pid running with `--dbpath /home/923873155/.local/share/diamond_mongo_data`)
- **Backend API (Uvicorn):** `127.0.0.1:8000` (FastAPI lifespan-managed)
- **Frontend Vite Dev Server:** `127.0.0.1:5173` (Vite / React 18)
- **Worker Process:** Managed async worker loop with lease heartbeat (`services.runtime.orchestration.worker`)
