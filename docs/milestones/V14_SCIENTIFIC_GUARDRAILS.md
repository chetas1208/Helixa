# V14 scientific guardrails

Owner: Agent 5. Locked against `docs/milestones/V14_UI_CONTRACTS.md` v1.
These rules are encoded in `services/tests/test_v14_guardrails*.py` and `apps/web/tests/v14/guardrails*.test.ts`.
A missing Agent 1–4 file is a **fail**, not a skip.

## Relationship kinds

`Relationship.kind` is one of:

| Kind | Meaning | May be derived from expression? |
|---|---|---|
| `ANATOMICAL_PART_OF` | Uberon partonomy | n/a |
| `SYSTEM_MEMBERSHIP` | body system membership | n/a |
| `GENE_EXPRESSED_IN` | measured RNA/protein in a tissue | this **is** expression |
| `REGULATORY_ASSOCIATION_IN_TISSUE` | regulatory evidence in a tissue | no |
| `VARIANT_TRAIT_ASSOCIATION` | GWAS Catalog v2 (or equal) study row | **never** |
| `CURATED_GENE_PHENOTYPE_RELATIONSHIP` | curated gene–phenotype link | **never** |
| `VISUAL_ASSET_FOR_ANATOMY` | mesh / hit proxy | n/a |
| `EDIT_OVERLAPS_GENE_OR_REGULATORY_REGION` | genomic overlap of an edit | n/a |

Contract rule: kinds 5 and 6 (`VARIANT_TRAIT_ASSOCIATION`, `CURATED_GENE_PHENOTYPE_RELATIONSHIP`) are **never derived from** kind 3 (`GENE_EXPRESSED_IN`). A Bgee or HPA expression score must not be rewritten as a phenotype or trait association.

## Interpretation tiers

| `evidence_kind` | Required `interpretation_tier` |
|---|---|
| `tissue-expression` | `observed-expression` |
| `variant-trait-association` | `statistical-association` |
| `curated-gene-phenotype` | `curated-relationship` |
| `anatomical-part-of` | `reference-fact` |
| `regulatory-association` | `statistical-association` or `curated-relationship` (source decides) |
| `genomic-overlap` | `reference-fact` |

No invented numeric confidence. `quantitative_value` is only a number the source itself reports, with `units`.

Required expression caveat (exact):

> Expression shows the gene is active in this tissue. It does not show that editing it changes this organ.

## Laterality

- Left and right ids are distinct.
- Use a real Uberon lateral class when it exists (example: left lung `UBERON:0002168`).
- Otherwise `UBERON:<id>@left` / `@right` (example: left hand `UBERON:0002398@left`).
- `resolve_text("left hand")` → `UBERON:0002398@left`.
- Unverified terms are `DIAMOND:` with `ontology_status: "unmapped"`, never presented as Uberon.

## Reference assembly

- Pinned slices are GRCh38 (Ensembl release 116), asset `grch38_slices_ensembl116`.
- `GET /api/genes/{id}/annotations?assembly=GRCh37` and `.../variants?assembly=GRCh37` → **400**.
- Proposal validation includes `ref_matches_pinned_reference`.
- A stated REF that disagrees with the pinned base → `NEEDS_CLARIFICATION`, not an edit.
- Applying or reverting an edit creates a revision. It **never** rewrites a slice file.
- Synthetic chr22 stays `ref_synthetic_chr22` and is never labelled GRCh38.

## GWAS

- Source string is exactly `GWAS Catalog REST API v2`.
- Each association carries study context: `association_id`, `study_accession`, `pubmed_id`, `first_author`, `reported_trait`, `p_value`, `source_url`.
- A source outage is `source_status.status = cached | unavailable` and an **empty** list. Never fabricated rows.

## Trait goals are not mutations

These texts (and obvious variants) are `TRAIT_GOAL`, never `PRECISE_EDIT`:

- make my hands bigger / bigger hands
- stronger legs
- smarter brain
- survive extreme cold
- change my eye colour / color

`POST /api/voice/transcribe` never creates a proposal or revision. A transcript is display-only until the user confirms; apply still needs validate + confirm.

## Body geometry

- `body_descriptor.anatomy_changed` is always `false`.
- `effect_class` is `ILLUSTRATIVE`.
- DNA helix / sequence strip may change allele. Anatomy meshes do not morph from an edit.
- Reduced motion disables camera ease and the edit pulse, not editing.

## Empty organ

An organ with no evidence returns `items: []` and a non-empty `empty_reason`. It does not invent genes.

## Banned copy

Never in product UI or evidence payloads:

- "genes that control X" / "gene that controls"
- "controls this organ" / "causes this organ"
- "will enlarge" / "will make your hands"

Required labels:

- "Genes with evidence in this tissue"
- "Variants associated with related traits"
- "Curated gene–phenotype relationships"
- First viewport: "What would you like to explore or edit?"
- Sequence strip: `Baseline · GRCh38 · <locus>`

Simulation labels an unsupported phenotype **`not modeled`**.

## Lineage

Genome revision lineage (`kind: GENOME_REVISION`) is not harness lineage (`kind: ANALYSIS_HARNESS`). Ids are disjoint. `edits_summary[]` belongs on genome nodes only.
