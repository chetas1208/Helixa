# DIAMOND Genome V5 — Milestone 01: Database Schema Specification
## Logical Collections, Indexes, Fencing Constraints & CAS Storage

### 1. Schema Overview

The DIAMOND Genome persistence layer organizes state across 12 primary collections in MongoDB (`diamond_genome` database). All collections use typed Pydantic models with UTC ISO-8601 timestamps and strictly omit BSON `ObjectId` fields when returning models to REST or SSE consumers.

---

### 2. Collection Specifications

#### 2.1 `datasets`
Stores dataset definitions, reference assemblies, and benchmark test manifests.
- **Fields:**
  - `dataset_id` (string, unique): Primary dataset identifier (e.g. `SYNTH-GENOME-INCIDENT-001`).
  - `manifest_version` (string): Semantic version of dataset manifest.
  - `declared_assembly` (string): Reference genome build (e.g. `GRCh38`).
  - `is_synthetic` (boolean): Flag indicating synthetic benchmark status.
  - `reference` (object): Reference FASTA metadata and expected checksums.
  - `fixtures` (object / array): Fixture specifications and defect categories.
  - `metadata` (object): Provenance, creation parameters, and notes.
  - `created_at` (string): ISO-8601 UTC timestamp.
  - `updated_at` (string): ISO-8601 UTC timestamp.
- **Indexes:**
  - `uniq_dataset_id`: `{ dataset_id: 1 }` (unique)
  - `idx_dataset_created`: `{ created_at: 1 }`

#### 2.2 `artifacts`
Content-addressed metadata registry for genomic files (VCF, FASTA, indexes). Large files remain in local CAS storage or object storage; MongoDB stores only content-addressed descriptors.
- **Fields:**
  - `artifact_id` (string): Unique identifier.
  - `artifact_sha256` (string, unique): Cryptographic SHA-256 digest of file contents.
  - `dataset_id` (string, optional): Associated dataset ID.
  - `run_id` (string, optional): Originating run ID.
  - `filename` (string): Canonical file name.
  - `file_format` (string): Format identifier (`vcf`, `fasta`, `fai`, `json`).
  - `byte_size` (integer): Byte count.
  - `storage_path` (string): Content-addressed filesystem path.
  - `storage_backend` (string): Storage driver (`local_cas`, `s3`, `gridfs`).
  - `metadata` (object): Header lines, contigs, sample IDs.
  - `created_at` (string): ISO-8601 UTC timestamp.
- **Indexes:**
  - `uniq_artifact_sha256`: `{ artifact_sha256: 1 }` (unique)
  - `idx_artifact_dataset`: `{ dataset_id: 1 }`
  - `idx_artifact_format`: `{ file_format: 1 }`

#### 2.3 `tasks`
Orchestration task representing high-level jobs requiring agent execution.
- **Fields:**
  - `task_id` (string, unique): Task identifier.
  - `dataset_id` (string): Input dataset.
  - `status` (string): `CREATED` | `RUNNING` | `PAUSED` | `COMPLETED` | `FAILED` | `CANCELLED`.
  - `worker_lease_owner` (string, nullable): Active worker identifier holding the lease.
  - `worker_lease_expiry` (string, nullable): ISO-8601 lease expiration timestamp.
  - `fence_token` (integer): Generation fencing token (increments on every lease acquisition).
  - `created_at` (string): ISO-8601 timestamp.
  - `updated_at` (string): ISO-8601 timestamp.
- **Indexes:**
  - `uniq_task_id`: `{ task_id: 1 }` (unique)
  - `idx_task_status`: `{ status: 1 }`
  - `idx_task_lease`: `{ worker_lease_expiry: 1 }`
  - `idx_task_fence`: `{ fence_token: 1 }`

#### 2.4 `runs`
State machine execution instance for a specific task and input pair.
- **Fields:**
  - `run_id` (string, unique): Run identifier (e.g. `run-1791700200`).
  - `task_id` (string): Associated task ID.
  - `status` (string): State machine state (`CREATED`, `RUNNING`, `VALIDATING`, `DIAGNOSING`, `MUTATING`, `EVALUATING`, `PROMOTED`, `REJECTED`, `COMPLETED`, `PAUSED`, `FAILED`, `CANCELLED`).
  - `active_harness_version` (string): Currently active harness version ID.
  - `candidate_harness_version` (string, nullable): Proposed candidate version ID.
  - `evidence_receipt_id` (string, nullable): Cryptographic proof receipt ID.
  - `worker_lease_owner` (string, nullable): Assigned worker.
  - `worker_lease_expiry` (string, nullable): Lease expiration.
  - `fence_token` (integer): Generation token matching task.
  - `seq_counter` (integer): Current highest sequence number allocated.
  - `vcf_filename` (string): Target VCF input.
  - `fasta_filename` (string): Reference genome FASTA.
  - `created_at` (string): ISO-8601 timestamp.
  - `updated_at` (string): ISO-8601 timestamp.
