# V12 interface contracts

## Tabs and routing
`TabId = editor | evolution | simulation | library` (types.ts). Titles in `TAB_TITLES`. Order fixed.
URL: `?tab=<id>&workspace=<workspace_id>`. `useSession` is the client selection store; the server (`/api/v10`
`active`) is authoritative. D owns URL sync and bootstrap (`state/urlSync.ts` exporting `useUrlSync()`), A
mounts it once in `App`.

## Component names (frozen exports)
| Module | Export | Owner |
|---|---|---|
| `src/app/App.tsx` | `App` | A |
| `src/v12/shell/SceneHost.tsx` | `SceneHost` (single persistent `<Canvas>`, renders `EditorScene` / `EarthScene` / ambient by active tab) | A |
| `src/v12/editor/GenomeEditorTab.tsx` | `GenomeEditorTab` | B |
| `src/v12/editor/EditorScene.tsx` | `EditorScene` (inside Canvas; reads only its own zustand bridge `editorSceneStore.ts`) | B |
| `src/v12/evolution/EvolutionTab.tsx` | `EvolutionTab` | C |
| `src/v12/simulation/EarthSimulationTab.tsx` | `EarthSimulationTab` | C |
| `src/v12/simulation/EarthScene.tsx` | `EarthScene` (inside Canvas; reads `earthSceneStore.ts`) | C |
| `src/v12/library/HarnessLibraryTab.tsx` | `HarnessLibraryTab` | D |
| `src/v12/library/SwitchGuard.tsx` | `useGuardedWorkspaceSwitch(): (workspaceId) => Promise<boolean>` | D |
| `src/v12/state/urlSync.ts` | `useUrlSync` | D |
| `src/v12/editor/draftReducer.ts` | `emptyDraft(ws)`, `draftReducer(draft, action)` (pure; types in types.ts) | B |

DOM tabs render inside a click-through `.hud-stage`; panels use `Panel` (`pointer-events-auto`).
**R3F isolation rule:** React contexts (React Query, router) do NOT cross into `<Canvas>`. Scene components
may use zustand stores only; DOM-side tabs push plain data into the scene's own store.

## Data hooks (api/hooks.ts, signatures frozen, D hardens)
`useReference`, `useGenomeWindow(start,end)`, `useWorkspaces`, `useWorkspace(id)`, `useIntelligence(id)`,
`useParameterSpecs`, `useEnvironmentPresets`, `useSimulation(id)`, `useFixtures`, `useCreateWorkspace`,
`useBranchWorkspace`, `useSelectWorkspace`, `useProposeEdit`, `useCommitEdit`, `useRunSimulation`, query keys in `qk`.
Additions D must provide: `useHarnesses`, `useHarnessLineage(id)`, `useHealth` (drives `session.connection`),
`useTranscriptionAvailability`, `rememberSimulation(workspaceId,id)` / `recallSimulations(workspaceId)`.

## Semantics that must hold
- Sim frame i belongs to exactly one `simulation_id`, which belongs to one `workspace_id` + `genome_revision_id`;
  the UI never mixes frames across runs or workspaces.
- Time mapping (pure, unit-tested, `simulation/playbackClock.ts`):
  `visible_year = start_year + (elapsed_playback_s / playback_s) * horizon_years`, discrete frames shown at
  recorded boundaries; interpolated values flagged `interpolated` and labelled.
- Commit always sends `expected_counter` from the draft base; 409 -> conflict UI, never retry silently.
- Drafts are per workspace and never persisted. Switching workspace with a draft requires Save / Discard / Cancel.
- Evidence kinds: reference sequence = REFERENCE, backend check receipts = VALIDATED, Wright-Fisher output =
  SIMULATED, proposals/illustrations = HYPOTHESIS, unsupported/failed = INCONCLUSIVE.
