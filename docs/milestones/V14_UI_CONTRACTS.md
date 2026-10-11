# V14 interface contract: anatomy-first Genome Editor

Status: **LOCKED v1** (coordinator, 2026-10-11). Change only through a request in your notes file
(`docs/milestones/V14_NOTES_AGENT<n>.md`, section "Contract change requests"); the coordinator applies it here.
Wire format is **snake_case JSON end to end** (V12 convention). TypeScript mirror: `apps/web/src/v14/contracts.ts`.

## 1. Identifiers

| Thing | Format | Example | Notes |
|---|---|---|---|
| Anatomy node | Ontology CURIE, or CURIE + `@left`/`@right` when Uberon has no lateral class, or `DIAMOND:<slug>` when no verified ontology term | `UBERON:0002107`, `UBERON:0002168` (left lung has its own class), `UBERON:0002398@left`, `DIAMOND:region-head-face` | `ontology_id` holds the bare CURIE (or null). Every CURIE must be verified against OLS4 at ingest; unverified terms are stored as `DIAMOND:` with `ontology_status: "unmapped"`. Clients `encodeURIComponent` ids in paths. |
| Body system | `system:<slug>` | `system:cardiovascular` | Each has an `ontology_id` (Uberon system term) when verified. Systems link to nodes; they never duplicate node identity. |
| Gene | Ensembl stable id, unversioned | `ENSG00000092054` | `version` is a separate field. |
| Transcript | Ensembl stable id **with version** | `ENST00000355349.4` | |
| Locus (pinned reference slice) | `grch38:<SYMBOL>:<contig>:<start>-<end>` | `grch38:MYH7:14:23412700-23412939` | 1-based inclusive genomic coordinates on GRCh38 forward strand. |
| Synthetic reference | `ref_synthetic_chr22` | | Legacy V10 teaching contig. Never labelled GRCh38. |
| Workspace / genome revision / harness version | unchanged from V10/V13 (`ws-…`, `rev-…`, `harness-pche-baseline`) | | A genome revision is never a harness version. |
| Proposal | `gep-<12 hex>` | | Independent id with explicit `parent_revision_id`. |

## 2. Records (wire shapes)

### AnatomyNode
```json
{
  "id": "UBERON:0002398@left", "ontology_id": "UBERON:0002398", "ontology_status": "verified",
  "label": "Left hand", "ontology_label": "manus", "synonyms": ["hand", "left palm"],
  "type": "region", "parent_ids": ["UBERON:0002102@left"], "system_ids": ["system:musculoskeletal"],
  "laterality": "left", "level": "A",
  "asset_ids": ["mesh:hand_L"], "mesh_status": "modeled",
  "tissue_context_ids": ["UBERON:0002097", "UBERON:0001134", "UBERON:0002481"],
  "description": "…", "description_source": {"name": "Uberon", "version": "2025-…", "url": "https://…"},
  "source": {"name": "Uberon via OLS4", "version": "<ontology version string from OLS4>", "url": "https://www.ebi.ac.uk/ols4/ontologies/uberon/classes/…"}
}
```
- `type`: `region | organ | tissue | cell-type | bone | muscle | nerve | vessel | system-part | joint | gland`.
- `level`: `A` (exterior region) | `B` (detailed structure) | `C` (tissue) | `D` (cell type).
- `mesh_status`: `modeled` (a named mesh exists) | `approximate` (a proxy/hit volume, labelled approximate in UI) | `unavailable` (searchable; UI says "3D mesh unavailable" and focuses `focus_fallback_id`).
- `tissue_context_ids`: generic tissue types present in this region (curated reference anatomy, each id verified). Used to show expression measured in that tissue type **with the caveat that the sample site may differ**.

### Relationship (`GET /api/anatomy/{id}` includes `relationships`)
`{ "kind": <RelationshipKind>, "subject_id", "object_id", "source_id", "source_version", "source_url" }`
`RelationshipKind`: `ANATOMICAL_PART_OF | SYSTEM_MEMBERSHIP | GENE_EXPRESSED_IN | REGULATORY_ASSOCIATION_IN_TISSUE | VARIANT_TRAIT_ASSOCIATION | CURATED_GENE_PHENOTYPE_RELATIONSHIP | VISUAL_ASSET_FOR_ANATOMY | EDIT_OVERLAPS_GENE_OR_REGULATORY_REGION`.
**Rule:** 5 and 6 are never derived from 3.

