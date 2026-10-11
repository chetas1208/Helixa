# DIAMOND Genome V5 — Database Recovery, Monotonic Sequencing & Memory Audit
**Audit Phase:** Full-System Adversarial Audit & Release Gate  
**Database Driver:** `pymongo.AsyncMongoClient` (PyMongo 4.11+)  
**Engines Supported:** MongoDB Atlas Serverless/Dedicated, Local MongoDB 7.0.14  

---

## 1. Database Architecture & Scoping

The persistence tier (`services/integrations/mongodb/`) is engineered for mission-critical reliability:
- **Async Client Management:** An instance of `pymongo.AsyncMongoClient` is scoped strictly to the application lifespan. Connection pooling (max pool size 50, min pool size 10) prevents socket starvation.
- **No Deprecated Drivers:** The legacy `motor` driver was omitted in favor of official async PyMongo.
- **Connection Health Checks:** Clean lifespan startup pings `admin` database with a 2000ms bounded timeout.

---

## 2. Collections, Schema & Index Strategy

The database enforces schema validation and indexes across 7 core collections:

| Collection | Key Fields | Indexes | Invariant / Guarantee |
|---|---|---|---|
| `runs` | `run_id`, `state`, `created_at` | `run_id` (unique), `state` | Single active run state machine. |
| `tasks` | `task_id`, `run_id`, `status` | `task_id` (unique), `(run_id, status)` | Task lifecycle idempotency. |
| `events` | `run_id`, `seq`, `event_type`, `payload` | `(run_id, seq)` (UNIQUE: `uniq_run_seq`) | **Strictly monotonic event ordering.** |
| `checkpoints`| `checkpoint_id`, `run_id`, `step_index` | `checkpoint_id` (unique), `(run_id, step_index)` | Resumable execution state snapshots. |
| `harnesses` | `version_id`, `status`, `created_at` | `version_id` (unique), `status` | Immutable harness lineage. |
| `evidence` | `receipt_id`, `run_id`, `receipt_digest`| `receipt_id` (unique), `receipt_digest` | Verifiable cryptographic evidence receipts. |
| `worker_leases`| `lease_id`, `worker_id`, `generation` | `lease_id` (unique), `expires_at` (TTL) | Distributed lock with generation fencing. |

---

## 3. Monotonic Sequencing Under Concurrency

To ensure event stream consumers (SSE, WebSockets, Raindrop telemetry) never observe sequence gaps or race conditions:
1. `run_sequences` stores `{ _id: run_id, current_seq: N }`.
2. Emitting an event calls atomic `find_one_and_update` with `{"$inc": {"current_seq": 1}}` returning the new value.
3. Event is inserted into `events` with `seq = current_seq`.
4. Unique index `uniq_run_seq` guarantees no two events can ever share the same sequence number.

**Audit Evidence:** Dimension 4 emitted 10 sequential events; sequence array evaluated to `[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]` with zero collisions.

---

## 4. Lease Fencing & Worker Crash Recovery

Distributed systems risk split-brain conditions when worker processes stall or experience network partitions:
- **Fencing Tokens:** Every lease grant increments an integer `generation` token.
- **Conditional Write Assertion:** All state updates require matching the active lease's generation token:
  $$\text{write\_condition} = \{ \text{lease\_id}: L, \text{generation}: G \}$$
- **Chaos Verification (`scripts/demo_chaos.py`):**
  1. Worker 1 acquires lease at generation 1.
  2. Worker 1 is killed mid-task.
  3. Lease expires; Worker 2 acquires lease at generation 2.
  4. Worker 2 inspects latest checkpoint in `checkpoints` collection and resumes execution.
  5. Stale Zombie Worker 1 attempts to write at generation 1 $\rightarrow$ Write is rejected.
