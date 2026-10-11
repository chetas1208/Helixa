# HELIXA — Brand Identity & Design System Guide
**Document ID:** BRAND-GUIDE-001  
**Timestamp:** 2026-10-11T23:47:45Z  
**Application Scope:** Web Client, 3D Canvas, Documentation, and External Media  

---

## 1. Brand Hierarchy & Voice

- **Display Name:** `HELIXA` (uppercase for logos, wordmarks, navigation; sentence-case `Helixa` in running prose).
- **Tagline:** *Explore DNA. Understand change.*
- **Brand Voice:** Premium, rigorous, calm, evidence-grounded, and visually cinematic. Avoid hyper-saturated neon-tech tropes or sensationalized AI tropes.

---

## 2. Visual Palette & Semantic Design Tokens

The visual foundation is implemented via CSS variables in `src/index.css` and extended in `tailwind.config.js`:

```
+-----------------------------------------------------------------------------------------+
|                                    HELIXA COLOR PALETTE                                 |
+--------------------------+--------------------------+-----------------------------------+
| Dark Obsidian Surfaces   | Bioluminescent Cyan      | Ultraviolet & Indigo Accents      |
| ink-950: #070b12         | glacier: #7fe3ff         | amethyst: #8ea2ff                 |
| ink-900: #0d121c         | cobalt:  #5aa0ff         | indigo:   #6366f1                 |
| ink-800: #141c2c         | (Primary molecular glow) | (Secondary causal lane)           |
+--------------------------+--------------------------+-----------------------------------+
| Scientific Status Signals:                                                              |
| - ev-validated:    #22c55e (Green — Verified empirical evidence or passing tests)       |
| - ev-hypothesis:   #f59e0b (Amber/Gold — Unsaved draft, user assumption, or toy model)   |
| - ev-reference:    #38bdf8 (Sky Blue — Pinned reference genome build)                   |
| - danger:          #ef4444 (Red — Failed verification, lethal allele, or fatal crash)   |
+-----------------------------------------------------------------------------------------+
```

### Contrast Rules
All primary text colors (`fg: #f0f6fc`, `fg-2: #cbd5e1`, `fg-3: #94a3b8`) maintain WCAG 2.1 AA compliant contrast ratios ($\ge 4.5:1$ for body copy, $\ge 3:1$ for large headings) against dark ink surfaces.

---

## 3. Typography

- **Primary UI & Headings:** `Instrument Sans Variable` / `Instrument Sans`  
  Clean, high-legibility geometric sans-serif with subtle humanist terminals.
- **Coordinates, DNA Bases & Hashes:** `JetBrains Mono Variable` / `JetBrains Mono`  
  Tabular numerals and distinct glyph discrimination for `A`, `C`, `G`, `T`, `0`, and `O`.
- **Editorial & Scientific Prose:** `Newsreader Variable` (used sparingly for formal disclosures).

---

## 4. Logo Assets & Original Vector Graphics

All HELIXA brand assets are original SVG vectors free of third-party copyright claims:

| Asset Name | Relative Path | Purpose & Specifications |
|---|---|---|
| **Favicon** | `/favicon.svg` | Scalable 32x32 SVG icon with rounded dark tile and intertwined strands. |
| **Helixa Motif** | `/helixa-mark.svg` | Standalone icon rendering two helical strands forming a subtle 'H'. |
| **Full Wordmark** | `/helixa-wordmark.svg` | 200x48 vector wordmark combining the motif and uppercase HELIXA lettering. |
| **Social Card** | `/og-image.svg` | 1200x630 OpenGraph / Twitter preview card with dark gradient and tagline. |
| **Web Manifest** | `/manifest.webmanifest` | PWA installation descriptor with theme color `#070b12`. |

---

## 5. UI Microinteractions & Motion Policy

1. **Ambient Motion:** The 3D double helix and Earth planetary globe execute smooth, non-distracting ambient orbital rotations.
2. **Instant Sequence Feedback:** Draft nucleotide changes trigger a brief 1.1s ring flash at the altered pair, a light pulse along the connector, and an illustrative body sweep. Mesh vertex geometry is never deformed.
3. **Reduced-Motion Compliance:** When `prefers-reduced-motion: reduce` is enabled:
   - Camera orbital transitions are instantaneous.
   - Glow pulses and light packet sweeps are suppressed.
   - All interactive controls, sequence editing, and timeline scrubbing remain fully functional.