### GeneTissueEvidence
```json
{
  "evidence_id": "ev-…", "gene_id": "ENSG00000092054", "gene_symbol": "MYH7",
  "anatomy_id": "UBERON:0000948", "measured_anatomy_id": "UBERON:0002098", "measured_anatomy_label": "apex of heart",
  "evidence_kind": "tissue-expression", "interpretation_tier": "observed-expression",
  "source_id": "bgee", "source_version": "Bgee 15.x", "retrieved_at": "2026-10-11T…Z",
  "study_or_record_id": null, "context": "RNA-Seq; adult; call quality gold",
  "quantitative_value": 99.94, "units": "Bgee expression score (0-100, rank-based)", "qualitative_label": "expressed (gold)",
  "uncertainty": "FDR <= 1e-14", "source_url": "https://www.bgee.org/gene/ENSG00000092054",
  "caveat": "Expression shows the gene is active in this tissue. It does not show that editing it changes this organ."
}
```
- `evidence_kind`: `anatomical-part-of | tissue-expression | regulatory-association | variant-trait-association | curated-gene-phenotype | genomic-overlap`.
- `interpretation_tier`: `reference-fact | observed-expression | statistical-association | curated-relationship | predicted-hypothesis | unknown`.
- **No invented numeric confidence.** `quantitative_value` is only a value the source itself reports, with `units`.
- `measured_anatomy_id` differs from `anatomy_id` when the measurement was on a descendant or a tissue-context; UI must show the measured site.

### Gene
```json
{
  "gene_id": "ENSG00000092054", "version": 16, "symbol": "MYH7", "description": "myosin heavy chain 7",
  "biotype": "protein_coding", "assembly": "GRCh38", "assembly_patch": "GRCh38.p14", "ensembl_release": 116,
  "contig": "14", "start": 23412732, "end": 23436137, "strand": -1,
  "canonical_transcript": "ENST00000355349.4", "locus_ids": ["grch38:MYH7:14:…"],
  "panel_reason": "HPA: group enriched in heart muscle, skeletal muscle, tongue",
  "source": {"name": "Ensembl REST", "version": "release 116", "url": "https://rest.ensembl.org/lookup/id/ENSG00000092054"}
}
```

### Locus (pinned GRCh38 slice)
```json
{
  "locus_id": "grch38:MYH7:14:23412700-23412939", "gene_id": "ENSG00000092054", "gene_symbol": "MYH7",
  "assembly": "GRCh38", "contig": "14", "start": 23412700, "end": 23412939, "length": 240,
  "gene_strand": -1, "sequence_sha256": "…", "reference_asset_id": "grch38_slices_ensembl116",
  "label": "MYH7 region (GRCh38 14:23,412,700-23,412,939)", "features": [ {"feature_type": "exon", "id": "ENSE…", "transcript_id": "ENST….4", "start": …, "end": …, "strand": -1} ],
  "source": {"name": "Ensembl REST /sequence/region", "version": "release 116", "url": "…"}
}
```
Slices are ≤ 1,000 bp, stored under `fixtures/references/grch38_slices/` with a manifest carrying sha256 per slice. They are **read-only**; reverting an edit creates a revision, it never rewrites a slice.

## 3. Endpoints

Every evidence-bearing response carries `"source_status": [{"source_id", "status": "live"|"cached"|"unavailable", "version", "retrieved_at"}]`.
A source that cannot answer returns `status: "unavailable"` and an empty list, never fabricated rows.