- **Indexes:**
  - `uniq_run_id`: `{ run_id: 1 }` (unique)
  - `idx_run_task`: `{ task_id: 1 }`
  - `idx_run_status`: `{ status: 1 }`
  - `idx_run_lease`: `{ worker_lease_expiry: 1 }`
  - `idx_run_fence`: `{ fence_token: 1 }`

#### 2.5 `run_events`
Append-only immutable audit trail of execution events.
- **Fields:**
  - `event_id` (string): Event identifier (`evt-{run_id}-{seq}`).
  - `run_id` (string): Target run ID.
  - `seq` (integer): Monotonically increasing sequence integer.
  - `timestamp` (string): ISO-8601 timestamp.
  - `event_type` (string): Event category (`run.created`, `run.state.transition`, `reference.check.failed`, `harness.candidate.created`, `evaluation.finished`, `candidate.promoted`, `run.completed`, `worker.recovered`).
  - `entity_id` (string, nullable): Affected entity.
  - `evidence_digest` (string, nullable): Cryptographic digest.
  - `idempotency_key` (string, nullable): De-duplication key.
  - `payload` (object): Event payload attributes.
- **Indexes:**
  - `uniq_run_seq`: `{ run_id: 1, seq: 1 }` (unique)
  - `idx_run_idempotency`: `{ run_id: 1, idempotency_key: 1 }` (sparse, unique)
  - `idx_event_time`: `{ timestamp: 1 }`
  - `idx_event_type`: `{ event_type: 1 }`

#### 2.6 `checkpoints`
State snapshots allowing instantaneous execution resumption without re-running earlier phases.
- **Fields:**
  - `checkpoint_id` (string, unique): `chk-{run_id}-{step_index}`.
  - `run_id` (string): Run ID.
  - `step_index` (integer): Step counter (0, 1, 2...).
  - `state` (string): RunState at checkpoint.
  - `active_harness_id` (string): Active harness spec ID.
  - `candidate_harness_id` (string, nullable): Candidate harness spec ID.
  - `evidence_receipt_id` (string, nullable): Receipt ID.
  - `fence_token` (integer): Worker generation token that created the checkpoint.
  - `timestamp` (string): ISO-8601 timestamp.
  - `payload` (object): Checkpoint context (e.g. oracle failure status).
- **Indexes:**
  - `uniq_checkpoint_id`: `{ checkpoint_id: 1 }` (unique)
  - `idx_checkpoint_run_step`: `{ run_id: 1, step_index: 1 }`
  - `idx_checkpoint_time`: `{ timestamp: 1 }`

#### 2.7 `harness_versions`
Immutable genealogical specs defining validation policies and agent tool access.
- **Fields:**
  - `schema_version` (integer): Spec version.
  - `harness_id` (string): Harness identifier (`diamond-genome`).
  - `version_id` (string, unique): Version identifier (`harness-v1`, `harness-v2-candidate`).
  - `parent_version_id` (string, nullable): Parent version in lineage DAG.
  - `status` (string): `BASELINE` | `CANDIDATE` | `PROMOTED` | `REJECTED`.
  - `validation_policy` (object): Validation rules (`require_reference_allele_check`, `require_contig_compatibility`, etc.).
  - `context_policy` (object): Context injection rules.
  - `execution_policy` (object): Checkpoint intervals and retry limits.
  - `allowed_tools` (array of strings): Authorized tool whitelist.
  - `mutation_rationale` (string, nullable): Proposer justification.
  - `diff_summary` (object, nullable): Field-level diff against parent.
  - `metadata` (object): Authorship and model details.
  - `created_at` (string): ISO-8601 timestamp.
- **Indexes:**
  - `uniq_version_id`: `{ version_id: 1 }` (unique)
  - `uniq_harness_version`: `{ harness_id: 1, version_id: 1 }` (unique)
  - `idx_harness_parent`: `{ parent_version_id: 1 }`

