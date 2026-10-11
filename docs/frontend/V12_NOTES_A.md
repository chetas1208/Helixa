# Agent A notes: design system + app shell (2026-10-11)

## Built
- `apps/web/src/app/App.tsx` (+ `fonts.ts`): Radix `Tabs.Root`, four tabs from `TAB_ORDER/TAB_TITLES`, code-split tab
  modules (idle-prefetched), `SceneHost` lazy chunk (three/R3F off the first-paint path: main chunk 332 -> 109 kB gzip),
  per-tab `ErrorBoundary` (reset on workspace change) + `Suspense` skeleton, `Toaster`, `SwitchGuardDialog` (D),
  `useHealth()` (D, drives `session.connection`), `useUrlSync()` (D; notice -> toast), digits 1-4 hotkeys, document title,
  skip link, `sr-only` h1 per tab.
- `src/v12/shell/`: `SceneHost` (one persistent Canvas; EditorScene / EarthScene lazy; context-loss + no-WebGL + scene crash
  handling; frameloop never when hidden; 30 fps limiter in low-power; dpr clamp), `AmbientBackdrop` (SceneClock-timed
  instanced helix, subdued, right-edge, off in editor/simulation), `WebGLFallback` (CSS/SVG), `TopBar`/`CompactTopBar`,
  `TabNav`, `MobileTabBar`, `QualityMenu` (quality + motion), `ConnectionBanner`, `connection.ts`, `ErrorBoundary`,
  `Toaster` + `toast.ts`, `RenderNotice` (toast + top-bar chip), `renderPrefs.ts`, `hotkeys.ts`, `useMediaQuery.ts`,
  `useReducedMotionSync.ts`, `BrandMark`.
- `src/v12/design/`: restyled `EvidenceBadge` (adds glyph + `EVIDENCE_META`), `Panel`, `Skeleton` (+`SkeletonLines`),
  `UnavailableNotice` (prop APIs unchanged); new `primitives.tsx` and `index.ts` barrel.
- `src/index.css`, `tailwind.config.js`, `index.html` (data-URI favicon, no `public/` dir needed), `docs/frontend/V12_DESIGN_SYSTEM.md`.
- Dependencies added: `@fontsource-variable/instrument-sans`, `newsreader`, `jetbrains-mono` (all OFL-1.1, checked via `npm view`).

## Legacy removal
Reachability script (roots: `src/v12`, `src/app`, `tests`, `e2e`, `main.tsx`, `SceneClock`) -> deleted 48 dead files:
all of `src/features/{evolution,mission,proof}`, `features/studio/StudioView.tsx`, `src/components/*`, `src/hooks/*`,
`src/scenes/*` except `SceneClock.ts`, `lib/{colors,helixMap}.ts`. KEPT because legacy unit tests in `tests/` still import them:
`src/features/studio/playback.ts`, `src/lib/{format,lineageLayout,quality}.ts`, `src/stores/{selectors,useGenomeStore}.ts`
(see handoff to E: retire `tests/{format,lineage_layout,playback,quality,selectors,store_and_views}.test.ts`, then these can go).

## Commands run
`npm install --save @fontsource-variable/...`; `npx tsc --noEmit` (my files clean; remaining errors are C's
`evolution/EvolutionTab.tsx` + `tests/v12/evolutionModel.test.ts` in flux); `npx vite build` OK (tabs + SceneHost chunks);
dev server on :5201 (stopped at end); Playwright scripts `/tmp/claude-1989081997/shots/agentA*.mjs`.

## Screenshots (`artifacts/frontend/v12/agentA/`)
`agentA_{1440x900,1280x800,1024x768,768x1024,390x844}_tab{1..4}.png`, `agentA_menu_*`,
`agentA_state_{offline,nowebgl_library,nowebgl_evolution,contextlost}_*.png`.
Verified by script: tab names/order, ArrowRight/End/wrap, digit 3 -> simulation + `?tab=simulation&workspace=` URL,
digits ignored in inputs, offline banner + pill, no-WebGL fallback + chip + toast, context-loss -> fallback, one canvas
after tab switches, draft indicator.

## Open items / blockers
- `src/main.tsx` is not in my ownership: it still builds its own `QueryClient` (retry:1) instead of D's
  `createQueryClient()` (`api/queryClient.ts`). Lead: swap it in (handoff written).
- Editor camera framing on 390x844 is B's (body fills the viewport); Earth tab at 1024x768 has a caption overlapping the
  Outcome panel header (C).
- FPS / long-task / memory measurements are E's; I made no performance claims.
