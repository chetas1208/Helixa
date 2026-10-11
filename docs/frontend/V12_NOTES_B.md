# V12 notes: Agent B (Genome Editor, Tab 1)

Finished by the lead after the original session closed. Decisions: V12-ADR-004/005/006 and 009/010/011 in `DECISIONS.md`.

## Files (`apps/web/src/v12/editor/`)
- `GenomeEditorTab.tsx`: DOM overlay. One status line (status chip, `reference-label`, `synthetic-label`, evidence badge,
  version and draft summary), draft toolbar and inspector top right, "Turn figure" + caption under the body column, and the
  sequence strip + composer + review stack under the helix column (full width on phones). Measures per-column insets.
- `editorSceneStore.ts`: plain data pushed from the DOM to the scene (bases, selection, compare, `bodyTurns`, insets, reduced motion).
- `EditorScene.tsx`: body (left) + helix (right) in the shell's persistent canvas. Fixed camera; drag turns the nearer
  subject, click picks a base. Edit acknowledgement on a draft change: ring flash, arc packet, body sweep.
- `helixGeometry.ts`: deterministic helix mapping and `computeSceneLayout` (two-column framing from insets).
- `HelixModel.tsx` (+ `Sprites.tsx`, `warpShader.ts`): instanced pairs, letters, markers, focus+context warp, `EditFlash`.
- `BodyFigure.tsx` / `bodyGeometry.ts`: procedural illustrative figure; `uPulse` sweep uniform. Geometry never changes.
- `DraftToolbar.tsx`: Undo, Redo, Compare (single toggle), Restore baseline, Discard (two-step), Review and save.
- `promptParser.ts`: deterministic local grammar ("Parsed locally"). Never guesses a locus or an allele.
- `BaseInspector.tsx`, `SemanticBaseList.tsx` (DOM listbox mirror of the helix), `PromptComposer.tsx`, `VoiceCapture.tsx`,
  `voiceAdapter.ts`, `ProposalPreview.tsx`, `useDraftReview.ts`, `draftReducer.ts`, `editorModel.ts`.

## Behaviour that must not regress
- No inner tabs or view switches. The body is always on screen and never shrinks or fades on selection.
- The pulse runs only on a draft-only change of 1-12 bases (not on loads, saves or workspace switches) and never under reduced motion.
- Nothing commits without the review: proposals and validation go through `/proposals`, and saving needs explicit confirmation.

## Verification
- `npx vitest run` (apps/web): parser, draft reducer and editor model suites pass.
- Screenshots: `artifacts/frontend/v12/lead/editor_*` (resting state at five viewports, plus flash, sweep and settled frames).
  Harness: `shot.mjs` / `pulse.mjs` beside them. The pulse script aborts every non-GET request, so the real store is never written.