#### 2.8 `harness_mutations`
Mutation proposal records containing rationale, proposed diff, and authoring agent metadata.
- **Fields:**
  - `mutation_id` (string, unique): Mutation identifier.
  - `parent_version_id` (string): Parent harness version.
  - `candidate_version_id` (string): Candidate harness version.
  - `run_id` (string): Run generating proposal.
  - `proposed_by` (string): Model provider / agent role.
  - `changes` (object): Key-value diffs.
  - `rationale` (string): Biological / integrity rationale.
  - `timestamp` (string): ISO-8601 timestamp.
- **Indexes:**
  - `uniq_mutation_id`: `{ mutation_id: 1 }` (unique)
  - `idx_mutation_parent`: `{ parent_version_id: 1 }`
  - `idx_mutation_candidate`: `{ candidate_version_id: 1 }`

#### 2.9 `evaluations`
Benchmark evaluations measuring candidate harness performance vs parent baseline.
- **Fields:**
  - `evaluation_id` (string, unique): Evaluation identifier.
  - `run_id` (string): Run ID.
  - `candidate_version_id` (string): Evaluated candidate ID.
  - `parent_version_id` (string): Parent baseline ID.
  - `candidate_score` (string): Formatted score string (e.g. `6/6`).
  - `parent_score` (string): Formatted score string (e.g. `4/6`).
  - `false_positive_rate` (float): False positive rate on negative controls.
  - `promoted` (boolean): Gating promotion decision.
  - `receipt_id` (string): Receipt reference.
  - `metrics` (object): Test breakdown across categories.
  - `timestamp` (string): ISO-8601 timestamp.
- **Indexes:**
  - `uniq_eval_id`: `{ evaluation_id: 1 }` (unique)
  - `idx_eval_candidate`: `{ candidate_version_id: 1 }`
  - `idx_eval_run`: `{ run_id: 1 }`

#### 2.10 `evidence_receipts`
Tamper-evident cryptographic proof receipt verifying gating evaluation.
- **Fields:**
  - `receipt_id` (string, unique): Receipt identifier.
  - `receipt_digest` (string, unique): SHA-256 hash of canonical receipt JSON.
  - `run_id` (string): Run ID.
  - `parent_version_id` (string, nullable): Parent ID.
  - `candidate_version_id` (string): Candidate ID.
  - `score` (string): Candidate benchmark score (`6/6`).
  - `parent_score` (string, nullable): Baseline score (`4/6`).
  - `false_positive_rate` (float): False positive rate.
  - `promoted` (boolean): Promotion decision.
  - `fixtures_evaluated` (integer): Test count.
  - `parent_spec_hash` (string, nullable): SHA-256 of parent canonical spec.
  - `candidate_spec_hash` (string, nullable): SHA-256 of candidate canonical spec.
  - `decision_reason` (string): Justification for gating decision.
  - `sha256` (string): Checksum.
  - `timestamp` (string): ISO-8601 timestamp.
  - `signature` (string, nullable): Reserved for cryptographic signature.
  - `metadata` (object): Evaluation metadata.
- **Indexes:**
  - `uniq_receipt_id`: `{ receipt_id: 1 }` (unique)
  - `uniq_receipt_digest`: `{ receipt_digest: 1 }` (unique)
  - `idx_receipt_run`: `{ run_id: 1 }`

#### 2.11 `research_memories`
Long-term semantic and episodic agent memory storing observed patterns and defect diagnoses.
- **Fields:**
  - `memory_id` (string, unique): Memory ID.
  - `run_id` (string): Run ID.
  - `memory_type` (string): `incident` | `lesson` | `pattern`.
  - `content` (string): Narrative description of finding.
  - `tags` (array of strings): Semantic tags (`ref_mismatch`, `grch38`, `contig`).
  - `timestamp` (string): ISO-8601 timestamp.
- **Indexes:**
  - `uniq_memory_id`: `{ memory_id: 1 }` (unique)
  - `idx_memory_run`: `{ run_id: 1 }`
  - `idx_memory_time`: `{ timestamp: 1 }`

#### 2.12 `integration_events`
Audit logs for third-party service interactions, telemetry dispatches, and health probes.
- **Fields:**
  - `event_id` (string, unique): Event ID.
  - `component` (string): `probe` | `raindrop` | `elevenlabs` | `mongodb`.
  - `action` (string): Operation name (`write_verification`, `telemetry_dispatch`).
  - `status` (string): Outcome status (`OK`, `PROBING`, `FAILED`).
  - `payload` (object): Event attributes.
  - `timestamp` (string): ISO-8601 timestamp.
- **Indexes:**
  - `uniq_integration_event_id`: `{ event_id: 1 }` (unique)
  - `idx_integration_time`: `{ timestamp: 1 }`
  - `idx_integration_component`: `{ component: 1 }`
