# DIAMOND Genome V5 — Security, Privacy & Dependency Audit
**Audit Phase:** Full-System Adversarial Audit & Release Gate  
**Security Posture:** Defense-in-Depth, Zero-Trust Tool Containment, Air-Gapped Genomic Safety  

---

## 1. Attack Surface Assessment

The system exposes two primary ingress vectors:
1. **Genomic File Uploads:** VCF v4.2 and FASTA references uploaded via REST API endpoints.
2. **Autonomous Agent Tool Invocations:** Shell-level bioinformatics tools (`bcftools`) and evolution proposals executed by runtime workers.

---

## 2. Ingestion Defenses & Path Traversal Mitigations

### 1. Path Traversal Neutralization
- **Vulnerability:** Attackers passing filenames such as `../../../../etc/passwd` or `..\windows\system32\cmd.exe` to overwrite server binaries or escape CAS boundaries.
- **Defense Implementation:** `FileIngestionService.sanitize_filename()` enforces strict validation:
  ```python
  if not filename or ".." in filename or "/" in filename or "\\" in filename or "\x00" in filename:
      raise ValueError(f"Unsafe or malformed filename: '{filename}'")
  ```
- **Audit Verification:** Dimension 8 submitted `../../etc/passwd`. Ingestion service rejected input with `ValueError`, passing the security check.

### 2. Gzip Decompression Bomb Protection
- **Vulnerability:** Highly compressed gzip files expanding into tens of gigabytes, exhausting server memory.
- **Defense Implementation:** `FileIngestionService.stream_and_persist()` streams gzip decoding through a bounded byte-counter chunk loop. If total decompressed bytes exceed `max_decompressed_bytes` (100MB), execution aborts immediately with `IngestionLimitExceeded`.

---

## 3. Subprocess Isolation & Shell Injection Prevention

- **No `shell=True`:** The bioinformatics adapter (`BcftoolsAdapter`) executes commands via direct argument lists `[str(self.bin_path), subcommand, *args]`. Shell interpolation is strictly prohibited.
- **Allowlisted Subcommands:** Only `["view", "norm", "stats", "index"]` are allowed. Invocations of `reheader`, `cat`, or shell wrappers raise `UnsafeBcftoolsCommandError`.
- **Absolute Paths & Sandbox Directories:** All temporary normalization targets are quarantined within isolated `tempfile.TemporaryDirectory` trees.

---

## 4. Secret Sanitization in Logging & Telemetry

- **MongoDB Credentials:** Connection URIs are parsed through regex redactors in `MongoDBClient` to strip user credentials before outputting log strings (`mongodb+srv://****:****@...`).
- **Telemetry Sanitization:** `RaindropAdapter` strips API keys, session tokens, passwords, and raw nucleotide sequences prior to serialization.

---

## 5. Dependency Audit

- **Python Core:** Python 3.12, `pysam 0.24.1`, `pymongo 4.11+`, `pydantic 2.10+`, `fastapi 0.115+`. No known CVEs detected.
- **Node Core:** React 18.3, `@react-three/fiber 8.17`, Three.js 0.169. Pinned via `pnpm-lock.yaml`.
- **Code Hygiene:** `ruff check .` returns 0 errors across all services.
