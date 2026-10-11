# DIAMOND Genome V15 — Inter-Agent Interface Contracts & Schemas
**Document Version:** 15.0.0  
**Timestamp:** 2026-10-11T23:28:00Z  
**Status:** ARCHITECTURE LOCKED  

---

## 1. Domain Ownership and Agent Architecture

| Agent | Domain | Codebase Boundaries | Primary Deliverable |
|---|---|---|---|
| **Agent A — Genome Causality** | Molecular causal chain, GRCh38 reference integrity, deterministic editing, evidence ladder | `services/runtime/genomics/`, `services/runtime/genome_edit/`, `services/runtime/anatomy/`, `services/api/app/routes/genome_edit.py`, `services/api/app/routes/anatomy.py`, `apps/web/src/v14/` | Pinned sequence edit pipeline, Ensembl VEP adapter, strictly bounded body morph contract |
| **Agent B — Evolution Mathematics** | Population genetics, Wright–Fisher dynamics, selection surfaces, demographic extinction, ensemble Monte Carlo | `services/runtime/population/`, `services/runtime/evolution/math/`, `services/api/app/routes/evolution_v15.py` | Mode A exact Wright-Fisher, Mode B research/SLiM, Mode C cinematic solver, 10–100 replicate ensembles, 60s snapshot encoding |
| **Agent C — Cinematic Frontend** | Four-tab experience, 3D scenes, camera choreography, timeline playback, scientific tags | `apps/web/src/v12/`, `apps/web/src/app/`, `apps/web/src/scenes/` | 4 tabs (Editor, Evolution, Earth Simulation, Library), zero editing on Tabs 2–3, 60s timebar, legible layout |
| **Agent D — AI & Data Integration** | Multimodal intent, agent pipeline, MongoDB Atlas, Raindrop telemetry, ElevenLabs voice, SSE | `services/runtime/evidence/`, `services/integrations/`, `services/api/app/routes/voice.py`, `services/api/app/routes/v10.py` | Fact-grounded narration, MongoDB persistence, sanitized telemetry, voice IO |
| **Agent E — Independent QA & Integration** | Test oracle, 16 numerical validations, Playwright e2e, verification script, milestone docs | `services/tests/`, `apps/web/tests/`, `scripts/`, `docs/milestones/` | 16 numerical proofs, 100% test pass, verification script, audit logs |

---

## 2. Core Scientific Data Contracts

### 2.1 Reference Genome (`ReferenceGenome`)
Immutable build declaration:
```json
{
  "reference_asset_id": "grch38_slices_ensembl116",
  "assembly": "GRCh38",
  "contig": "chr22",
  "start": 1,
  "end": 117500,
  "checksum_sha256": "fcd37f8e8e43f84f5b3af43e1161f422a5674d21815b814c7cc38688e3fdd430",
  "official_grch38": true,
  "license_note": "Ensembl Release 116 (EMBL-EBI / Wellcome Trust Sanger Institute)"
}
```

### 2.2 Genome Edit Revision (`GenomeEditRevision`)
Immutable sequence revision created on user commit:
```json
{
  "genome_revision_id": "rev_ws-001_1",
  "parent_revision_id": "rev_baseline",
  "workspace_id": "ws-001",
  "edits": [
    {
      "position": 28876,
      "ref": "G",
      "alt": "A",
      "contig": "chr22",
      "assembly": "GRCh38",
      "locus_id": "grch38:chr22:MYH7:28800-28950",
      "gene_id": "ENSG00000092054",
      "gene_symbol": "MYH7",
      "proposal_id": "prop_123"
    }
  ],
  "preview_window": "ACGT...",
  "sequence_sha256": "3a88b...",
  "harness_version_id": "harness-pche-baseline",
  "created_at": "2026-10-11T23:30:00Z"
}
```