| Method + path | Owner | Response |
|---|---|---|
| `GET /api/anatomy/tree?system=&depth=` | Agent 2 | `{nodes: AnatomyNode[], systems: System[], root_id, source_status}` |
| `GET /api/anatomy/search?q=&limit=` | Agent 2 | `{query, results: SearchResult[]}`; `SearchResult = {result_type: "anatomy"|"system"|"gene"|"locus"|"variant"|"trait"|"evidence-category", id, label, matched: string, score, laterality?, corrected_from?}` (typo tolerant; result type always explicit) |
| `GET /api/anatomy/{id}` | Agent 2 | `{node, breadcrumb: {id,label}[], children: AnatomyNode[], relationships, tissue_contexts: AnatomyNode[], source_status}` |
| `GET /api/anatomy/{id}/genes?evidence_kind=&cursor=&limit=` | Agent 2 | `{anatomy_id, items: GeneTissueEvidence[] (ranked by source value, grouped by gene), genes: Gene[], next_cursor, panel_note, empty_reason?, source_status}` |
| `GET /api/genes/{ensembl_id}` | Agent 2 | `Gene` |
| `GET /api/genes/{ensembl_id}/tissues` | Agent 2 | `{gene, items: GeneTissueEvidence[], source_status}` |
| `GET /api/genes/{ensembl_id}/annotations?assembly=GRCh38` | Agent 2 | `{gene, transcripts: [{transcript_id, is_canonical, biotype, start, end}], loci: Locus[], source_status}`; 400 for any assembly other than GRCh38 |
| `GET /api/genes/{ensembl_id}/variants?assembly=GRCh38` | Agent 2 | `{gene, associations: [{association_id, study_accession, pubmed_id, first_author, reported_trait[], efo_traits[], snp_effect_allele[], p_value, beta?, ci?, locations[], source_url}], source: "GWAS Catalog REST API v2", source_status}` |
| `GET /api/genome-edit/loci` | Agent 2 | `{loci: Locus[]}` |
| `GET /api/genome-edit/loci/{locus_id}/window?start=&end=` | Agent 2 | `{locus_id, assembly, contig, start, end, bases, coordinate: "1-based inclusive", strand: "+", sequence_sha256, features}`; window ≤ 400 |
| `POST /api/genome-edit/interpret-command` | Agent 4 | see §4. Never creates a proposal or revision. |
| `POST /api/genome-edit/proposals` | Agent 4 | body `{workspace_id, parent_revision_id, locus_id? , reference_asset_id?, position, alt, source: "text"|"voice"|"manual", note?, anatomy_id?}` → `GenomeEditProposal` (`validation_status: "pending"`) |
| `POST /api/genome-edit/proposals/{id}/validate` | Agent 4 | `GenomeEditProposal` with `validation_status` + `checks[]` + consequence (Ensembl VEP when reachable, else `consequence_status: "unavailable"`) |
| `POST /api/genome-edit/proposals/{id}/apply` | Agent 4 | body `{expected_counter}` + `Idempotency-Key` header → `{workspace, revision, receipt}`; 409 on stale parent/counter; 400 unless `validation_status == "valid"` |
| `GET /api/genome-edit/proposals/{id}` | Agent 4 | `GenomeEditProposal` |
| `POST /api/voice/transcribe` | Agent 4 | 501 `NOT_CONFIGURED` unless the server has a configured STT provider **and** the request carries `X-Voice-Consent: granted`; returns `{transcript, provider, confidence?: number, confidence_kind: "transcription"}`. Never proposes or applies anything. |
| `GET /api/voice/status` (or existing equivalent) | Agent 4 | `{stt: "CONFIGURED"|"NOT_CONFIGURED"|"VERIFIED", provider, verified_at?}` — `VERIFIED` only after a real round-trip test. |

Existing V10 routes stay. Auth/origin rules are unchanged (non-GET only from the canonical origin).

### GenomeEditProposal
```json
{
  "proposal_id": "gep-…", "workspace_id": "ws-…", "parent_revision_id": "rev-…",
  "reference_asset_id": "grch38_slices_ensembl116", "locus_id": "grch38:MYH7:14:…",
  "assembly": "GRCh38", "contig": "14", "position": 23412800,
  "reference_allele": "A", "current_allele": "A", "alternate_allele": "G",
  "normalized_representation": "14-23412800-A-G (GRCh38, VCF-style)",
  "validation_status": "pending", "checks": [{"check": "ref_matches_pinned_reference", "passed": true, "detail": "…"}],
  "consequence_status": "not-computed", "consequence": null,
  "overlapping_features": [{"feature_type": "exon", "id": "…", "transcript_id": "ENST….4"}],
  "evidence_refs": [], "source": "text", "anatomy_id": "UBERON:0002398@left", "created_at": "…"
}
```
`consequence` when computed: `{tool: "Ensembl VEP REST", release, most_severe_consequence, transcript_consequences: [{transcript_id, consequence_terms[], amino_acids?, codons?}], computed_at}`. Consequence terms are VEP output, never a phenotype claim.

