# V12 design system (Agent A)

Source of truth: `apps/web/src/index.css` (tokens + component classes), `apps/web/tailwind.config.js`
(Tailwind mapping), `apps/web/src/v12/design/*` (React primitives). Screenshots:
`artifacts/frontend/v12/agentA/`.

## Identity
A deep-midnight scientific instrument. The product's one deliberate move is **glacial light on ink**:
near-black navy fields, hairline borders, restrained glass, and a cyan -> cobalt -> indigo -> amethyst
accent family used for state and focus, never for decoration. Type pairs a precise grotesque
(Instrument Sans) with a literary serif (Newsreader) used sparingly for the brand and hero titles, and a
true mono (JetBrains Mono) for coordinates, ids and hashes. No Inter/Roboto, no neon, no bloom on chrome.
Boldness is spent in ONE place per tab (the scene or the title), everything else is quiet.

Fonts are self-hosted via `@fontsource-variable/{instrument-sans,newsreader,jetbrains-mono}` (all OFL-1.1,
latin subset fetched on demand through unicode-range; imported in `src/app/fonts.ts`).

## Colour tokens (RGB channels in `:root`, so `bg-ink-900/60` works)
| Role | Token / Tailwind | Value | Notes |
|---|---|---|---|
| Field | `ink-950..500` | `#04060d` `#070b16` `#0b1120` `#121b30` `#1c2844` `#2e3e62` | 950 page, 900 panels, 800 raised, 700 controls, 600 selected, 500 scrollbar/rules |
| Text | `fg`, `fg-2`, `fg-3` | `#e8eef9` `#b0bcd2` `#8997b4` | contrast on ink-900: 16.9 / 10.3 / 6.7 (fg-3 is the quietest allowed) |
| Accent | `glacier` `cobalt` `indigo` `amethyst` | `#7fe3ff` `#5a86ff` `#8678ff` `#bd96ff` | glacier = focus/active/primary; others for graphs and the ambient backdrop |
| Hairline | `line` | `#96b2ff` | always at 10-25% alpha (`border-line/15`, `.hairline`) |
| Danger | `danger` | `#ff7888` | errors, offline |

## Evidence-status semantics (never colour alone)
Every claim shown anywhere carries exactly ONE `EvidenceBadge` kind. Each kind has a colour, a silhouette
glyph and a text label, so it survives greyscale and colour-blindness.

| Kind | Meaning | Colour | Glyph | Where it applies |
|---|---|---|---|---|
| `REFERENCE` | read directly from the loaded reference | glacier | solid disc | reference bases, coordinates |
| `VALIDATED` | deterministic check with a recorded receipt | mint `#6ee7b7` | check | backend check receipts, hashes |
| `SIMULATED` | stochastic model output | amethyst | diamond | Wright-Fisher frames, replicate stats |
| `HYPOTHESIS` | proposal / illustration, not validated | amber `#f7c462` | dashed ring | drafts, proposals, symbolic visuals |
| `INCONCLUSIVE` | unavailable / unsupported / failed | slate `#9caac2` | dash | missing endpoints, unsupported ops |
Exports: `EvidenceBadge`, `EvidenceGlyph`, `EVIDENCE_META` (label, hint, classes and a CSS `color` for
charts/SVG so a chart series uses the same role colour).

Other colour semantics: green dot/icon = API online, amber = degraded or unsaved draft, red = offline/error.
These always sit next to text or an icon with a different shape (wifi / wifi-off / triangle).

## The body vs DNA distinction
The human-body figure (Genome Editor) is a **neutral, softly lit anatomical reference**: it never changes
shape or colour because a base changed (no phenotype claims). The helix is the **data surface**: it may
update bases immediately, highlight changed positions and show drafts. The ambient DNA behind Evolution and
Library is explicitly **decorative** (abstract strands, no nucleotide colours, no data) and is therefore
rendered at <= 35% opacity at the right edge, off in the Editor (which owns the real helix) and off in the
Earth Simulation. Anything symbolic must carry the caption "Illustrative visualization of model output" or similar.

## Typography scale (Tailwind)
`2xs 11/16` (kbd hints, counters only) / `xs 12/18` (captions, chips; minimum for information) / `sm 13/20`
(UI default in panels) / `base 15/24` (body) / `lg 17` / `xl 20` / `2xl 24` / `3xl 30` / `4xl 40`.
Roles: `font-sans` UI; `.text-display` / `font-display` (Newsreader, 450, tight tracking) for the wordmark,
tab hero titles and empty states only; `font-mono` / `.coord` (tabular figures) for coordinates, ids, hashes.
`.hud-label` is a quiet normal-case 12px caption (no tracked ALL-CAPS eyebrows). Never body text below 12px.

