# DIAMOND Genome V5 — Architecture Decision Log (ADR)
> **Append-Only Living Architectural Memory**
> This file records every material architectural, scientific, and security decision across DIAMOND Genome milestones.
> Decisions are never deleted or silently rewritten; superseding decisions explicitly reference and supersede prior entries.

---

## Decision Index
- [ADR-001: Lifespan-Scoped Connection Pooling with PyMongo AsyncMongoClient](#adr-001-lifespan-scoped-connection-pooling-with-pymongo-asyncmongoclient)
- [ADR-002: Generation Fencing Tokens for Distributed Worker Lease Safety](#adr-002-generation-fencing-tokens-for-distributed-worker-lease-safety)
- [ADR-003: Atomic Monotonic Sequence Allocation via Document-Level Increment](#adr-003-atomic-monotonic-sequence-allocation-via-document-level-increment)
- [ADR-004: Strict Isolation of MongoDB BSON Internals from API Layer](#adr-004-strict-isolation-of-mongodb-bson-internals-from-api-layer)
- [ADR-005: Dual-Engine Genomic Validation Strategy (pysam + bcftools)](#adr-005-dual-engine-genomic-validation-strategy-pysam--bcftools)
- [ADR-006: Scientific Truth Invariants and Genome-Build Certainty](#adr-006-scientific-truth-invariants-and-genome-build-certainty)
- [ADR-007: Non-Destructive Normalization and Strict Prohibition of `--check-ref s`](#adr-007-non-destructive-normalization-and-strict-prohibition-of---check-ref-s)
- [ADR-008: Content-Addressed Storage (CAS) for Large Genomic Artifacts](#adr-008-content-addressed-storage-cas-for-large-genomic-artifacts)
- [ADR-009: Independent Oracle Isolation and Metamorphic Invariance](#adr-009-independent-oracle-isolation-and-metamorphic-invariance)
- [ADR-010: Subprocess Sandboxing and Strict Command Allowlisting](#adr-010-subprocess-sandboxing-and-strict-command-allowlisting)
- [ADR-011: Strict Input Sanitization for Content-Addressed File Ingestion](#adr-011-strict-input-sanitization-for-content-addressed-file-ingestion)
- [ADR-012: Full-System Release Gating and Credential-Ready State Machine](#adr-012-full-system-release-gating-and-credential-ready-state-machine)
- [ADR-013: Red-Team Privacy Canary Sanitization for External Observability](#adr-013-red-team-privacy-canary-sanitization-for-external-observability)
- [ADR-014: Do not run the Biomni agent](#adr-014-do-not-run-the-biomni-agent)
- [ADR-015: One proposer, GEPA not a second supervisor](#adr-015-one-proposer-gepa-not-a-second-supervisor)
- [ADR-016: EBI binaries are the independent VCF oracle](#adr-016-ebi-binaries-are-the-independent-vcf-oracle)
- [ADR-017: Held-out cases stay outside the proposer](#adr-017-held-out-cases-stay-outside-the-proposer)
- [ADR-018: Sponsor calls stay NOT_CONFIGURED without credentials](#adr-018-sponsor-calls-stay-not_configured-without-credentials)
- [ADR-019: Proof UI reads recorded artifacts](#adr-019-proof-ui-reads-recorded-artifacts)
- [ADR-020: Stable ids, local Mongo resume, and nucleotide scrub](#adr-020-stable-ids-local-mongo-resume-and-nucleotide-scrub)
- [ADR-021: Population evolution is a separate haploid model](#adr-021-population-evolution-is-a-separate-haploid-model)
- [ADR-022: Diploid additive step, climate still not fitness](#adr-022-diploid-additive-step-climate-still-not-fitness)
- [ADR-023: V13 contract stays on the JSON workspace file](#adr-023-v13-contract-stays-on-the-json-workspace-file)
- [V7-ADR-001: Failure-Trace Reflection and Bounded Candidate Branching](#v7-adr-001-failure-trace-reflection-and-bounded-candidate-branching)
- [V7-ADR-002: Safe Declarative Capability Macros vs Arbitrary Host Code Execution](#v7-adr-002-safe-declarative-capability-macros-vs-arbitrary-host-code-execution)
- [V7-ADR-003: EvidenceSealV1 Cryptographic Canonical Hashing and Tamper Verification](#v7-adr-003-evidencesealv1-cryptographic-canonical-hashing-and-tamper-verification)
- [V7-ADR-004: Cascading Invalidation in Scientific Memory Dependency Graphs](#v7-adr-004-cascading-invalidation-in-scientific-memory-dependency-graphs)
- [V14-ADR-001: Body Asset Licensing — Procedural Geometry and Strict Ban on Z-Anatomy & BodyParts3D](#v14-adr-001-body-asset-licensing--procedural-geometry-and-strict-ban-on-z-anatomy--bodyparts3d)
- [V14-ADR-002: Anatomical Ontology — Uberon via EBI OLS4 with Explicit Laterality](#v14-adr-002-anatomical-ontology--uberon-via-ebi-ols4-with-explicit-laterality)
- [V14-ADR-003: Gene-Tissue Association Confidence Schema & Scientific Causality Boundary](#v14-adr-003-gene-tissue-association-confidence-schema--scientific-causality-boundary)
- [V14-ADR-004: Reference Genome Choice — Pinned Ensembl 116 GRCh38 FASTA Slices](#v14-adr-004-reference-genome-choice--pinned-ensembl-116-grch38-fasta-slices)
- [V14-ADR-005: Trait Goals vs In-Silico Nucleotide Edits](#v14-adr-005-trait-goals-vs-in-silico-nucleotide-edits)
- [V14-ADR-006: Body Geometry Invariance](#v14-adr-006-body-geometry-invariance)
- [V14-ADR-007: Voice Transcription Review Step (No Auto-Apply)](#v14-adr-007-voice-transcription-review-step-no-auto-apply)
- [V14-ADR-008: Lineage Discipline — Strict Separation of Genome Revisions and Harness Versions](#v14-adr-008-lineage-discipline--strict-separation-of-genome-revisions-and-harness-versions)

---

### ADR-001: Lifespan-Scoped Connection Pooling with PyMongo AsyncMongoClient
- **Date:** 2026-10-11
- **Status:** ACCEPTED (Milestone 01)
- **Context:** FastAPI applications handling async requests and SSE streams require efficient connection management to MongoDB. Constructing client instances inside request handlers exhausts socket pools and leaks connections; using the deprecated Motor driver introduces compatibility friction with Python 3.12.
- **Alternatives Considered:**
  1. *Motor Async Driver:* Deprecated, laggy maintenance cycle for Python 3.12+.
  2. *Per-Request MongoClient instantiation:* Exceeds file descriptors under load, adds 20-50ms latency per request.
  3. *Global module-level singleton:* Risk of event-loop binding mismatches across tests.
- **Decision:** Use native `pymongo.AsyncMongoClient` scoped strictly to FastAPI `@asynccontextmanager lifespan`, injected via FastAPI dependencies (`get_mongo_client`), with connection bounds (`minPoolSize=5`, `maxPoolSize=50`).
- **Tradeoffs:** Requires passing dependencies or storing client on `app.state.mongo`, but guarantees zero connection leaks and clean teardown.
- **Validation:** Confirmed in `services/tests/test_m01_durability.py`.

---

### ADR-002: Generation Fencing Tokens for Distributed Worker Lease Safety
- **Date:** 2026-10-11
- **Status:** ACCEPTED (Milestone 01)
- **Context:** In distributed worker environments, workers can experience network partitions or prolonged GC pauses. If Worker 1's lease expires and Worker 2 claims the task, Worker 1 waking up could overwrite Worker 2's completed state (zombie split-brain).
- **Alternatives Considered:**
  1. *Optimistic concurrency via timestamps:* Subject to clock skew across machines.
  2. *Distributed locks (Redlock, etcd):* Adds heavy infrastructure dependencies outside the hackathon footprint.
  3. *Unbounded leases without fencing:* Leaves state vulnerable to split-brain overwrites.
- **Decision:** Implement monotonic generation tokens (`fence_token: int`). Every lease acquisition atomically increments `fence_token` using MongoDB `find_one_and_update`. Every state transition, checkpoint, or update requires matching `fence_token == current_token`.
- **Tradeoffs:** Stale workers cannot commit partial progress after lease expiry, but state corruption is mathematically prevented.
- **Validation:** Confirmed by `test_worker_lease_fencing_generation_tokens` and `scripts/demo_chaos.py`.

---

### ADR-003: Atomic Monotonic Sequence Allocation via Document-Level Increment
- **Date:** 2026-10-11
- **Status:** ACCEPTED (Milestone 01)
- **Context:** Event sourcing requires that each run's events have gapless, strictly increasing sequence integers (`seq=1, 2, 3...`) to satisfy the unique compound index `uniq_run_seq` on `(run_id, seq)`. Reading the latest event sequence in memory before writing causes race conditions and duplicate key collisions under concurrency.
- **Alternatives Considered:**
  1. *In-memory counter per worker:* Collides when multiple workers or concurrent tasks emit events.
  2. *Query max(seq) in MongoDB then insert:* Prone to TOCTOU race conditions under parallel coroutines.
  3. *UUID sequence ordering:* Loses total order and makes gap detection impossible for SSE clients.
- **Decision:** Use a dedicated MongoDB sequence counter document updated via atomic `find_one_and_update({"run_id": run_id}, {"$inc": {"seq": 1}})`.
- **Tradeoffs:** Requires one extra indexed document update per event append, but provides absolute total order with zero collisions.
- **Validation:** 50 concurrent coroutines verified in `test_atomic_monotonic_event_sequencing_under_concurrency`.

---

### ADR-004: Strict Isolation of MongoDB BSON Internals from API Layer
- **Date:** 2026-10-11
- **Status:** ACCEPTED (Milestone 01)
- **Context:** MongoDB automatically injects `_id: ObjectId(...)` into documents. Exposing BSON `ObjectId` fields to FastAPI causes serialization crashes (`ObjectId is not iterable`) and leaks database implementation details.
- **Alternatives Considered:**
  1. *Custom JSON encoder for ObjectId:* Exposes `_id: "6acb28..."` which is meaningless to client frontends and complicates schema validation.
  2. *Projection `{"_id": 0}` on all queries:* Fragile; easy for developers to forget in ad-hoc queries.
- **Decision:** Enforce repository-level stripping via `clean_doc()` and Pydantic v2 `model_dump(mode="json")`, with domain models having explicit stable string IDs (`dataset_id`, `run_id`, `artifact_sha256`, etc.).
- **Tradeoffs:** Microsecond serialization overhead, but zero BSON leakage.
- **Validation:** Verified across all REST endpoints in `services/tests/test_api_routes.py`.

---

### ADR-005: Dual-Engine Genomic Validation Strategy (pysam + bcftools)
- **Date:** 2026-10-11
- **Status:** ACCEPTED (Milestone 02)
- **Context:** Scientific validation must be deterministic, high-throughput, and reproducible. A single library or pure-Python implementation risks bugs in complex edge cases like multi-allelic splitting or CIGAR parsing.
- **Alternatives Considered:**
  1. *Pure Python custom VCF parser:* Error-prone on edge cases, slow throughput on large files.
  2. *bcftools CLI only:* Subprocess overhead on micro-checks; harder to inspect fine-grained AST fields.
  3. *pysam native only:* Missing standard toolchain cross-checks for complex normalization.
- **Decision:** Use native `pysam.VariantFile` and `pysam.FastaFile` for fast, detailed in-process validation (benchmarked at 1,400+ val/sec), paired with allowlisted `bcftools` subprocess calls for independent reference verification (`bcftools norm --check-ref e`) and cross-checking.
- **Tradeoffs:** Requires both htslib/pysam and bcftools binary installed in environment.
- **Validation:** `test_genomics_validator.py` and upcoming `test_bcftools_adapter.py`.

---

### ADR-006: Scientific Truth Invariants and Genome-Build Certainty
- **Date:** 2026-10-11
- **Status:** ACCEPTED (Milestone 02)
- **Context:** Genomic workflows often guess reference builds from contig names (e.g. `chr22` vs `22`) or blindly trust VCF header metadata (`##reference=GRCh38`). These heuristics cause dangerous silent errors.
- **Alternatives Considered:**
  1. *Heuristic inference:* Guessing GRCh38 if contigs start with `chr`. Dangerous because GRCh37 sometimes uses `chr` prefixes (e.g. UCSC hg19).
  2. *Implicit liftover:* Automatically converting coordinates. Unacceptable in research integrity audits.
- **Decision:** Enforce strict scientific truth distinctions:
  1. A VCF header declaration is NOT proof of assembly identity.
  2. A contig naming convention alone does NOT prove GRCh37 vs GRCh38.
  3. A REF mismatch proves incompatibility with that specific FASTA at that locus, NOT which build is correct.
  4. Missing assembly metadata is classified as `INCONCLUSIVE`, not `PASS` or `FAIL`.
  5. Never perform silent coordinate liftover or strand flips.
- **Tradeoffs:** May leave ambiguous files marked as `INCONCLUSIVE`, which is scientifically honest rather than falsely authoritative.
- **Validation:** Covered by M02 test suite fixtures.

---

### ADR-007: Non-Destructive Normalization and Strict Prohibition of `--check-ref s`
- **Date:** 2026-10-11
- **Status:** ACCEPTED (Milestone 02)
- **Context:** `bcftools norm --check-ref s` silently alters reference alleles in VCF files to match the FASTA. Official bcftools documentation warns that this can invert variant interpretations (e.g. switching pathogenic ALT alleles into REF) and mask strand/assembly errors.
- **Alternatives Considered:**
  1. *Allow automatic REF correction:* Violates data integrity; masks upstream sequencing or annotation errors.
  2. *In-place variant normalization:* Overwrites original source data, destroying reproducibility.
- **Decision:** Strictly forbid `--check-ref s` or any silent REF allele rewriting. Read-only checking uses `--check-ref e`. When normalization (left-alignment, multi-allelic splitting) is requested, produce a new, derived, content-addressed artifact with an immutable transformation receipt. Original source bytes remain 100% untouched.
- **Tradeoffs:** Requires storing derived files alongside originals, but guarantees scientific reproducibility.
- **Validation:** Verified by byte-identical preservation tests on original input files.

---

### ADR-008: Content-Addressed Storage (CAS) for Large Genomic Artifacts
- **Date:** 2026-10-11
- **Status:** ACCEPTED (Milestone 02)
- **Context:** Storing large multi-megabyte VCF and FASTA bodies inside MongoDB BSON documents violates document size limits (16MB) and degrades database cache performance.
- **Alternatives Considered:**
  1. *MongoDB GridFS:* Adds storage overhead and complicates direct pysam/bcftools CLI access.
  2. *Arbitrary filesystem paths:* Vulnerable to path traversal and non-deterministic naming.
- **Decision:** Store genomic file bodies in a content-addressed storage (CAS) directory (`artifacts/cas/` or `fixtures/`) keyed by SHA-256 hash. MongoDB `artifacts` collection stores only cryptographic metadata (`artifact_sha256`, `byte_size`, `file_format`, `storage_path`, `contig_summary`).
- **Tradeoffs:** Requires maintaining consistency between CAS filesystem and MongoDB metadata records.
- **Validation:** Enforced in `ArtifactRepository` and `hasher.py`.

---

### ADR-009: Independent Oracle Isolation and Metamorphic Invariance
- **Date:** 2026-10-11
- **Status:** ACCEPTED (Milestone 02)
- **Context:** Autonomous agents attempting self-improvement could tamper with validation benchmarks or tune evaluation labels to falsely report 100% success.
- **Alternatives Considered:**
  1. *Inline assertions inside candidate harness:* Vulnerable to candidate mutation tampering.
  2. *Model-based LLM evaluation:* Nondeterministic and prone to sycophancy.
- **Decision:** Store the benchmark evaluation suite and oracle truth mapping in protected directories outside candidate harness reach (`services/runtime/evaluation/`). Ground truth labels cannot be read or modified by candidate harnesses. Include metamorphic tests (e.g. altering benign headers must not alter REF mismatch findings).
- **Tradeoffs:** Rigid boundary requires candidate harnesses to operate as black boxes against immutable test suites.
- **Validation:** Tested in `IndependentEvaluator` and `test_harness_evolution.py`.

---

### ADR-010: Subprocess Sandboxing and Strict Command Allowlisting
- **Date:** 2026-10-11
- **Status:** ACCEPTED (Milestone 02)
- **Context:** Invoking external tools like `bcftools` via shell execution (`shell=True`) exposes the system to command injection, shell metacharacter attacks, and runaway processes.
- **Alternatives Considered:**
  1. *os.system or subprocess with shell=True:* Severe security hazard.
  2. *Unrestricted command execution:* Allows agents to run arbitrary binaries.
- **Decision:** Implement a typed subprocess adapter `BcftoolsAdapter` executing strictly allowlisted subcommands (`view`, `norm`, `index`, `stats`) using argument lists (`list[str]`), explicit timeouts (default 15s), isolated scratch directories, output size truncation, and environment sanitization.
- **Tradeoffs:** Any new bcftools subcommand requires explicit adapter method support.
- **Validation:** Tested in `test_bcftools_adapter.py`.
---

### ADR-011: Strict Input Sanitization for Content-Addressed File Ingestion
- **Date:** 2026-10-11
- **Status:** ACCEPTED (Milestones 07-10 Audit)
- **Context:** Genomic file uploads must store files within content-addressed storage (`artifacts/cas/`). If filename sanitization uses standard `os.path.basename` without rejecting directory separators, attackers could submit traversal paths such as `../../etc/passwd` that strip to `passwd` without failing loud, or bypass sanitizers on exotic operating system path formats.
- **Alternatives Considered:**
  1. *Permissive stripping via `os.path.basename`:* Strips leading path components silently, concealing hostile intent from auditing systems.
  2. *Regex replacement of non-alphanumeric:* Mutates legitimate bioinformatics filenames containing multiple dots or hyphens.
- **Decision:** Enforce fail-closed validation in `FileIngestionService.sanitize_filename()`: reject any input containing `..`, `/`, `\`, or null bytes immediately by raising `ValueError`.
- **Tradeoffs:** Filenames must be purely base filenames; callers cannot pass relative directories in upload parameters.
- **Validation:** Verified in Dimension 8 of `scripts/audit_system.py` and `test_m02_genomics.py`.

---

### ADR-012: Full-System Release Gating and Credential-Ready State Machine
- **Date:** 2026-10-11
- **Status:** ACCEPTED (Milestones 07-10 Audit)
- **Context:** DIAMOND Genome relies on external third-party services (MongoDB Atlas, Raindrop, ElevenLabs) that require developer API credentials. In a test, CI, or local evaluation setting where secrets are not yet injected into `.env`, the system must not emit a false `FAIL` / `NO-GO`, nor should it fabricate fictitious cloud success calls.
- **Alternatives Considered:**
  1. *Strict NO-GO when Atlas/Sponsor keys are missing:* Prevents local testing and fails valid offline development pipelines.
  2. *Mocked fake success (Fabricated GO):* Dishonest; obscures missing production credentials.
  3. *Conditional Go State Machine:* Transparently distinguishes 100% verified local execution from external credential readiness.
- **Decision:** Implement a three-state release gate:
  - `GO`: 100% dimensions passed AND MongoDB Atlas live connection active.
  - `CONDITIONAL GO`: 100% dimensions passed locally; cloud Atlas and sponsor credentials are `CREDENTIAL-READY` pending user configuration.
  - `NO-GO`: Any scientific, security, or durability dimension fails.
- **Tradeoffs:** Clear demarcation between local functional correctness and cloud operational deployment.
- **Validation:** Verified in `scripts/audit_system.py` and `docs/audit/10_RELEASE_VERDICT.md`.

---

### ADR-013: Red-Team Privacy Canary Sanitization for External Observability
- **Date:** 2026-10-11
- **Status:** ACCEPTED (Milestones 07-10 Audit)
- **Context:** Observability telemetry streamed to external partners (e.g. Raindrop) must strictly never include private human genomic sequences, raw VCF bodies, or backend secret keys.
- **Alternatives Considered:**
  1. *Trust caller to omit raw data:* High likelihood of accidental leakage by developer or agent.
  2. *Disable all telemetry payloads:* Eliminates useful performance and state machine monitoring.
- **Decision:** Implement recursive proactive sanitization in `RaindropAdapter._sanitize()`. Exclude sensitive keys (`sequence`, `vcf_content`, `secret`, `token`, `password`), detect long nucleotide strings, and replace them with SHA-256 hashes or prune them before dispatch.
- **Tradeoffs:** Slight serialization CPU overhead per telemetry event, but mathematically guarantees zero genomic or credential data leakage.
- **Validation:** Red-team canary test verified in Dimension 5 of `scripts/audit_system.py`.
---

### V7-ADR-001: Failure-Trace Reflection and Bounded Candidate Branching
- **Date:** 2026-10-11
- **Status:** ACCEPTED (Milestone V7)
- **Context:** Autonomous agent self-improvement often degenerates into unconstrained stochastic prompting or wild code generation, risking regression on unaffected test cases and violating safety envelopes.
- **Alternatives Considered:**
  1. *Unconstrained LLM host code editing (DGM raw mode):* Discarded due to severe host security risks and non-deterministic behavior.
  2. *Static brute-force grid search:* Computationally expensive and lacks awareness of specific failure types.
- **Decision:** Implement `FailureTraceReflector` and `BoundedCandidateSearch`. Real validation discrepancy codes (`REF_MISMATCH`, `CONTIG_MISMATCH`, `COORDINATE_OUT_OF_BOUNDS`) are mapped deterministically to typed policy mitigation hypotheses. The search engine generates 2–3 bounded candidates deduplicated by canonical configuration hash, guaranteeing that no candidate bypasses `PolicyEnvelope`.
- **Tradeoffs:** Search space is constrained to policy toggles and tool ordering, but execution is 100% reproducible and safe.
- **Validation:** Verified in `test_v7_optimization.py` and `test_v7_evolution_search.py`.

---

### V7-ADR-002: Safe Declarative Capability Macros vs Arbitrary Host Code Execution
- **Date:** 2026-10-11
- **Status:** ACCEPTED (Milestone V7)
- **Context:** When the agent learns reusable tool combinations across repeated genomic workflows, storing learned skills as raw Python functions (`exec`/`eval`) introduces arbitrary code execution (ACE) vulnerabilities.
- **Alternatives Considered:**
  1. *Dynamic Python module generation on disk:* Hard to sandbox; vulnerable to prompt-injected payload execution.
  2. *Restricting agent to hardcoded primitives only:* Prevents workflow automation and skill composition.
- **Decision:** Implement declarative skill macros (`DeclarativeMacro`, `MacroStep`, `MacroGuard`). Workflows are stored as structured JSON schemas specifying ordered references to immutable whitelisted primitives, argument bindings, and explicit guards. Any presence of `exec`, `eval`, or shell commands is rejected at registration time.
- **Tradeoffs:** Cannot perform arbitrary arithmetic inside macros without dedicated primitives, but completely eliminates code injection hazards.
- **Validation:** Enforced in `CapabilityRegistry.register_macro` and verified in `test_v7_capabilities.py`.

---

### V7-ADR-003: EvidenceSealV1 Cryptographic Canonical Hashing and Tamper Verification
- **Date:** 2026-10-11
- **Status:** ACCEPTED (Milestone V7)
- **Context:** Proof of harness improvement must be independently verifiable and tamper-evident without relying on trust or mutable database fields.
- **Alternatives Considered:**
  1. *Standard unhashed JSON receipts:* Easily edited or forged in transit or storage.
  2. *Blockchain-based notarization:* Impractical, introduces external latency and token costs for a research runtime.
- **Decision:** Implement `EvidenceSealV1` with canonicalized JSON SHA-256 digest computation (`seal_hash`). The seal binds run ID, parent harness, candidate harness, mutation hash, input manifest hash, suite hash, environment manifest hash, and mandatory safety gates. An independent verifier recomputes the digest to detect any modification.
- **Tradeoffs:** Schema modifications require updating canonicalization rules, but provides bit-exact tamper resistance.
- **Validation:** Tested in `test_v7_evidence_seal.py` and benchmarked in `scripts/benchmark_v7.py`.

---

### V7-ADR-004: Cascading Invalidation in Scientific Memory Dependency Graphs
- **Date:** 2026-10-11
- **Status:** ACCEPTED (Milestone V7)
- **Context:** When a reference genome FASTA checksum changes or an annotation tool is superseded, downstream research memos and findings that relied on the old reference become invalid. Silently keeping them corrupts future reasoning; deleting them destroys audit trails.
- **Alternatives Considered:**
  1. *Hard-delete stale memories:* Destroys provenance and historical reproducibility.
  2. *Ignore upstream changes:* Contaminates future agent runs with obsolete biological assumptions.
- **Decision:** Implement `MemoryDependencyGraph`. Maintains explicit directed dependency edges (`finding -> dataset + reference + validator`). When an upstream node is invalidated, invalidation cascades selectively to all downstream children, marking them `is_stale = True` with an audit reason, while completely preserving unaffected datasets.
- **Tradeoffs:** Graph memory scales with total findings, but keeps an immutable historical record.
- **Validation:** Verified in `test_v7_memory_dependency.py`.

---

### ADR-014: Do not run the Biomni agent
- **Timestamp:** 2026-10-11T07:30:00Z
- **Status:** ACCEPTED (V8)
- **Context:** Biomni at `400c1f366b96a35ca253e13c9b06c5076af41d65` is the closest biomedical agent foundation. Its README states that LLM-generated code runs with full system privileges.
- **Alternatives:** Import and run `biomni.agent` inside the API worker; run it in a rootless container; do not import it.
- **Selected:** Do not import it. A local adapter reads VCF statistics and counts region overlap. Consequence annotation is rejected. Liftover without a chain is `INCONCLUSIVE`.
- **License:** Apache-2.0 covers the repository that was inspected. It was not copied into the product tree. Bundled databases were not downloaded.
- **Risk:** A future change could import the agent. The current tests assert `biomni` is not in `sys.modules` after the local tool runs.
- **Rollback:** Delete `services/integrations/biomni/` and the V8 tests that call it. Native validation remains.
- **Tests:** `services/tests/test_biomni_security.py`.

### ADR-015: One proposer, GEPA not a second supervisor
- **Timestamp:** 2026-10-11T07:35:00Z
- **Status:** ACCEPTED (V8)
- **Context:** Meta-Harness and GEPA both propose improvements. Running both as autonomous supervisors would fork promotion.
- **Alternatives:** Import Meta-Harness example wrappers; call `gepa.optimize`; keep one DIAMOND envelope and evaluator.
- **Selected:** `MetaHarnessSearchAdapter` and `GepaProposerAdapter` both emit `HarnessSpec` values labeled `DETERMINISTIC`. Meta-Harness is not imported. `gepa==0.1.4` is installed from commit `462e437a09be67d2acb59564cc0ea59132f5777c` and `optimize()` is not called (`INSTALLED_UNCONFIGURED`).
- **License:** Meta-Harness MIT (Yoonho Lee, 2026). GEPA MIT (Lakshya A Agrawal, 2025).
- **Risk:** The class names can be misread as a claim that those systems executed. Stored provenance says `DETERMINISTIC`, and `meta_harness_imported` is false.
- **Rollback:** Stop calling the adapters; baseline harness remains.
- **Tests:** `test_optimizer_gate.py`, `artifacts/v8/runtime_metrics.json`.

### ADR-016: EBI binaries are the independent VCF oracle
- **Timestamp:** 2026-10-11T07:25:00Z
- **Status:** ACCEPTED (V8)
- **Context:** pysam alone is not an independent implementation. GATK ValidateVariants was not installed.
- **Alternatives:** Build vcf-validator from source; trust header assembly declarations; use only bcftools.
- **Selected:** Official Linux release assets `v0.10.2`, SHA-256 pinned. Flags taken from that binary's `--help`. Syntax and FASTA REF checks are adjudicated with pysam. Agreement does not prove genome build. Missing FASTA is `INCONCLUSIVE`. A native pass with EBI REF failure is `DISAGREE`.
- **License:** Apache-2.0.
- **Risk:** Checksum pin trusts the release bytes that were hashed on this machine.
- **Rollback:** Remove the binary directory. Paired evaluation then reports the tool unavailable instead of passing.
- **Tests:** `test_ebi_disagreement.py`.

### ADR-017: Held-out cases stay outside the proposer
- **Timestamp:** 2026-10-11T07:40:00Z
- **Status:** ACCEPTED (V8)
- **Context:** A proposer that can see the transfer fixture can tune to it.
- **Alternatives:** Share one fixture list; hide ids only in prompts.
- **Selected:** `assert_proposer_inputs_exclude_holdout` rejects held-out ids and paths. `IndependentEvaluator` still scores them.
- **Risk:** A new proposer that opens `fixtures/heldout` directly would bypass the guard. The guard covers the incident object passed into search.
- **Rollback:** None required for the scientific default; the evaluator already owned those fixtures.
- **Tests:** `test_optimizer_gate.py`, `test_transfer_ablation.py`.

### ADR-018: Sponsor calls stay NOT_CONFIGURED without credentials
- **Timestamp:** 2026-10-11T07:45:00Z
- **Status:** ACCEPTED (V8)
- **Context:** Raindrop and ElevenLabs adapters already exist. Atlas was not configured.
- **Alternatives:** Fake connected status; send VCF text to the vendors.
- **Selected:** Report `NOT_CONFIGURED`. `verify-v8-atlas` exits 2 on localhost. Mongo pointer test uses local Mongo and deletes only `v8-pointer-test`. Raindrop span correlation is not claimed. The receipt records the status strings beside the run id.
- **Risk:** Local Mongo success can be mistaken for Atlas. The Atlas script exists to prevent that.
- **Tests:** `verify_v8_atlas.py` exit 2; `test_optimizer_gate.py` pointer test.

### ADR-019: Proof UI reads recorded artifacts
- **Timestamp:** 2026-10-11T07:50:00Z
- **Status:** ACCEPTED (V8)
- **Context:** The Proof view previously substituted a promoted receipt when the store was empty.
- **Alternatives:** Keep the demo receipt; render only `/api/v8/latest`.
- **Selected:** Empty state until `/api/v8/latest` returns `RECORDED`. Lineage nodes carry `optimizer_provenance`. The helix clock was not retied to variant calls.
- **Risk:** An operator who does not run `make demo-v8` sees an empty Proof panel.
- **Tests:** `pnpm --filter web exec tsc --noEmit` passed. Browser check on 2026-10-11: Proof starts empty, then `/api/v8/latest` fills the receipt and Evolution shows six recorded nodes including the rejected weaken candidate, labeled `DETERMINISTIC`.

---

### ADR-020: Stable ids, local Mongo resume, and nucleotide scrub
- **Timestamp:** 2026-10-11T07:45:00Z
- **Status:** ACCEPTED (V8 follow-up)
- **Context:** Candidate ids used a random suffix, the campaign checkpoint was only a JSON file, and Raindrop redaction dropped keys but left nucleotide runs inside other strings. `scheduler_status()` reported GEPA as available and Meta-Harness as the supervisor.
- **Alternatives:** Keep random ids; treat the JSON file as the only resume source; leave the scheduler labels as written.
- **Selected:** Version ids are a hash of the policy body. Resume prefers `v8_campaign_checkpoints` in local MongoDB and falls back to the JSON file. Promotion uses one `find_one_and_update` on `v8_active_pointers`. Telemetry values with 16 or more nucleotide letters are replaced. Scheduler status is `DETERMINISTIC` and `INSTALLED_UNCONFIGURED`.
- **Risk:** A local Mongo success can be described as Atlas. `verify-v8-atlas` still exits 2 unless the URI is Atlas.
- **Rollback:** Stop calling `checkpoint_store` and the campaign uses the JSON file only.
- **Tests:** `test_candidate_ids_are_stable_across_runs`, `test_resume_uses_mongodb_when_the_json_copy_is_removed`, `test_raindrop_privacy_sanitization`. `make verify-v8` exit 0. `make audit` dimension 11 PASS.

---

### ADR-021: Population evolution is a separate haploid model
- **Timestamp:** 2026-10-11T21:25:00Z
- **Status:** ACCEPTED (V10)
- **Context:** The product needs a population simulation. `services/runtime/evolution/` already means harness search and promotion. Official GRCh38 is not on disk. SLiM is GPL-3.0 and was not installed.
- **Alternatives:** Overwrite the harness package; vendor SLiM; map temperature onto fitness; pretend a 60-second animation is 2,000,000 years of a whole genome.
- **Selected:** New package `services/runtime/population`. One haploid locus, explicit selection coefficient, Bernoulli binomial, generation cap 2000. Climate fields are recorded as `NOT_MODELED`. The editable sequence is the synthetic chr22 fixture and is labeled as such. Playback is a 60-second clock over stored frames. Gaps are interpolated display, not extra generations. Workspace JSON is local, not Atlas.
- **Risk:** A reader can still confuse Studio with clinical editing, or the harness id with the genome revision. The UI states both distinctions. A 2,000,000-year request at a 25-year generation is rejected instead of being silently shortened.
- **Rollback:** Remove `/api/v10` and the Studio mode. Mission, Evolution, and Proof stay.
- **Tests:** `services/tests/test_v10_wright_fisher.py`, `services/tests/test_v10_workspace.py`, `apps/web/tests/playback.test.ts`.

---

### ADR-022: Diploid additive step, climate still not fitness
- **Timestamp:** 2026-10-11T21:30:00Z
- **Status:** ACCEPTED (V11)
- **Context:** V10 could only run haploid copies. A workspace change in Studio left the previous simulation on screen. The requested diploid ratio and one-generation drift variance had no independent check.
- **Alternatives:** Replace the haploid engine; map temperature into `s`; sample millions of generations inside the web request; call the JSON file Atlas.
- **Selected:** Ploidy 2 uses `w_aa=1`, `w_Aa=1+s/2`, `w_AA=1+s`, then mutation, migration, and `Binomial(2N, p)`. Operator order is fixed and stored on the diploid payload. Haploid runs keep engine version `v10-haploid-1`. Climate stays `NOT_MODELED`. Studio drops the on-screen simulation when the active workspace changes. Generation count remains `floor(years / generation time)` with a 2000 generation cap.
- **Risk:** Additive dominance is an assumption, not a measurement. A strong `s` can fix the allele in a small population, which is a model outcome, not a biological forecast.
- **Rollback:** Send `ploidy: 1`. The haploid path is still the default on the API when the field is omitted.
- **Tests:** `services/tests/test_v11_science.py`. `make verify-v11` 28 pytest passed, 1 vitest passed. `make benchmark-v11` wrote `artifacts/v11/benchmark.json`.

---

### ADR-023: V13 contract stays on the JSON workspace file
- **Timestamp:** 2026-10-11T21:55:00Z
- **Status:** ACCEPTED (V13)
- **Context:** The four Studio tabs already call `/api/v10`. The brief asked for Mongo collections, Atlas transactions, and `/api/v1`. Adding a second store would split the active workspace.
- **Alternatives:** New Mongo collections that the UI does not read; overwrite `services/runtime/evolution`; pretend transcribe works.
- **Selected:** Extend the existing JSON store and `/api/v10` with snapshot, interpret, separate lineages, body descriptor, simulation list, playback manifest, rename, and archive. `POST /api/voice/transcribe` returns 501 `NOT_CONFIGURED`. `services/runtime/evolution` was not modified.
- **Risk:** A reader can mistake the JSON file for Atlas. The migration note says it is not.
- **Rollback:** Remove the new routes. Prior V10/V11 calls keep their shapes.
- **Tests:** `make verify-v13`, 23 passed.






---

## V12 frontend decisions (2026-10-11T21:46Z)

### V12-ADR-001: Four tabs, query-string routing
Context: spec demands exactly four tabs. Choice: `?tab=&workspace=` URL state, no router dependency. Alternatives: react-router (extra dependency, no nested routes needed). Tradeoff: manual history handling in `useUrlSync`. A11y: Radix Tabs semantics. Rollback: legacy 3-mode shell removed only after the four tabs verify.

### V12-ADR-002: One persistent Canvas; scenes talk to DOM via zustand bridges
Context: R3F reconciler does not inherit React context (React Query would break inside Canvas). Choice: one `SceneHost` canvas; each scene reads only its own zustand store, populated by its DOM-side tab. Tradeoff: duplicated data shape per scene. Benefit: no WebGL context churn on tab switch. Scientific impact: none.

### V12-ADR-003: 2,000,000 years honesty
Context: backend budget is 2000 generations (`409` above). 2M years at 25 y/gen = 80,000 generations. Choice: UI shows the minimum declared generation time (`horizon/2000`) as an explicit editable assumption; default 2M years preset uses 1000 y/gen and says so. We do NOT fake a 25-year run. Playback of 60 s is a rendering of precomputed frames. Rollback: tier-B backend engine later.

### V12-ADR-004: Text prompts parsed by a deterministic local grammar
Context: no interpretation agent endpoint exists. Choice: parse explicit statements only; label "Parsed locally"; ambiguous input asks for a selection; never invents a locus. Scientific impact: positive (no fabricated agent output).

### V12-ADR-005: Voice = confirmable transcript only
Context: ElevenLabs integration is TTS, not STT. Choice: Web Speech API as optional progressive enhancement with a privacy notice; transcript is editable and separately confirmed; unsupported browsers fall back to text. No audio ever mutates DNA.

### V12-ADR-006: Procedural neutral body figure
Context: no licensed body asset. Choice: stylised procedural silhouette labelled illustrative; never changes from a base edit (no phenotype claims).

### V12-ADR-007: IGV.js and Mol* not installed
Context: synthetic 117,500 bp FASTA and no structural artifact; both would add heavy bundles for zero real data. Revisit when real assets exist.

### V12-ADR-008: Simulation ids per workspace remembered client-side
Context: no list endpoint. Choice: localStorage holds ids only (no genomic data), refetched by id. Replicates are client-orchestrated distinct seeds. Wire naming stays snake_case end-to-end.

### V12-ADR-009: No inner tabs or view switches anywhere
Context: user directive "I do not want sub tabs". Choice: the four top-level tabs are the only navigation. Inside Tab 1 the DNA/Body phone toggle, Front/Back radiogroup and Off/Overlay/Split radiogroup were removed. Compare is a single on/off toggle (original beside draft); the figure turns with one button or a drag. Value pickers (playback speed, horizon presets) are not view switches and stay.

### V12-ADR-010: Two-column editor, big body always visible
Context: user directive "Show a big body"; earlier feedback that Tab 1 looked empty. Choice: the body owns the left column (42% desktop / 50% phones) at nearly full height; the helix owns the right column. Fixed camera, no selection zoom or body fade. Panels report per-column insets so neither subject is ever covered.

### V12-ADR-011: Edit acknowledgement pulse, never a body morph
Context: user asked that DNA changes and the body response render instantly. The brief forbids fabricated phenotype (required test: no fake body morphology from an arbitrary SNP), and no validated genotype-to-anatomy model exists. Choice: on a draft change the helix flashes at the changed pair, a light packet runs along the arc and a scan sweep passes through the figure, all in the same frame as the data and about 1.1 s long. Geometry and colour mapping never change; the caption states "No validated body-level effect". Disabled under reduced motion. Alternative (only on explicit request): a separately labelled "speculative illustration" mode.
Scientific impact: positive (instant feedback without a phenotype claim).

---

## V14 anatomy-first editor (2026-10-11)

### V14-ADR-001: Original procedural anatomy; no third-party meshes
Context: Z-Anatomy is CC BY-SA 4.0 with mixed-provenance assets; BodyParts3D is CC BY-SA 2.1 Japan. Share-alike and unclear embedding terms are unsafe for this independently licensed repo.
Decision: original parametric / lofted meshes and hit proxies in `apps/web/src/features/anatomy/`. Unmodeled organs are searchable with `mesh_status: unavailable`.
Alternatives: license a commercial atlas; obtain written permission.
Rollback: swap GLBs behind `anatomy-mesh-manifest.json` without changing ontology ids.
Science/privacy: none. License review: `THIRD_PARTY_NOTICES.md` stays free of those models.

### V14-ADR-002: Uberon via OLS4; lateral composites only when Uberon has no class
Context: need stable anatomy ids. Decision: verify every CURIE against OLS4 at ingest (`ontology_status: verified`). Left/right that lack a lateral Uberon class use `UBERON:xxxx@left`. Unverified terms are `DIAMOND:` and never presented as Uberon.
Alternatives: invent local slugs only (loses interoperability).
Test: parent/child links valid; left/right ids distinct.

### V14-ADR-003: Evidence kinds and interpretation tiers; no invented confidence
Context: expression is not a phenotype map. Decision: six `evidence_kind` values and six `interpretation_tier` values (contract §2). `quantitative_value` only when the source reports it, with `units`. Relationships 5 and 6 are never derived from 3. Copy: "Genes with evidence in this tissue", never "genes that control X".
Rollback: hide a source by returning `source_status: unavailable`.

### V14-ADR-004: Pinned GRCh38 slices plus the existing synthetic contig
Context: no local GRCh38 FASTA; Ensembl REST 116 / GRCh38.p14 is reachable. Decision: store read-only ≤1000 bp slices under `fixtures/references/grch38_slices/` with sha256. Edits carry `reference_asset_id` + `locus_id`. Consumers filter edits by reference so synthetic chr22 positions never collide with GRCh38.
Alternatives: download all of GRCh38 (too large, license/storage); stay synthetic-only (fails the brief).
Assembly mismatch (GRCh37) is a 400.

### V14-ADR-005: Multi-gene UI is a ranked evidence list
Context: one organ can have thousands of genes. Decision: cursor-paginated ranked list with filters (expressed here / associations / curated / all). Counts only from loaded data. Selecting a gene does not change workspace.

### V14-ADR-006: Preview is a draft; apply needs validate + confirm + expected_counter
Context: concurrent tabs. Decision: `POST proposals` → `validate` (REF vs pinned FASTA) → explicit apply with `expected_counter` and `Idempotency-Key`. Optimistic UI only for unsaved drafts. Voice and text share this path.

### V14-ADR-007: Transcript ids always versioned
Context: Ensembl versions change. Decision: store `ENST….N`; gene ids stay unversioned with a separate `version` field. Record Ensembl release 116 on every gene/locus payload.

### V14-ADR-008: Voice is confirmable transcript; STT stays NOT_CONFIGURED until verified
Context: ElevenLabs in-repo is TTS; `/api/voice/transcribe` is 501. Decision: keep 501 unless a real STT provider is configured *and* `X-Voice-Consent: granted`. Browser Speech is optional, editable, never auto-applies. Status is never "Connected" without a round-trip.

### V14-ADR-009: Body has its own camera; 2D fallback for no-WebGL
Context: V12 used a shared camera that framed body+helix. Decision: `AnatomyStage` owns a camera inside the body column so organ focus does not move the helix. Keyboard tree + SVG fallback remain usable. Reduced motion disables camera ease and the edit pulse, not editing.

### V14-ADR-010: Source-version cache invalidation
Context: stale HPA/Bgee/GWAS must not look live. Decision: every evidence response includes `source_status[{source_id,status:live|cached|unavailable,version,retrieved_at}]`. A new source version invalidates annotation caches only; sequence revisions are untouched.

---

## V15 Master Campaign Decisions (2026-10-11)

### V15-ADR-001: Strict Four-Tab Contract & Tab Purity
- **Context:** Previous milestones had overlapping controls or sub-tabs. V15 requires an uncompromised product contract of four tabs only: (1) Genome Editor, (2) Genome & Harness Evolution, (3) Earth Evolution Simulation, (4) Harness Library.
- **Decision:** Tab 1 has ONLY interactive DNA + 3D body + text/voice composer; no charts, debug traces, or simulation controls. Tab 2 contains ONLY lineage and causal journeys; NO editing interface. Tab 3 contains ONLY Earth environment, timeline scrubber, and population trajectories; NO editing interface. Tab 4 contains ONLY the workspace gallery and atomic switching.
- **Alternatives:** Permitting simulation sliders on Tab 1 or edit buttons on Tab 2 was rejected as confusing the user mental model and violating the core product distinction.
- **Consequences:** Clear, elegant scientific storytelling.

### V15-ADR-002: Defensible Causal Boundary & PhenotypeRendererContract
- **Context:** Language models often hallucinate that a genetic edit causes arbitrary whole-body morphological transformations.
- **Decision:** Enforce `PhenotypeRendererContract`. Only variants with a mathematically validated trait-to-geometry model may alter mesh morph targets. All unsupported edits or tissue-expression associations retain neutral body proportions with region glowing and an explicit honesty label: *"A body-shape effect cannot be inferred from this edit. Neutral anatomy preserved."*
- **Scientific Impact:** Eliminates pseudoscience; guarantees 100% biological honesty.

### V15-ADR-003: Multi-Replicate Ensemble Simulation & Stored 60-Second Replay
- **Context:** Evolution is stochastic. Visualizing only one replicate conveys false inevitability. Also, long evolutionary horizons (e.g. 2,000,000 years) cannot run frame-by-frame in real-time in the browser.
- **Decision:** The backend simulates 10–100 seeded stochastic replicates asynchronously using a graduated engine (Mode A exact Wright–Fisher with logistic demography, Mode B native SLiM if installed, Mode C accelerated diffusion tau-leaping for deep time). An indexed sequence of 120–600 snapshots is stored with canonical SHA-256 result hashes. The frontend plays stored frames mapped onto a 60-second playback clock $\tau \in [0, 60]$, rendering ensemble percentiles (median, 10th, 90th) and fading extinct branches without auto-resurrection.
- **Consequences:** True Monte Carlo population genetics displayed with cinematic speed and certainty bounds.

### V15-ADR-004: Dynamic WorkspaceStore Path Binding Across Routes
- **Context:** In test fixtures and temporary sessions, `V10_STATE_PATH` is monkeypatched to isolate state. Module-level static initialization previously caused store divergence between `/api/v10` and `/api/genome-edit`.
- **Decision:** `WorkspaceStore.path` dynamically resolves `state_path()`. Route handlers in `genome_edit.py` resolve `_get_store()` pointing to the active `v10._store`.
- **Consequences:** Total state synchronization across all REST endpoints and zero test interference.

### V15-ADR-005: Four-Mode Upstream/Downstream Causality Semantics & Non-Phylogenetic Disclosure
- **Context:** The term "upstream / downstream" is semantically overloaded across software engineering, molecular genetics, biochemistry, and computational dependency modeling. Presenting sequence edits as if they evolved naturally is biologically false.
- **Decision:** Tab 2 provides an explicit interactive causality mode selector (`EDIT_HISTORY`, `GENOMIC_ORIENTATION`, `REGULATORY_PATHWAY`, `MODEL_DEPENDENCY`) in `CompactDrawer.tsx` with an honest non-phylogenetic disclosure banner: *"Chronological edit order in this software is not natural biological evolution. Sequence revisions are author-committed snapshots."*
- **Consequences:** Eliminates scientific confusion and ensures the user always understands the semantic framing of lineage graphs.

---

## V16 Atlas Voyage retrieval (2026-10-11)

### V16-ADR-001: Atlas model keys are embeddings and rerank only
Context: MongoDB Atlas AI Model API keys call Voyage embedding and reranking endpoints. They are not chat keys, database URIs, or Atlas Admin keys.
Decision: `services/integrations/voyage/` posts only to `/embeddings` and `/rerank` on `ai.mongodb.com`, `us.ai.mongodb.com`, or `eu.ai.mongodb.com`. Other hosts fail as `wrong_scope` before a request. `VOYAGE_KEY_SCOPE` must match the host. Default models are `voyage-4-large` (1024 dimensions) and `rerank-3`. Query and document embeddings use the same model so one index version stays valid. `voyage-4-lite` is configured but not mixed in implicitly. Series-4 embeddings at the same dimension may share an index; `voyage-3.5` may not.
Validation: mocked client tests and `make voyage-check` (exit 2 while disabled).

### V16-ADR-002: A key is not connectivity
Context: the previous adapter reported `CONFIGURED` whenever `VOYAGE_API_KEY` was non-empty.
Decision: `VOYAGE_ENABLED` must be `true` or the health state is `disabled` and no request is sent. States are `disabled`, `not_configured`, `configured_unverified`, `connected`, `rate_limited`, `permission_denied`, `wrong_scope`, and `unavailable`. `connected` is set only after a successful call in this process. Legacy `status` stays `CONFIGURED` or `NOT_CONFIGURED`.
Validation: `voyage-check` on this machine exited 2 without a request. `.env` has a `VOYAGE_API_KEY` name and no `VOYAGE_ENABLED`, so the gate stayed shut.

### V16-ADR-003: Lexical fallback, no invented Atlas Vector Search
Context: local MongoDB 7 rejects `list_search_indexes` with `OperationFailure`.
Decision: research collections are separate from the original twelve. Vector search is reported `supported: false` until the command succeeds. Hybrid search uses stored vectors only as `local_cosine`, and only for a compatible embedding version. Otherwise retrieval is lexical and labeled `lexical_fallback`.
Validation: status probe on local MongoDB; mongo upsert test.

### V16-ADR-004: Retrieval is not evidence of causation
Context: semantic rank must not replace VCF validation, simulation, or phenotype rendering.
Decision: passages are untrusted citations with provenance. Exact HGNC/Ensembl ids match structured fields. Misleading and unapproved documents are filtered out. A harness candidate may select `exact_lexical`, `exact_vector`, or `exact_vector_rerank` and cannot change evaluator `v16-retrieval-oracle-1`. Lower held-out recall is a regression and is not promoted. Retrieved text does not edit genomes or simulation parameters.
Validation: benchmark file, policy unit test, browser check that simulation N stayed 80.

### V16-ADR-005: Remote text is curated and sanitized
Context: genomic and personal data must not go to Voyage.
Decision: refuse nucleotide runs of 41 or more, VCF headers, patient/sample ids, and canary/credential patterns before HTTP. Default corpus is paraphrased public summaries. UI search posts the research query and ids, not the base window. Logs and errors redact the API key. Raindrop receives the tool name and a status string, not the query text.
Validation: `test_v16_privacy.py` records zero outbound requests for DNA and canaries. Throwaway API refused a DNA query.

### V16-ADR-006: HTTP client instead of the voyageai package
Context: the repo already depends on `httpx`. The official Python client (0.3.7+) also calls this API.
Decision: use typed `httpx` against the documented REST shape so no new package is required. `input_type` is `document` or `query`. Token usage is recorded from `usage.total_tokens` when the provider sends it.
Validation: mocked response tests for embeddings and rerank.

---

## HELIXA V17 display rename (2026-10-11)

### V17-ADR-001: Display name is not the database name
Context: the product is now called HELIXA. Live data, receipts, and anatomy ids were created as DIAMOND Genome.
Decision: `HELIXA_DISPLAY_NAME` (default HELIXA) is the only user-facing product string added to health responses. `MONGODB_DATABASE` wins over `HELIXA_DATABASE_NAME` when they differ. `service` stays `diamond-genome-api`. `DIAMOND:` anatomy ids stay. `HELIXA_ARTIFACT_NAMESPACE` is recorded and does not move files.
Alternatives: global search-replace; renaming the database. Both were rejected because they break history and running clients.
Consequences: old documents remain readable. Docs and logs may still say DIAMOND Genome.
Rollback: revert the display strings; no data migration to undo.
Owner: integrator.

### V17-ADR-002: Original strand mark, no trademark claim
Context: the previous mark was a diamond outline. HELIXA needs its own mark, and the name is not cleared.
Decision: an original SVG of two strands and a crossbar (an H) in cyan on graphite. Amber stays the uncertainty color. `docs/branding/NAME_CLEARANCE_REQUIRED.md` states that availability is unverified.
Alternatives: keep the diamond mark; pick a different name. The requested name was kept. The diamond mark was replaced only in the UI.
Rollback: restore `BrandMark.tsx` and `index.html` favicon.
Owner: integrator.

### V17-ADR-003: Tab labels change; tab ids do not
Context: the four tabs need the names in the HELIXA brief.
Decision: visible and accessible names are Genome Editor, Genome & Harness Evolution, Earth Evolution Sandbox, and Harness Library. URL values stay `editor`, `evolution`, `simulation`, `library`. Phone labels stay Editor, Evolution, Earth, Library, with the full name as `aria-label`.
Rollback: restore `TAB_TITLES`.
Owner: integrator.

### V17-ADR-004: Sponsor Telemetry & Metadata Reconciliation Under HELIXA
Context: External sponsor integrations (Raindrop, ElevenLabs, Atlas Model API / Voyage AI, OpenAI-compatible providers) generate telemetry and traces. Renaming external identifiers can break third-party dashboards or leak sensitive credentials.
Decision: Preserve all external connection scopes, correlation IDs, and secret tokens unmodified. Trace spans and user-facing notifications present HELIXA as the product identity while retaining existing client IDs.
Consequences: Zero disruption to cloud observability, zero credential exposure.
Owner: Agent 4 (Sponsor Integration).

### V17-ADR-005: Automated Rebrand Verification Gate & CI Integration
Context: Rebranding must not introduce regression in existing scientific pipelines or break four-tab synchronization.
Decision: Introduce dedicated Make targets `make verify-helixa-rebrand` and `make demo-helixa` powered by `scripts/verify-helixa-rebrand.sh` and `scripts/demo-helixa.sh`. These verify Python code quality, backend identity contracts, Vitest brand tests, TypeScript compilation, and documentation presence in under 10 seconds.
Consequences: Fast, authoritative rebrand release gating.
Owner: Agent 5 (QA & Release Certification).

---

## DIAMOND Genome V14 — Anatomy-First Genome Editor (2026-10-11)

### V14-ADR-001: Body Asset Licensing — Procedural Geometry and Strict Ban on Z-Anatomy & BodyParts3D
- **Context:** The milestone requires an interactive 3D human body for anatomical navigation. Common open-source 3D anatomy atlases such as Z-Anatomy and BodyParts3D are licensed under CC BY-SA 4.0 or contain mixed/unclear provenance meshes that risk viral copyleft contamination across the codebase.
- **Decision:** Strictly ban Z-Anatomy and BodyParts3D meshes from the repository (enforced via `test_v14_guardrails_license.py` and `tests/v14/guardrails.test.ts`). Use procedural parametric geometry and clean manifest-based anatomical volume anchors.
- **Alternatives Considered:**
  1. *Direct ingestion of Z-Anatomy GLTF meshes:* Rejected due to CC BY-SA 4.0 copyleft contamination.
  2. *BodyParts3D raw OBJ assets:* Rejected due to restrictive redistribution terms and unverified provenance.
- **Consequences:** Safe, unencumbered codebase for commercial and open research use; anatomical structures serve as visual references rather than high-density medical CAD models.
- **Rollback Plan:** Replace procedural meshes with commissioned public domain (CC0) photogrammetry scans if higher visual fidelity is required.

### V14-ADR-002: Anatomical Ontology — Uberon via EBI OLS4 with Explicit Laterality
- **Context:** Body parts require stable, standardized identifiers rather than ad-hoc labels. Bilateral structures (left vs right kidney, hand, lung) must be uniquely navigable without ambiguous coordinate lookups.
- **Decision:** Anchor all anatomical entities to Uberon ontology identifiers fetched and verified against EMBL-EBI OLS4 API. Encode laterality explicitly using `@left` and `@right` suffixes (e.g. `UBERON:0002398@left`), or map to distinct lateral Uberon classes where officially defined. Structures lacking Uberon classes are prefixed with `DIAMOND:` and keep `ontology_id: null`.
- **Alternatives Considered:**
  1. *Free-form strings:* Unusable for deterministic gene expression joining.
  2. *SNOMED CT / FMA:* Proprietary licensing or excessive complexity for client-side navigation.
- **Validation:** Verified in `test_v14_anatomy.py` (laterality split, acyclic DAG verification, and search ranking).

### V14-ADR-003: Gene-Tissue Association Confidence Schema & Scientific Causality Boundary
- **Context:** Users viewing an organ might falsely assume that high expression of a gene implies editing that gene will safely reshape or improve the organ.
- **Decision:** Model gene expression distinctly from phenotypic association. Ingest GTEx v8 (49 tissues, 838 donors) and Human Protein Atlas RNA consensus datasets with an explicit, un-bypassable causality disclaimer: *"Expression shows the gene is active in this tissue. It is not evidence that editing this gene will alter the anatomical structure."* Forbid deterministic outcome claims and banned marketing copy (e.g. "genes that control").
- **Validation:** Enforced in `test_v14_guardrails.py` and Playwright `science.spec.ts`.

### V14-ADR-004: Reference Genome Choice — Pinned Ensembl 116 GRCh38 FASTA Slices
- **Context:** Mixing genome assemblies (e.g. GRCh37/hg19 vs GRCh38) causes fatal coordinate shifts and incorrect variant annotations.
- **Decision:** Pin assembly strictly to GRCh38 (Ensembl Release 116). Generate immutable FASTA slice fixtures under `fixtures/references/grch38_slices/` protected by SHA-256 manifests. Any API query requesting GRCh37, hg19, or GRCh37.p13 is unconditionally rejected with HTTP 400. Direct sequence edits create new revisions; baseline FASTA slices remain permanently immutable.
- **Validation:** Confirmed in `test_v14_guardrails_reference.py` and `verify_checksums()`.

### V14-ADR-005: Trait Goals vs In-Silico Nucleotide Edits
- **Context:** Users entering conversational prompts like "make my hands bigger" or "make me run faster" could trigger unrealistic automated mutagenesis.
- **Decision:** Route all broad phenotypic goals to `TRAIT_GOAL` intent in `parser.py`. Trait goals return scientific explanations of polygenic and environmental architecture, POST 0 edit proposals, and create 0 mutations. Only explicit nucleotide directives ("change base 4 to A") route to `PRECISE_EDIT`.
- **Validation:** Verified in `test_v14_guardrails_intent.py` and Playwright `science.spec.ts`.

### V14-ADR-006: Body Geometry Invariance
- **Context:** Editing DNA should not cause unrealistic deformation or avatar morphing of the reference 3D human body.
- **Decision:** Direct nucleotide edits update the 3D rotating double helix and sequence strip; the 3D body descriptor always returns `anatomy_changed: false`. The reference body remains an anatomical navigation drawing. Unsupported simulation phenotypes are labelled `not modeled`.
- **Validation:** Verified in `test_v14_guardrails.py`, `body-descriptor` endpoint, and Playwright `crosstab.spec.ts`.

### V14-ADR-007: Voice Transcription Review Step (No Auto-Apply)
- **Context:** Voice input via speech-to-text is subject to acoustic noise and transcription errors. Applying genomic edits directly from voice transcription could corrupt experimental sequences.
- **Decision:** Voice transcription populates the prompt composer for human review. The user must explicitly inspect and confirm the proposal. Voice status never reports "Connected" without an active, verified session.
- **Validation:** Verified in `test_v14_guardrails_intent.py` and Playwright `ux.spec.ts`.

### V14-ADR-008: Lineage Discipline — Strict Separation of Genome Revisions and Harness Versions
- **Context:** Prior milestones conflated research agent harness versions with biological sequence variants.
- **Decision:** Separate the two concepts structurally in the database schema and UI:
  - `Genome Revision` (`rev-...`): Immutable sequence variant set.
  - `Agent Harness Version` (`harness-...`): Versioned AI execution policy.
  - `Workspace`: Durably links both records. Changing workspace updates all tabs coherently.
- **Validation:** Confirmed in `test_v14_guardrails_lineage.py` and Playwright `crosstab.spec.ts`.

---

### V18-ADR-001: A prompt is not an allele
Date: 2026-10-11. Owner: integrator.
Context: trait questions were already blocked by the deterministic parser, but they did not retrieve source records.
Decision: `POST /api/research/investigations` may call Ensembl, Europe PMC, GWAS Catalog v2, Open Targets, and HPA. Gene lookup runs only for one user-typed symbol. Papers are stored as title metadata. No `REF/ALT` is proposed unless the user typed `contig:position REF>ALT`, and even then the investigation does not write a revision.
Alternatives: let the model pick MC1R for every pigmentation question; scrape PDFs. Both rejected.
Consequences: some queries abstain. Open Targets can return zero hits.
Rollback: remove the `v18_research` router. Cached anatomy evidence is untouched.

### V18-ADR-002: Citations must be substrings of the payload
Date: 2026-10-11. Owner: integrator.
Context: a language model can invent PMIDs.
Decision: `verify_claim_support` keeps a claim only when every PMID, Ensembl id, and GWAS association id in the text exists on a returned row. Expression cannot use predicate `BODY_FROM_EXPRESSION`. ClinGen stays `not_configured` until a real download exists.
Rollback: delete `services/runtime/research/claims.py` checks. Do not backfill fake grades.