### Revision edits (store change, backward compatible)
A revision edit is `{position, ref, alt, current_allele_at_commit}` (legacy synthetic) **plus optional**
`{reference_asset_id, locus_id, assembly, contig, gene_id, gene_symbol, anatomy_ids[], proposal_id}`.
An edit without `reference_asset_id` is synthetic chr22. **Every consumer that applies edits by position must filter by reference** (backend `_sequence_at`/`_edited_window`; frontend `editorModel.applySavedEdits`). `genome_lineage` nodes gain `edits_summary[]` (gene symbol, locus, position, ref, alt, anatomy ids) for the Evolution tab; harness lineage unchanged.

## 4. interpret-command

Request: `{text, workspace_id?, source: "text"|"voice", selection?: {anatomy_id?, gene_id?, locus_id?, position?}}`
Response:
```json
{
  "intent": "EXPLORE | PRECISE_EDIT | TRAIT_GOAL | NEEDS_CLARIFICATION | UNSUPPORTED",
  "explore": {"action": "focus_anatomy | show_genes | show_gene_tissues | show_sequence", "anatomy_ids": [], "gene_ids": [], "locus_id": null},
  "edit": {"locus_id": "…", "reference_asset_id": "…", "assembly": "GRCh38", "contig": "14", "position": 23412800, "stated_ref": "A", "alt": "G"},
  "trait_goal": {"topic": "eye colour", "why_not_automatic": "…", "related_anatomy_ids": [], "explore_actions": [], "complexity_notes": []},
  "reason": "…", "parser": "deterministic-v14", "source": "text"
}
```
Deterministic rules (testable); an optional LLM may only *suggest* and is never authoritative. Vague goals ("stronger legs",
"smarter brain", "bigger hands", "survive extreme cold", "change my eye colour") → `TRAIT_GOAL`, never an edit. A stated
REF that disagrees with the pinned reference → `NEEDS_CLARIFICATION` with the actual base.

## 5. Frontend shared state (owner Agent 4; others import)

`apps/web/src/v14/state/anatomySelection.ts` — zustand:
`{ anatomyId, geneId, locusId, transcriptId, hoverId, drawerOpen, focusRequest: {anatomyId, nonce} | null, quality }`
plus actions `selectAnatomy(id, {focus?: boolean})`, `hover(id|null)`, `selectGene(id|null)`, `selectLocus(id|null)`,
`openDrawer()`, `closeDrawer()`, `backToBody()`, `clear()`. URL params: `anatomy`, `gene`, `locus` (ids only, no
sequence). Selecting anatomy **never** changes the active workspace or reference. Persist nothing sensitive.

R3F isolation (unchanged V12 rule): scenes read zustand stores; no setState per frame.

## 6. UI rules (all agents)
- First view: body, DNA (helix + real sequence strip labelled `Baseline · GRCh38 · <locus>`), composer
  "What would you like to explore or edit?" + mic + one secondary "Explore body parts". Nothing else.
- **No sub-tabs** (user directive, V12-ADR-009). The evidence drawer shows the four lenses (Anatomy, Genes expressed here,
  Genetic associations, Sequence & edits) as stacked, collapsible sections, not a tablist.
- Evidence tier is shown as text + icon shape, never colour alone. No numeric confidence the source did not report.
- Body anatomy never changes from an edit. The edit pulse (V12-ADR-011) stays an acknowledgement only.
- Copy: "Genes with evidence in this tissue", "Variants associated with related traits", "Curated gene–phenotype
  relationships". Never "genes that control X".

## 7. Ownership (exclusive write)

