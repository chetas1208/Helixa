# V14 Agent 4 notes — App contracts, persistence, sponsor integration

Owner: Agent 4. Contract: `docs/milestones/V14_UI_CONTRACTS.md` §3–5, §8a.

## Commands run

```bash
# Backend (owned + regression) — 23 passed
.venv/bin/python -m pytest -q \
  services/tests/test_v14_genome_edit.py \
  services/tests/test_v13_contract.py \
  services/tests/test_v10_workspace.py

# Frontend unit — 8 passed
cd apps/web && npx vitest run tests/v14/api.test.ts
```

Throwaway API (never :8000): `V10_STATE_PATH=/tmp/v14_agent4/state.json .venv/bin/uvicorn services.api.app.main:app --host 127.0.0.1 --port 8144`

## Endpoints

| Method + path | Behaviour |
|---|---|
| `POST /api/genome-edit/interpret-command` | Deterministic grammar (`parser: deterministic-v14`). Intents `EXPLORE` / `PRECISE_EDIT` / `TRAIT_GOAL` / `NEEDS_CLARIFICATION` / `UNSUPPORTED`. Never writes a proposal or revision. Vague body goals (`change my eye colour`, `stronger legs`, `smarter brain`, `bigger hands`, `survive extreme cold`) → `TRAIT_GOAL` with no `edit`. Stated REF ≠ pinned base → `NEEDS_CLARIFICATION` plus `actual_ref`. Optional LLM (`GENOME_EDIT_LLM_SUGGEST`) is off by default and never authoritative. |
| `POST /api/genome-edit/proposals` | `{workspace_id, parent_revision_id, locus_id?, reference_asset_id?, position, alt, source, note?, anatomy_id?}` → `GenomeEditProposal` `validation_status: pending`. |
| `POST /api/genome-edit/proposals/{id}/validate` | REF vs Agent 2 `loci.base_at` when the asset is a GRCh38 slice; vs synthetic `base_at` for `ref_synthetic_chr22`. VEP when reachable, else `consequence_status: unavailable`. |
| `POST /api/genome-edit/proposals/{id}/apply` | `{expected_counter}` + `Idempotency-Key`. 409 stale parent/counter. 400 unless `validation_status == valid`. |
| `GET /api/genome-edit/proposals/{id}` | Stored proposal. |
| `POST /api/voice/transcribe` | 501 `NOT_CONFIGURED` unless `STT_ENABLED` + `STT_PROVIDER` + `STT_API_KEY` **and** `X-Voice-Consent: granted`. Never calls ElevenLabs STT (in-repo adapter is TTS). V13: ElevenLabs-TTS-configured JSON probe still 422, no invented transcript. |
| `GET /api/voice/status` | `{stt, provider, verified_at}`. `verified_at` is always null until a real round-trip exists. Never `Connected`. |

`GET /api/genome-edit/loci*` remains Agent 2.

## Store changes (additive)

- `_sequence_at` / `_edited_window` filter edits by `reference_asset_id` (missing → `ref_synthetic_chr22`). Synthetic preview 1–48 cannot apply a GRCh38 edit.
- Revision edit may include `{reference_asset_id, locus_id, assembly, contig, gene_id, gene_symbol, anatomy_ids[], proposal_id}`.
- `genome_lineage` nodes gain `edits_summary[]`. `harness_lineage` unchanged.
- New JSON map `genome_edit_proposals` (ids `gep-…`). Selecting anatomy is not persisted as a workspace change.
- V10 `propose` / `commit` / `interpret` paths unchanged.

## Sponsor honesty

- ElevenLabs: TTS only. `stt_status` is always `NOT_CONFIGURED`.
- STT: dedicated `STT_*` env. Status is `CONFIGURED` only when those are set; `VERIFIED` is not emitted without a round-trip (none is performed at boot).
- Raindrop: `record_ids` accepts `*_id` keys only. Apply emits proposal/workspace/revision ids. Sequence, bases, transcript, audio are dropped.

## Frontend (owned)

- `apps/web/src/v14/api/{client,schemas,hooks}.ts` — zod on interpret / proposal / validate / apply / voice / loci.
- Query keys include workspace, anatomy, gene, locus ids (`v14qk`).
- `state/urlParams.ts` + `state/urlSync.ts` — `?anatomy=&gene=&locus=` ids only; compose with existing `useUrlSync` (does not write tab/workspace).
- `anatomySelection` gained `quality` + `setQuality`. Existing fields/actions unchanged.

## Fallback if Agent 2 is missing

`services.runtime.anatomy.loci` is imported when present. If absent, only the synthetic contig can be validated; GRCh38 requests return `source_status: unavailable` and do not invent bases.

## Leftover / asks

- Agent 2: real GRCh38 `loci.base_at` / slices. Until then GRCh38 validate is inconclusive/unavailable.
- Agent 3: `editorModel.applySavedEdits` must filter by `reference_asset_id` the same way as `_edited_window`.
- Coordinator: `STT_*` env names are new; not added to `.env.example` (owned elsewhere). Optional `GENOME_EDIT_LLM_SUGGEST` stays off.
- Did not start or stop :5173 / :8000. Did not write `PROGRESS.md` / `DECISIONS.md`.

## Contract change requests

None.
