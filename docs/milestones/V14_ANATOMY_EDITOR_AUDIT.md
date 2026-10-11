# V14 Phase A audit: anatomy-first Genome Editor

Date: 2026-10-11 (UTC). Auditor: coordinator. Repository: `/home/923873155/Diamond_Proj`.

## Baseline tests before any V14 change

| Suite | Command | Result |
|---|---|---|
| Backend | `python -m pytest services/tests -q` (venv, real `.env` present) | **591 passed, 4 failed, 1 skipped**. Three failures are environment-dependent: `.env` makes ElevenLabs `CONFIGURED` while the tests expect `NOT_CONFIGURED` (`test_api_routes.py::test_api_integrations_status_endpoint`, `test_audit_int_elevenlabs.py::{test_status_requires_enabled_and_key,test_stream_not_configured_raises_without_network}`). One predates V14: `test_api_routes.py::test_api_run_creation_and_evolution_flow` raises `UnicodeDecodeError` (byte 0xff) inside `json` decoding. |
| Frontend unit | `npx vitest run` (apps/web) | **24 files, 340 tests passed** |
| Typecheck | `npx tsc --noEmit -p apps/web` | clean |

## What already exists (keep)

| Capability | Where | State |
|---|---|---|
| Four top-level tabs, one persistent WebGL canvas, quality menu, WebGL fallback | `apps/web/src/app/App.tsx`, `src/v12/shell/**` | Working (V12) |
| Genome Editor: big procedural body (illustrative, no anatomy parts), DNA helix, sequence strip, local parser, draft/undo/redo/review/save, edit pulse | `src/v12/editor/**` | Working (V12). Body has **no selectable anatomy**; reference is **synthetic chr22** only. |
| Workspace store: workspaces, genome revisions (edit lists), proposals, commit with `expected_counter` + `Idempotency-Key`, branch, select, archive, genome lineage vs harness lineage, body descriptor `ILLUSTRATIVE` | `services/runtime/genome_workspace/store.py`, `/api/v10/*` | Working (V10/V13). Local JSON file (`artifacts/v10/state.json`), not Atlas. |
| Reference | `fixtures/references/ref_synthetic_chr22.fasta` (117,500 bp) | Synthetic, `official_grch38=false`. No GRCh38 data anywhere. |
| Voice | `/api/voice/transcribe` → 501 `NOT_CONFIGURED`; browser Web Speech optional in the composer | No server STT. ElevenLabs integration is TTS. |
| Evolution / Earth Simulation / Library tabs | `src/v12/{evolution,simulation,library}/**` | V12 agents C/D/E were finishing polish while V14 started. |
| Sponsors | `.env` has Raindrop (project id empty), ElevenLabs, OpenAI-compatible model, Voyage, Mongo URIs | Presence only; not re-verified here. |

## Gaps V14 must close
1. No anatomy hierarchy, ontology ids, selectable body parts, camera focus, or anatomy search.
2. No gene/tissue evidence, source versions or provenance.
3. No real GRCh38 sequence; the brief requires a real reference locus.
4. No intent routing (explore vs precise edit vs trait goal); the parser only handles explicit substitutions.
5. No server STT; voice cannot be honestly "connected".
6. Lineage carries no gene/anatomy annotation.

## Source reachability (probed 2026-10-11 from this machine)
| Source | Probe | Result |
|---|---|---|
| Ensembl REST | `/info/ping`, `/info/data`, `/info/assembly/homo_sapiens`, `/lookup/id/ENSG00000092054` | 200; release **116**, assembly **GRCh38.p14**, geneset update 2025-11 |
| OLS4 Uberon | `/api/ontologies/uberon` | 200 |
| Human Protein Atlas | `/ENSG00000092054.json`, `api/search_download.php` | 200; per-gene `RNA tissue specific nTPM` present |
| Bgee | `api/?page=gene&action=expression…` | 200; calls keyed by `UBERON:` anat entity with expression score + FDR + quality |
| GWAS Catalog REST **v2** | `/gwas/rest/api/v2/associations?mapped_gene=MYH7` | 200; accession, PubMed id, traits, p-value, beta, CI |
| Open Targets GraphQL | GET | 400 (needs POST; not yet used) |
| HPO | `hpo.jax.org/api/hpo/term/…` | 404 (API moved; to re-check at ontology.jax.org) |

## Decision summary for V14 (details in `DECISIONS.md`)
- Keep the V10 store; add **pinned GRCh38 slices** (Ensembl release 116) as a second, read-only reference, with
  reference-tagged edits so synthetic and GRCh38 positions never collide.
- Original procedural anatomy (no Z-Anatomy / BodyParts3D meshes) because of share-alike and mixed-provenance terms.
- Uberon ids verified through OLS4; lateral composites (`@left`/`@right`) only where Uberon has no lateral class.
- Evidence tiers as text; no invented numeric confidence; expression never presented as causality.
- Five real parallel coding agents (Cursor Task subagents) with exclusive file ownership; see `V14_UI_CONTRACTS.md` §7.