| Agent | Owns |
|---|---|
| 1 Anatomy atlas + 3D | `apps/web/src/features/anatomy/**`, `apps/web/public/anatomy/**` (if any), `scripts/anatomy/**`, `apps/web/tests/v14/anatomy*.test.ts`, `docs/milestones/V14_NOTES_AGENT1.md` |
| 2 Evidence + mapping | `services/runtime/anatomy/**`, `services/api/app/routes/anatomy.py`, `scripts/v14_ingest_sources.py`, `fixtures/v14/**`, `fixtures/references/grch38_slices/**`, `services/tests/test_v14_anatomy*.py`, `docs/milestones/V14_DATA_SOURCES.md`, `docs/milestones/V14_NOTES_AGENT2.md` |
| 3 Editor UX | `apps/web/src/v12/editor/**`, `apps/web/src/features/genome-editor/**`, `apps/web/tests/v14/editor*.test.ts(x)`, `docs/milestones/V14_NOTES_AGENT3.md` |
| 4 Contracts + persistence | `services/runtime/genome_workspace/**`, `services/runtime/genome_edit/**`, `services/api/app/routes/genome_edit.py`, `services/api/app/routes/voice.py`, `services/integrations/elevenlabs/**`, `services/integrations/raindrop/**` (additive), `apps/web/src/v14/**`, `services/tests/test_v14_genome_edit*.py`, `apps/web/tests/v14/api*.test.ts`, `docs/milestones/V14_NOTES_AGENT4.md`; after the V12 agents finish: minimal wiring in `apps/web/src/v12/{evolution,simulation,library,api,state}/**` |
| 5 QA + guardrails | `apps/web/e2e/v14/**`, `apps/web/tests/v14/guardrails*.test.ts`, `services/tests/test_v14_guardrails*.py`, `scripts/verify_v14.sh`, `scripts/benchmark_v14*`, `artifacts/milestones/v14/**`, `docs/milestones/V14_{TEST_RESULTS,SCIENTIFIC_GUARDRAILS,LICENSE_REVIEW}.md`, `docs/milestones/V14_NOTES_AGENT5.md` |
| Coordinator | `PROGRESS.md`, `DECISIONS.md`, `AGENT_OWNERSHIP.md`, `Makefile`, `services/api/app/main.py`, `RESEARCH.md`, `THIRD_PARTY_NOTICES.md`, `docs/milestones/V14_{UI_CONTRACTS,ANATOMY_EDITOR_AUDIT,DEMO}.md` |

## 8a. In-process Python interfaces (Agent 2 provides, Agent 4 consumes)
```python
# services/runtime/anatomy/registry.py
def get_node(anatomy_id: str) -> dict | None            # AnatomyNode dict
def search(query: str, limit: int = 20) -> list[dict]   # SearchResult dicts (typed result_type)
def list_nodes() -> list[dict]
def resolve_text(text: str) -> list[str]                # anatomy ids mentioned in free text (laterality-aware: "left hand" -> UBERON:0002398@left)
# services/runtime/anatomy/loci.py
REFERENCE_ASSET_ID: str                                   # "grch38_slices_ensembl116"
def list_loci() -> list[dict]                             # Locus dicts
def get_locus(locus_id: str) -> dict | None
def locus_for_position(contig: str, position: int) -> dict | None
def base_at(locus_id: str, position: int) -> str          # genomic 1-based; ValueError outside the slice
def window(locus_id: str, start: int, end: int) -> str    # ValueError if > 400 bp or outside
def verify_checksums() -> list[dict]                      # [{locus_id, ok, expected, actual}]
# services/runtime/anatomy/genes.py
def get_gene(gene_id_or_symbol: str) -> dict | None       # Gene dict
```
React integration surface (Agent 1 provides, Agent 3 consumes), exported from `apps/web/src/features/anatomy/index.ts`:
- `<AnatomyStage rect={{x, y, width, height}} quality reducedMotion pulseRef? />` — R3F element rendered inside the
  shell canvas; draws the body into that CSS-pixel rect with **its own camera** (focus/zoom never moves the DNA helix),
  handles hover/click picking inside the rect and reads/writes `useAnatomySelection`. `pulseRef` = clock time of the
  edit-acknowledgement sweep (V12-ADR-011).
- `<AnatomyTree />` (DOM, accessible tree + search over `/api/anatomy/tree`), `<AnatomyFallback2D />` (SVG body for no-WebGL
  and phones), `anatomyMeshManifest` (JSON: `asset_id -> anatomy_id, parent_id, system_ids, side, camera_anchor, bounds, display_name`).

## 8. Safety rails for every agent
- Never POST/PATCH/DELETE to `127.0.0.1:8000` (the user's real store) and never stop :5173 / :8000. Use a throwaway backend:
  `V10_STATE_PATH=/tmp/v14_agent<n>/state.json uvicorn services.api.app.main:app --port 814<n>`, and for the UI
  `E2E_API_PORT=814<n> E2E_WEB_PORT=514<n> E2E_DIST=/tmp/v14_agent<n>_dist npx vite --config e2e/vite.e2e.config.ts` (from `apps/web`).
- Never print or commit secrets from `.env`. No raw sequence, audio or transcripts to telemetry.
- No GitHub Actions, no push, no deploy.
- Do not edit `PROGRESS.md` / `DECISIONS.md`; write your notes file. Do not edit files you do not own; ask in your notes.
