# DIAMOND Genome V15 — REST & Realtime API Contract Specification
**Document ID:** V15-API-001  
**Timestamp:** 2026-10-11T23:34:00Z  
**Owner:** Agent D (AI & Integrations) & Agent C (Cinematic Frontend)  

---

## 1. Global API Standards

- **Base URL:** `/api`
- **Protocol:** HTTP/1.1 and HTTP/2 over TLS; SSE (`text/event-stream`) for real-time progress.
- **Idempotency:** Mutations accept `Idempotency-Key` header to prevent duplicate revisions or simulation records.
- **Optimistic Concurrency:** State modifications check `expected_counter`; stale submissions return `409 Conflict`.
- **Security Headers:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`.
- **Untrusted Host / Origin:** Requests with untrusted `Origin` or `Host` headers receive `403 Forbidden` / `400 Bad Request`.

---

## 2. Endpoint Contracts

### 2.1 Workspace Lifecycle
- `GET /api/v10/genome/workspaces`: Lists available workspaces and returns active workspace pointer.
- `GET /api/v10/genome/workspaces/active/snapshot`: Returns authoritative session snapshot including active genome revision ID, harness version ID, selection version, and body descriptor.
- `POST /api/v10/genome/workspaces/{workspace_id}/select`: Atomically activates workspace. Increments `selection_version`.
- `POST /api/v10/genome/workspaces/{workspace_id}/branch`: Creates an independent branch workspace cloned from parent state.

### 2.2 Genome Editing (Tab 1)
- `POST /api/genome-edit/interpret-command`:
  - **Request:** `{"text": str, "source": "text" | "voice", "selection": {...}}`
  - **Response:**
    - `intent: "PRECISE_EDIT"` with structured substitution `edit`.
    - `intent: "TRAIT_GOAL"` with `why_not_automatic` (never creates mutation).
    - `intent: "EXPLORE"` with anatomy or gene query.
    - `intent: "NEEDS_CLARIFICATION"` with helpful guidance.
- `POST /api/genome-edit/proposals`:
  - **Request:** `{"workspace_id": str, "position": int, "alt": str, "reference_asset_id": str, ...}`
  - **Response:** `201 Created` with `GenomeEditProposal` in `pending` status.
- `POST /api/genome-edit/proposals/{id}/validate`:
  - Checks REF against pinned FASTA slice (`fixtures/references/grch38_slices/`).
  - Computes VEP consequence if GRCh38.
  - Updates `validation_status: "valid" | "invalid" | "inconclusive"`.
- `POST /api/genome-edit/proposals/{id}/apply`:
  - Commits new immutable `GenomeEditRevision`.
  - Increments `revision_counter`.
  - Returns updated workspace and cryptographic evidence receipt.

### 2.3 Evolution Simulation (Tab 3)
- `GET /api/v10/evolution/environments`: Returns scientific environmental presets (Temperate, High UV, Cold, Arid, High Altitude, Resource Scarcity).
- `GET /api/v10/evolution/parameters`: Parameter schemas with permitted ranges and default values.
- `POST /api/v10/evolution/simulations`:
  - **Request:**
    ```json
    {
      "workspace_id": "ws-123",
      "horizon_years": 2000000,
      "generation_time_years": 25,
      "population_size": 100,
      "initial_frequency": 0.5,
      "selection_coefficient": 0.05,
      "dominance_h": 0.5,
      "carrying_capacity": 1000,
      "replicates": 20,
      "allow_acceleration": true,
      "environment": {"temperature_c": 32.0}
    }
    ```
  - **Response:** `200 OK` with canonical simulation record, ensemble summary, median and percentile frames, and `result_sha256`.
- `GET /api/v10/evolution/simulations/{id}/playback?duration_seconds=60`:
  - Stored snapshots mapped to 60-second playback clock $\tau \in [0, 60]$.
- `GET /api/v10/evolution/simulations/{id}/stream`:
  - Real-time SSE streaming (`start`, `frame`, `complete` events).

### 2.4 Evidence & Voice IO
- `POST /api/voice/briefing`:
  - **Request:** `{"receipt_id": str}`
  - **Response:** Streaming `audio/mpeg` with `X-Caption-Script` header if ElevenLabs configured; otherwise structured JSON caption fallback.
- `POST /api/voice/transcribe`:
  - Requires `X-Voice-Consent: granted` and configured STT provider. Returns `501 Not Implemented` with transparent reason when unconfigured.
