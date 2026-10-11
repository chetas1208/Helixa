# DIAMOND Genome V5 — Frontend 3D Control Plane & Accessibility Audit
**Audit Phase:** Full-System Adversarial Audit & Release Gate  
**Framework:** React 18, React Three Fiber (Three.js), TailwindCSS, Vite  
**Test Suite:** Vitest 1.6.1 (9/9 Passed)  

---

## 1. Top-Level Mode Architecture

The frontend (`apps/web/`) is structured into exactly three top-level operational modes:

```
+--------------------------------------------------------------------------+
|                      DIAMOND Genome V5 Control Plane                     |
|  [ MISSION ]                  [ EVOLUTION ]                 [ PROOF ]    |
+--------------------------------------------------------------------------+
|                                    |                                     |
|  * Active Worker State Machine     |  * Harness Lineage Tree             |
|  * Real-Time Stream (SSE)          |  * Mutation Diff Viewer             |
|  * Monotonic Event Feed            |  * Evaluator Benchmark Matrix       |
|  * Interactive 3D Revolving Helix  |  * Promotion Audit Controls         |
|                                    |                                     |
+------------------------------------+-------------------------------------+
|                                 PROOF                                    |
|  * Cryptographic Evidence Receipts (SHA-256)                             |
|  * IGV.js Genomic Track Inspection (chr22 synthetic view)                |
|  * Content-Addressed Storage (CAS) Artifact Download                     |
+--------------------------------------------------------------------------+
```

### Mode Verification
Audited in `apps/web/src/app/App.tsx`:
- `MISSION`: Displays run status, monotonic events, and 3D scene.
- `EVOLUTION`: Displays harness versions, diffs, and benchmark scores.
- `PROOF`: Displays verifiable receipts and IGV browser.

---

## 2. Revolving 3D DNA Double Helix & Deterministic Scene Clock

### Continuous 3D Presentation
- Rendered using `@react-three/fiber` canvas with optimized instanced mesh spheres representing base pairs.
- Smooth orbit controls with dampened mouse interactions.

### Deterministic 5-Minute Scene Transitions
- The scene clock (`apps/web/src/state/scene_clock.ts`) divides runtime into 300-second (5-minute) epochs.
- Epochs transition through 4 deterministic visual palettes:
  - `Phase 0 (0-5m)`: Deep Sapphire / Cyan
  - `Phase 1 (5-10m)`: Amethyst / Royal Violet
  - `Phase 2 (10-15m)`: Emerald / Jade Green
  - `Phase 3 (15-20m)`: Amber / Topaz
- Transitions use sinusoidal easing across the final 30 seconds of each epoch to prevent jarring visual jumps.
- **Scientific Integrity Guard:** UI documentation explicitly clarifies that 3D helix visual transformations are ambient visual state indicators and do NOT represent biological genetic mutations.

---

## 3. Accessibility & Performance Verification

- **Reduced Motion Support:** CSS media queries and scene clock settings detect `prefers-reduced-motion` and dampen 3D rotational angular velocity.
- **Color Contrast:** Mode indicators and status badges exceed WCAG 2.1 AA 4.5:1 contrast standards.
- **IGV.js Track Viewer:** Lazy-loaded in Proof mode with standard zoom, pan, and genomic coordinate lookups.
- **Frontend Test Verification:**
  - `scene_clock.test.ts`: 6/6 tests passing (epoch rollover, easing calculation, palette interpolation).
  - `store_and_views.test.ts`: 3/3 tests passing (mode switching, event ingestion, receipt persistence).
  - Production build: `pnpm --filter web build` completed with zero TypeScript errors.
