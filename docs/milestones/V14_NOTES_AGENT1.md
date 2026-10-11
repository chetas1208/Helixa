# V14 Agent 1 notes — Anatomy atlas & 3D assets

Status: **shipped for Agent 3 to consume**. Coordinator: do not treat this as a contract change.

## What landed

React surface (from `apps/web/src/features/anatomy/index.ts`):

- `<AnatomyStage rect quality reducedMotion pulseRef? />` — R3F element with a **private scene + camera**. Focus/zoom uses scissor/viewport on `rect` only; the shell/helix camera is never moved.
- `<AnatomyTree />` — accessible tree + search. Calls `GET /api/anatomy/tree` and `/search`; **404/405/501/network → shipped `anatomyTree.local.json`**, labelled **local atlas fixture**.
- `<AnatomyFallback2D />` — labelled original SVG for no-WebGL / phones.
- `anatomyMeshManifest` — imported from `anatomy-mesh-manifest.json`.

Geometry: original elliptical loft + ellipsoids (generic adult, A-pose). Named hit volumes for Level A exterior regions, L/R laterality, fingers as child hits, and pickable internal organs (brain, eyes, heart, L/R lung, liver, stomach, L/R kidney, bladder). Unavailable organs stay in the tree with `mesh_status: "unavailable"` and `focus_fallback_id`.

Quality: `high` / `balanced` / `low` (radial + particle count; low = no particles). Reduced motion: no idle sway, instant camera snap. `pulseRef` is an acknowledgement sweep only — geometry and colour mapping never change.

## Files

Owned writes:

- `apps/web/src/features/anatomy/**` (catalog, loft, stage, tree, 2D fallback, JSON fixtures)
- `apps/web/tests/v14/anatomyAtlas.test.ts`
- `apps/web/tests/v14/anatomyTree.test.ts`
- `scripts/anatomy/emit_fixtures.ts` — regenerate JSON from the TS catalog
- `scripts/anatomy/validate_atlas.mjs` — fixture sanity
- `docs/milestones/V14_NOTES_AGENT1.md` (this file)

No files under `apps/web/public/anatomy/` (no downloaded meshes; nothing to host).

Did **not** edit: `PROGRESS.md`, `DECISIONS.md`, `AGENT_OWNERSHIP.md`, `Makefile`, `services/**`, `apps/web/src/v12/editor/**`, `src/v12/shell/**`, `src/v14/contracts.ts`, `src/v14/state/**`.

## Commands

```bash
# from apps/web
npx vitest run tests/v14/anatomyAtlas.test.ts tests/v14/anatomyTree.test.ts
npx tsc --noEmit -p .

# regenerate shipped JSON (optional)
npx --yes vite-node@1.6.0 ../../scripts/anatomy/emit_fixtures.ts

# fixture check
node ../../scripts/anatomy/validate_atlas.mjs
```

Throwaway UI (never :8000 / never kill :5173): `E2E_API_PORT=8141 E2E_WEB_PORT=5141` + `e2e/vite.e2e.config.ts`. Not required to ship the exports; Agent 3 mounts `AnatomyStage` in the editor canvas.

## License / provenance

**Original procedural geometry only.** No Z-Anatomy, BodyParts3D, Open Anatomy, or any downloaded mesh, texture, or GLB. Profiles and hit volumes were authored for this milestone. The loft *style* (elliptical cross-section tubes, ~10-unit adult, +Z front, +X = anatomical left) was studied from V12 `bodyGeometry.ts` / `BodyFigure.tsx` (read-only; Agent 3) and rewritten in new files (`loft.ts`, `hitTable.ts`, `atlasGeometry.ts`). Uberon CURIEs are textbook class ids; Agent 2 re-verifies them at OLS4 ingest. `DIAMOND:` ids (face, fingers) are unmapped by design (contract §1).

## Contract ids used (Level A + representative B)

| Region / organ | id |
|---|---|
| Body | `UBERON:0013702` |
| Head, neck, thorax, abdomen, pelvis, spine | `UBERON:0000033`, `0000974`, `0000915`, `0000916`, `0002355`, `0001130` |
| Face | `DIAMOND:region-head-face` |
| L/R arm (forelimb) | `UBERON:0002102@left/right` |
| L/R hand (manus) | `UBERON:0002398@left/right` (contract example) |
| L/R leg / foot | `UBERON:0002103@left/right`, `UBERON:0002387@left/right` |
| Left/right lung (own classes) | `UBERON:0002168`, `UBERON:0002167` |
| Heart, liver | `UBERON:0000948`, `UBERON:0002107` |
| Eyes, kidneys | `UBERON:0004548/0004549`, `UBERON:0004538/0004539` |

Lateral ids always differ. Highlight is exact-id; left hand cannot light the right hand.

## Leftover gaps

- Agent 3 must mount `<AnatomyStage>` in the editor canvas and pass the CSS-pixel `rect`; this agent does not edit `EditorScene`.
- Uberon CURIEs are not OLS4-probed in this client catalog (Agent 2 ingest is authoritative).
- Organs are **approximate hit volumes**, not anatomical sculptures. Several viscera (pancreas, spleen, intestines, thyroid, …) are searchable but `unavailable`.
- Individual fingers are `DIAMOND:digit-*` (no verified lateral digit classes in this fixture).
- No dedicated `apps/web/public/anatomy` assets.
- AnatomyStage picking listens on the shared canvas; Agent 3 should ignore body-yaw on that rect once they switch over, so helix and atlas do not fight.
- No throwaway E2E server was started (unit tests cover mapping / tree / laterality).

## Contract change requests

None.

## Blockers

None. Waiting on Agent 3 to wire the exports into the editor HUD/canvas, and Agent 2 for live `/api/anatomy/*`.
