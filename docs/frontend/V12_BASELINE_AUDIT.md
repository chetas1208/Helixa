# V12 baseline audit (2026-10-11)

Stack: React 18.3, Vite 5, TypeScript 5.4 (strict), three 0.165, R3F 8.18, drei 9, postprocessing 2.16,
zustand 4, TanStack Query 5 (installed, was unused), Tailwind 3.4, vitest 1.6. Package manager: npm in
`apps/web` (pnpm workspace at repo root). No Playwright/axe/testing-library installed (E adds).

## Frontend before V12
- 3-mode shell (Mission / Evolution / Proof) over one full-bleed R3F canvas, built earlier in this campaign.
  Screenshots: `artifacts/frontend/v12/before/`.
- WORKING: canvas, glass HUD, Mission/Evolution/Proof panels bound to legacy `/api/runs`, `/api/evidence`,
  `/api/v8/latest`, `/api/voice/briefing`, `/api/integrations/status`.
- DUPLICATE/WRONG for V12: three-mode IA (not the four required tabs); helix repeated as hero in every mode;
  Mission/Proof dashboards are exactly what Tab 1 must not contain; no workspace concept in the client;
  no body figure; no URL state; `useRunActions` hardcodes findings.
- MISSING: workspace selection, edit proposal/commit UX, voice capture, genome-vs-harness timelines,
  Earth simulation, library, drafts, Playwright/axe.
- Build/test baseline: `tsc` clean, vitest 61/61, `vite build` OK, bundle ~1.35 MB (3D libs).

## Backend capabilities (verified by probing the live FastAPI app, 2026-10-11)
Backend suite: all pytest tests pass; ruff clean. `/api/v10` (local JSON store, NOT Atlas) provides
workspaces (create/list/get/select/branch), proposals, commit (optimistic `expected_counter`, 409 on stale),
genome window/baselines, intelligence, evolution parameters/environments, simulations (Wright-Fisher
haploid, single biallelic locus, Idempotency-Key supported, 2000-generation budget, 409 above it).
Legacy: `/api/harnesses`, `/api/harnesses/{id}/lineage`, `/api/runs/*`, `/api/evidence/*`, `/api/fixtures`,
`/api/runs/{id}/findings`, `/api/voice/briefing` (TTS only), `/api/integrations/status`, `/api/health*`.

## Gaps (see V12_REQUIRED_BACKEND_ENDPOINTS.md)
No STT, no natural-language edit-interpretation agent, no workspace rename/archive/duplicate, no
simulation list/cancel/progress, no replicate batch, no per-workspace harness lineage (the V10 harness
id is the fixed string `harness-pche-baseline`), only single-base substitutions, no auth, no body asset.
Reference is a local synthetic chr22 FASTA (117,500 bp), `official_grch38: false`.