### 2.3 Evidence Ladder (`EffectEvidence`)
Typed evidence tiers linking edits to effects:
```json
{
  "claim_id": "claim_001",
  "evidence_tier": "TRANSCRIPT_COMPUTED",
  "locus_id": "grch38:chr22:MYH7:28800-28950",
  "consequence": "missense_variant",
  "amino_acid_change": "Arg719Trp",
  "associated_tissue": "cardiac muscle tissue",
  "phenotype_ontology_id": "HP:0001639",
  "phenotype_label": "Hypertrophic cardiomyopathy",
  "morph_allowed": false,
  "why_morph_disallowed": "Gene expressed in cardiac tissue does not imply a predictable whole-body morphological change.",
  "caveat": "Expression association is not demonstrated causation."
}
```

### 2.4 Phenotype Renderer Contract (`PhenotypeRendererContract`)
Guarantees UI cannot invent body deformation:
```json
{
  "frame_id": "frame_001",
  "genome_revision_id": "rev_ws-001_1",
  "simulation_run_id": "sim_001",
  "trait_model_id": "unsupported",
  "trait_estimate": {},
  "trait_uncertainty": {},
  "scientific_status": "UNSUPPORTED",
  "allowed_morph_targets": [],
  "highlight_anatomy_ids": ["UBERON:0000948"],
  "honesty_caption": "A body-shape effect cannot be inferred from this edit. Neutral anatomy preserved."
}
```

### 2.5 Evolution Simulation Frame (`SimulationFrame`)
```json
{
  "frame_index": 0,
  "generation": 0,
  "simulated_years": 0.0,
  "allele_frequency": 0.50,
  "population_size": 1000,
  "extinct": false,
  "render_hints": {
    "frequency_glow": 0.50,
    "population_density": 1.0,
    "branch_active": true
  },
  "interpolated": false
}
```

### 2.6 Multi-Replicate Evolution Run (`EvolutionRun`)
```json
{
  "run_id": "run_001",
  "workspace_id": "ws-001",
  "scenario_hash": "a1b2c3...",
  "engine_mode": "MODE_A_WRIGHT_FISHER",
  "replicates_requested": 20,
  "replicates_completed": 20,
  "generations": 80000,
  "generation_time_years": 25.0,
  "simulated_years": 2000000.0,
  "ensemble_summary": {
    "median_final_frequency": 0.84,
    "percentile_10_frequency": 0.42,
    "percentile_90_frequency": 0.98,
    "extinction_fraction": 0.05,
    "fixation_fraction": 0.35
  },
  "playback_duration_seconds": 60,
  "snapshots": []
}
```

---

## 3. REST & Realtime API Endpoint Specifications

### 3.1 Workspaces & Lineage
- `GET /api/v10/genome/workspaces`: List workspaces and active pointer.
- `GET /api/v10/genome/workspaces/active/snapshot`: Authoritative session snapshot.
- `POST /api/v10/genome/workspaces/{id}/select`: Switch active workspace.
- `GET /api/v10/genome/workspaces/{id}/genome-lineage`: Genome edit chronological lineage.
- `GET /api/v10/genome/workspaces/{id}/harness-lineage`: Algorithmic harness evolution lineage.
- `GET /api/v10/genome/workspaces/{id}/body-descriptor`: Phenotype render descriptor.

### 3.2 Genome Editor (Tab 1)
- `POST /api/genome-edit/interpret-command`: Grammar interpretation (text/voice).
- `POST /api/genome-edit/proposals`: Create typed edit proposal.
- `POST /api/genome-edit/proposals/{id}/validate`: Deterministic reference/consequence check.
- `POST /api/genome-edit/proposals/{id}/apply`: Commit edit to revision.

### 3.3 Earth Evolution Simulation (Tab 3)
- `GET /api/v10/evolution/environments`: Presets and environment catalog.
- `GET /api/v10/evolution/parameters`: Mathematical parameter specifications.
- `POST /api/v10/evolution/simulations`: Execute seeded forward simulation (single or ensemble).
- `GET /api/v10/evolution/simulations/{id}/playback`: Stored frames indexed to 60-second playback clock.
- `GET /api/v10/evolution/simulations/{id}/stream`: Real-time SSE progress events.

### 3.4 Evidence & Narration
- `GET /api/v14/genes/{gene}/annotations`: Ensembl annotations on GRCh38 only.
- `GET /api/anatomy/tree`: Anatomy ontology hierarchy.
- `POST /api/voice/briefing`: Evidence-backed spoken briefing or caption fallback.
