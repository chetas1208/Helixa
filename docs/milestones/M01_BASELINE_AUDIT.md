# M01 Baseline Audit & Codebase Evaluation

**Date:** 2026-10-11  
**Project:** DIAMOND Genome V5  
**Milestone:** 01/10 — Atlas Foundation, Codebase Audit & Durable Execution  
**Auditor:** Principal Backend Engineer & Distributed Systems Architect

---

## 1. Executive Summary

This audit assesses the state of the DIAMOND Genome repository prior to executing Milestone 01 enhancements. The V4 baseline is functional and passes all 35 tests (26 backend + 9 frontend). However, significant persistence, concurrency, and architecture gaps exist that prevent it from being production-ready for distributed workers, high-concurrency event ingestion, and strict MongoDB Atlas deployment.

---

## 2. Component-by-Component Assessment

| Component | Current State | Audit Findings & Identified Gaps | Priority |
|---|---|---|---|
| **MongoDB Connection Lifecycle** | Functional | Creates ad-hoc `MongoDBClient` on every request/handler and closes it immediately. Causes connection pool thrashing. Lacks unified lifespan scoping, connection timeout configs, and deployment mode validation. | **P0 (Critical)** |
| **Persistence Repositories** | Missing Layer | Handlers and runners call `mongo.db.<collection>` directly with raw dictionaries. Lacks typed async repository abstraction (`RunRepository`, `EventRepository`, etc.). | **P0 (Critical)** |
| **Event Sequence Allocation** | Fragile | `runner.py` calculates `seq = last_event["seq"] + 1` via an uncoordinated read-then-write. Under concurrent appends, this causes race conditions or duplicate key errors. | **P0 (Critical)** |
| **Worker Lease & Fencing** | Incomplete | Implements lease ownership and expiry, but lacks a distributed **fencing token (generation counter)**. A delayed/stale worker could overwrite subsequent state. | **P0 (Critical)** |
| **Run State Machine** | Implicit | State transitions are updated in-place without formal validation of illegal state transitions (e.g. `COMPLETED -> RUNNING` or `FAILED -> PAUSED`). | **P1 (High)** |
| **Health Probes** | Basic | Lacks a `/api/health/ready` probe and does not distinguish `REACHABLE` from `AUTHENTICATED` and `WRITE_VERIFIED`. | **P1 (High)** |
| **Atlas Verification Command** | Missing | No standalone `make atlas-check` command to safely verify official sandbox connectivity and permissions without risking shared collections. | **P1 (High)** |
| **Scientific Validator** | Robust | Native `pysam` 0.24.1 + `bcftools` 1.24. All 10 fixtures pass. 1,436+ validations/sec benchmarked. | **Preserve** |
| **Frontend 3D Scene** | Robust | R3F revolving double helix and 300s morph clock pass all Vitest tests. | **Preserve** |

---

## 3. Baseline Verification Tests Run

Baseline test execution executed prior to any changes:
- `pytest services/tests/`: **26 / 26 passed** (0.54s)
- `vitest run apps/web`: **9 / 9 passed** (0.58s)
- `pnpm --filter web build`: **Passed** (TypeScript strict clean)

---

## 4. Prioritized Milestone 01 Patch Plan

1. **Step 1: Robust MongoDB Connection Pool & Lifecycle**
   - Create singleton lifespan-managed async client with proper pool sizing (`minPoolSize=5`, `maxPoolSize=50`).
   - Add timeout configurations: `serverSelectionTimeoutMS`, `connectTimeoutMS`.
   - Implement support for `local`, `test`, and `atlas-hackathon` deployment modes with `MONGODB_REQUIRE_ATLAS`.
   - Implement true database write verification probe.

2. **Step 2: Typed Repository Interfaces**
   - Implement `DatasetRepository`, `RunRepository`, `EventRepository`, `CheckpointRepository`, `HarnessRepository`, `EvaluationRepository`, `EvidenceRepository`, and `ArtifactRepository`.
   - Ensure clean domain Pydantic models with no raw BSON leaked to consumers.

3. **Step 3: Atomic Event Sequence Counter**
   - Use atomic `$inc` on run counter in MongoDB (`run_counters` or atomically within `RunRepository.append_event`).
   - Enforce strictly monotonic sequence numbers even under concurrent appends.

4. **Step 4: Durable State Machine & Fencing Generation**
   - Formal transition validator rejecting illegal states.
   - Worker lease with atomic `generation` counter (fencing token) to prevent stale worker writes.
   - Checkpoint restoration from persisted MongoDB documents.

5. **Step 5: Health & Readiness Probes**
   - `GET /api/health` (liveness)
   - `GET /api/health/ready` (readiness: ping + write verified)
   - `GET /api/integrations/status` (accurate deployment status)

6. **Step 6: Official Hackathon Atlas Verification & Chaos Demo**
   - Implement `make atlas-check` and `scripts/check_atlas.py`.
   - Implement reproducible `make demo-kill-worker` with machine-readable logging to `artifacts/milestones/m01/`.
   - Implement `make verify-m01`.
