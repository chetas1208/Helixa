# V14 notes — Agent 3 (Editor UX, text/voice, DNA viewer)

Status: first-screen + intent router landed against mocked/local anatomy. Agent 1 `AnatomyStage` is not in tree yet.

## Files

Owned / written:

- `apps/web/src/v12/editor/promptRouter.ts` — EXPLORE / PRECISE_EDIT / TRAIT_GOAL. Label in UI: **Parsed locally**. Wire `parser`: `deterministic-v14`.
- `apps/web/src/v12/editor/anatomySlot.tsx` — isolated body mount. `ANATOMY_STAGE_AVAILABLE = true`; `EditorScene` renders `AnatomyStage` through this slot only (not SceneHost). Pedestal hidden while the atlas is live.
- `apps/web/src/v12/editor/editorModel.ts` — `applySavedEdits(..., referenceAssetId)` filters by `reference_asset_id`; untagged edits are synthetic chr22. Draft ops are not filtered (current window).
- `apps/web/src/v12/editor/{GenomeEditorTab,PromptComposer,EditorScene}.tsx` — first viewport, router submit, locus window, drawer/chips.
- `apps/web/src/features/genome-editor/**` — `EvidenceDrawer` (stacked sections, no tablist), `ExploreChips`, `localAnatomy`, `interpretCommand`, `useLocusWindow`, `useAnatomyEvidence`.
- `apps/web/tests/v14/editorRouter.test.ts`
- `apps/web/tests/v14/editorModel.test.ts`
- `apps/web/tests/v14/editorFirstScreen.test.tsx`
- `apps/web/tests/v14/editorExplore.test.tsx`

Read-only: `v14/contracts.ts`, `v14/state/anatomySelection.ts`, `v12/shell/SceneHost.tsx`. Did not edit `PROGRESS.md` / `DECISIONS.md` / backend / other tabs.

## First screen

Visible: interactive baseline body (procedural `BodyFigure` via `anatomySlot`), revolving helix, sequence strip with `editor-status` + `reference-label` + `synthetic-label` (“Local synthetic sequence, not GRCh38”), composer placeholder **What would you like to explore or edit?**, mic, **Explore body parts**, Inspect proposal (kept for e2e / precise edits).

Hidden until selection/command: long status chip stack (version / evidence / draft summary), compare chrome, inspector.

When a GRCh38 locus is selected (`useAnatomySelection.locusId`) and `GET /api/genome-edit/loci/{id}/window` answers, the strip reads `Baseline · GRCh38 · <locus>`.

## Commands (this pass)

```
cd apps/web
npx tsc --noEmit
# clean

npx vitest run tests/v14/editorRouter.test.ts tests/v14/editorModel.test.ts \
  tests/v14/editorFirstScreen.test.tsx tests/v14/editorExplore.test.tsx \
  tests/v12/promptParser.test.ts tests/v12/editorModel.test.ts tests/v12/tab1Directive.test.ts
# 7 files, 151 tests passed
```

Throwaway UI (never :8000, never kill :5173/:8000): `E2E_API_PORT=8143 E2E_WEB_PORT=5143`.

Screenshots: none (unit/jsdom only).

## Leftover (other agents)

- **Agent 1:** `AnatomyStage` is wired from `anatomySlot`. Their `tsc` still fails (`AnatomyStage.tsx` Vector2, `catalog.ts` / `manifest.ts` tuple types). Atlas click picking is theirs; the editor Turn-figure control does not move their private camera.
- **Agent 2:** `/api/anatomy/*`, `/api/genes/*`, `/api/genome-edit/loci/{id}/window` 404 → honest unavailable / keep synthetic 1–48. Local mention map is a teaching fallback.
- **Agent 4:** `POST /api/genome-edit/interpret-command` 404 → local router (must stay correct). `reference_asset_id` on revision edits not on the wire yet; extra fields are ignored. Voice `/api/voice/transcribe` still 501; browser speech / text fallback + confirm-to-submit unchanged (never auto-apply).

## Contract change requests

None. `quality` is listed on the zustand store in §5 but is not on the current `anatomySelection.ts`; Agent 4 owns that file — not edited.
