# DIAMOND Genome V15 — Inter-Agent Handoff Agreements
**Timestamp:** 2026-10-11T23:28:58Z  
**Status:** ACTIVE PROTOCOL  

---

## Formal Consumer / Producer Handoff Contracts

### Handoff H1: Agent A (Producer) → Agent C (Consumer)
- **Artifact:** `GenomeEditProposal` & `EffectEvidence` schemas (`/api/genome-edit/proposals`, `/api/genome-edit/interpret-command`)
- **Agreement:**
  1. Agent A provides exact parsed intents (`PRECISE_EDIT`, `TRAIT_GOAL`, `EXPLORE`, `NEEDS_CLARIFICATION`, `UNSUPPORTED`).
  2. For `TRAIT_GOAL`, Agent A guarantees `edit` is `None` and provides `why_not_automatic`.
  3. Agent C renders instant sequence strip updates and flash/sweep animation on Tab 1, but NEVER morphs body geometry unless `allowed_morph_targets` is explicitly non-empty with validated weights.
  4. For all unsupported or expression-only variants, Tab 1 displays the honest disclaimer: *"A body-shape effect cannot be inferred from this edit. Neutral anatomy preserved."*

### Handoff H2: Agent B (Producer) → Agent C (Consumer)
- **Artifact:** `SimulationPlayback` frames (`/api/v10/evolution/simulations/{id}/playback`)
- **Agreement:**
  1. Agent B computes and stores 120–600 snapshots indexed from generation 0 to $T$ over $t \in [0, \text{simulated\_years}]$.
  2. The frontend consumer maps the 60-second playback clock $\tau \in [0, 60]$ onto these stored frames.
  3. If an extinction event occurs in a replicate, `extinct: true` is permanently set; Agent C dims/fades the branch and renders the cause of extinction without auto-resurrection.
  4. Agent C never exposes editing tools on Tab 3 (Earth Simulation).

### Handoff H3: Agent B (Producer) → Agent D (Consumer)
- **Artifact:** `SimulationRecord` & `EnsembleSummary`
- **Agreement:**
  1. Agent B outputs reproducible ensemble statistics (median, 10th percentile, 90th percentile, extinction fraction, fixation fraction) and canonical SHA-256 result hash.
  2. Agent D persists run metadata to MongoDB Atlas / local store and sanitizes telemetry before sending to Raindrop.
  3. Agent D generates structured scientific explanations referencing the exact seeds and replicate counts without language model fabrication.

### Handoff H4: Agent A & B (Producers) → Agent E (Consumer)
- **Artifact:** Numerical test oracle suites (`services/tests/test_v15_numerical_validation.py`)
- **Agreement:**
  1. Agent B guarantees deterministic output for identical seed and inputs.
  2. Agent E validates the 16 standard population genetic invariants (neutral drift, directional selection, mutation balance, migration equilibrium, zero-fitness handling, absorbing extinction, generation-time scaling, ensemble tolerances).
  3. If any test fails outside documented Monte Carlo bounds, Agent E rejects the release candidate.