## Spacing, radius, elevation
4 px grid (Tailwind default). Page gutter `--gutter` 1.5rem (>=1024) / 1rem / 0.75rem (<=768); use `.hud-pad`.
Radius: `rounded-panel` 14px, `rounded-control` 10px, pills full. Elevation = hairline + soft shadow
(`shadow-panel`), never a coloured glow except the focus ring and `shadow-glow` on the one active highlight.

## Surfaces
- `.glass` (Panel): ink-800/ink-900 at ~74% + 16px blur. Contrast comes from the tint, not the blur.
- `.glass-strong`: ~90%, for bars and dialogs. `.glass-solid`: opaque, for menus and toasts that float over content.
- `.hairline` borders, `.rule` fading divider, `.skeleton` shimmer (flat under reduced motion).
- Components: `.btn` `.btn-primary` `.btn-quiet` `.btn-danger` `.field` `.chip` `.kbd`. Min control height 36px
  (44px on the phone tab bar). Disabled = 45% opacity + `not-allowed` (and say WHY in adjacent text).

## Layout contract (shell)
```
fixed scene-host (z-0, canvas + atmosphere)           <- OrbitControls receive events here
fixed header (z-30): TopBar | CompactTopBar (+ ConnectionBanner)
fixed .hud-stage (z-10, click-through, pointer-events:none)  top: var(--hud-top)  bottom: var(--hud-bottom)
fixed MobileTabBar (z-30, <= 768px)
Toaster (z-50)
```
`--bar-h` 3.75rem (3rem <=768), `--banner-h` 2.25rem (only while offline/degraded; `[data-banner=true]` bumps
`--hud-top`), `--hud-bottom` 0 (desktop) or 3.5rem + safe-area (<=768). Tab roots are click-through
(`pointer-events-none h-full w-full`); every panel re-enables events (`Panel` / `.glass`). Tabs size themselves
with `.hud-pad`. Breakpoints verified: 1440x900, 1280x800, 1024x768, 768x1024, 390x844.
Top bar responsive rules: wordmark hidden < 1181px; shortcut hints and the "synthetic" tag hidden < 1341px;
connection label hidden < 1181px (icon + accessible name remain); <= 768px swaps to a compact bar + bottom tabs.

## Motion rules
- Purposeful only: tab content eases in (`stage-enter`, 260 ms, translateY 6px), base selection highlight,
  scene camera/level easing (damped, 2-3/s). No parallax, no looping chrome animations.
- Tokens: `--ease-out` cubic-bezier(.2,.8,.2,1); durations fast 180 / base 260 / slow 450 ms.
- Reduced motion = OS `prefers-reduced-motion` OR Display menu "Reduce motion". It sets `<html data-motion="reduce">`
  (CSS clamps all animation/transition) and `useSession.reducedMotion` (scenes hold rotation still and snap levels).
- The ambient helix rotates continuously (SceneClock rotation) and morphs style over a 300 s cycle with a ~30 s
  transition; it is static under reduced motion.
- 3D loop: pauses when the document is hidden; Low power = 30 fps cap and 1x pixels; dpr clamp 1.5x / 2x;
  no per-frame React state; scenes dispose on unmount; the `<Canvas>` is never remounted on tab switch.

## Accessibility baseline
Radix tablist (roving tabindex, Arrow/Home/End, wrap) + global digits 1-4 (ignored in inputs, textareas,
selects, contenteditable, dialogs, menus, with modifiers or key repeat). Visible 2px glacier `:focus-visible`
ring everywhere. Skip link to `#hud-stage`. Live regions: toasts (`role=status`, errors `role=alert`),
connection banner (`role=alert` when offline), draft indicator and connection pill are named buttons/status.
Phone tabs keep the full title as accessible name (`aria-label`) while showing short labels.

## Shell API for other agents
- `import { toast } from "@/v12/shell/toast"` (relative path in v12): `toast({ title, description?, tone? })`, text only.
- `useRenderPrefs`, `useRenderSettings`, `resolveRenderSettings` (`shell/renderPrefs.ts`): quality tier, dpr, fpsCap,
  `webgl` status ("ok" | "unsupported" | "lost" | "error"), safe inside `<Canvas>` via `.getState()`.
- `useSession.getState().reducedMotion` is already the effective reduced-motion flag.
- `design/index.ts` barrel: `EvidenceBadge, EvidenceGlyph, EVIDENCE_META, Panel, Skeleton, SkeletonLines,
  UnavailableNotice, Kbd, StatusDot, Chip, Coord, SectionTitle`.
- Inactive tabs are UNMOUNTED (Radix tab panels); the scene canvas and `useSession` (drafts, selection, workspace)
  persist. Keep any UI state that must survive a tab switch in a zustand store, not component state.
- The camera is eased back to `[0,0,18]` looking at the origin on Evolution/Library; Editor/Earth scenes must set
  their own pose on mount (the default camera object is shared).
