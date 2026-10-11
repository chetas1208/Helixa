# DIAMOND Genome V5 — Milestone 01: Recovery & Fencing Design
## Distributed Worker Failover, Generation Tokens, and Checkpoint Resumption

### 1. Introduction

In distributed autonomous agent systems, worker nodes may fail abruptly due to machine restarts, out-of-memory kills (OOM), network partitions, or prolonged garbage collection pauses. Without durable fencing, two catastrophic failure modes arise:
1. **Split-Brain Execution:** Two workers simultaneously process the same task, emitting conflicting events and mutating different versions.
2. **Zombie Overwrite:** A worker that temporarily paused (e.g. during a 30-second GC pause) wakes up after its lease expired and overwrites newer state persisted by a recovery worker.

DIAMOND Genome V5 solves both problems through **Generation Fencing Tokens** combined with **Durable Checkpoints** and **Atomic Monotonic Sequences**.

---

### 2. Worker Lease Lifecycle

Worker coordination is implemented in `TaskRepository` and executed by `DurableWorker`:

```mermaid
sequenceDiagram
    autonumber
    participant W1 as Worker-1 (Alpha)
    participant DB as MongoDB (tasks / runs / checkpoints)
    participant W2 as Worker-2 (Beta - Recovery)

    Note over W1,DB: Phase 1: Normal Acquisition & Execution
    W1->>DB: find_one_and_update(tasks, {$inc: {fence_token: 1}, $set: {owner: W1}})
    DB-->>W1: Lease Acquired: fence_token=2
    W1->>DB: Save Checkpoint 0 (CREATED, fence_token=2)
    W1->>DB: Save Checkpoint 1 (VALIDATING, fence_token=2)
    W1->>DB: Save Checkpoint 2 (DIAGNOSING, fence_token=2)
    W1->>DB: Save Checkpoint 3 (MUTATING, fence_token=2)

    Note over W1: W1 Crashes / Loses Network at step 3

    Note over DB,W2: Phase 2: Lease Expiration & Takeover
    DB->>DB: worker_lease_expiry passes (Lease Expired)
    W2->>DB: find_one_and_update(tasks, {$inc: {fence_token: 1}, $set: {owner: W2}})
    DB-->>W2: Lease Acquired: fence_token=3
    W2->>DB: Query Latest Checkpoint for run
    DB-->>W2: Returns Checkpoint 3 (MUTATING, step_index=3)
    W2->>DB: Emit "worker.recovered" Event (seq allocated via atomic $inc)

    Note over W2,DB: Phase 3: Resumed Execution & Promotion
    W2->>DB: Evaluate Candidate against Parent (6 fixtures)
    W2->>DB: Save Evidence Receipt (receipt_id, digest)
    W2->>DB: Transition Run to PROMOTED (fence_token=3)
    W2->>DB: Release Lease (COMPLETED, fence_token=3)

    Note over W1,DB: Phase 4: Stale Zombie Worker Wakes Up
    W1->>DB: Transition Run to EVALUATING (fence_token=2)
    DB-->>W1: REJECTED: FencingTokenConflictError (fence_token 2 is stale; active is 3)
```

---

### 3. Generation Fencing Mechanics

#### 3.1 Lease Acquisition
Lease acquisition is performed atomically in MongoDB:
```python
updated_task = await self.db.tasks.find_one_and_update(
    {
        "task_id": task_id,
        "$or": [
            {"worker_lease_owner": None},
            {"worker_lease_expiry": {"$lt": now.isoformat()}},
            {"worker_lease_owner": worker_id},
        ],
    },
    {
        "$set": {
            "worker_lease_owner": worker_id,
            "worker_lease_expiry": expiry.isoformat(),
            "status": TaskStatus.RUNNING.value,
            "updated_at": now.isoformat(),
        },
        "$inc": {"fence_token": 1},
    },
    return_document=ReturnDocument.AFTER,
)
```
- **Monotonic Guarantee:** Every successful claim strictly increments `fence_token`.
- **Exclusion Guarantee:** Only one worker can claim an expired or unowned task at any instant.

#### 3.2 State Transition Verification
Whenever a worker transitions run state or saves checkpoints:
```python
if fence_token is not None and current_run.fence_token != fence_token:
    raise FencingTokenConflictError(
        f"State transition rejected: fencing token {fence_token} is stale "
        f"(active generation: {current_run.fence_token})."
    )
```
If a worker holds generation token $T_{old} < T_{active}$, its writes fail instantly with zero side-effects.

---

### 4. Checkpoint Resumption Algorithm

When a replacement worker acquires a lease for an unfinished run:
1. **Query Latest Checkpoint:** Reads `db.checkpoints.find_one({"run_id": run_id}, sort=[("step_index", -1)])`.
2. **Reconstitute Execution State:**
   - Active harness: loaded by `latest_cp.active_harness_id`.
   - Candidate harness: loaded if `latest_cp.candidate_harness_id` is present.
   - Evidence receipt ID: restored if present.
   - Resumed state: `latest_cp.state` (e.g. `MUTATING`).
3. **Emit Recovery Telemetry:**
   Appends a `worker.recovered` event containing the recovery worker ID, checkpoint ID, and new `fence_token`. Sequence number is atomically allocated.
4. **Resume State Machine:**
   Execution skips already-verified phases (`CREATED`, `VALIDATING`, `DIAGNOSING`) and resumes directly at the subsequent phase (`EVALUATING`).
5. **Zero Duplicate Work:**
   The validator and proposers are not re-executed for previously checkpointed steps.

---

### 5. Chaos Recovery Verification Evidence

The recovery protocol was independently verified under simulated chaos conditions via `make demo-kill-worker` (`scripts/demo_chaos.py`).
The generated artifact `artifacts/milestones/m01/chaos_recovery.json` documents:
- **Worker 1:** `worker-alpha`, initial token `2`, terminated at step 3 (`MUTATING`).
- **Worker 2:** `worker-beta-recovery`, recovery token `3`, resumed from `chk-run-chaos-demo-001-3`.
- **Fencing Proof:** `stale_worker_fenced: true` (Worker 1's attempted transition rejected with `FencingTokenConflictError`).
- **Sequence Integrity:** 10 contiguous events (`1..10`) verified without gaps or collisions.
- **Evidence Receipt:** Promoted with score `6/6` (FPR=0.0).
