# V14 license review

Owner: Agent 5. Date: 2026-10-11.
Scan encoded by `services/tests/test_v14_guardrails_license.py` and `apps/web/tests/v14/guardrails.test.ts`.

## Banned atlases (must not appear in the tree)

| Atlas | License problem | Result |
|---|---|---|
| **Z-Anatomy** | CC BY-SA 4.0; mixed-provenance assets; share-alike unsafe to embed | **Not in tree.** Mentions exist only in V14 decision/audit/guardrail docs as a ban. |
| **BodyParts3D** | CC BY-SA 2.1 Japan; share-alike / embedding terms unsafe | **Not in tree.** Same: docs-only ban (V14-ADR-001). |

Anatomy for V14 is original parametric / lofted meshes and hit proxies under `apps/web/src/features/anatomy/**` (Agent 1). Unmodeled organs are searchable with `mesh_status: unavailable`.

## Fixture licenses (what is actually on disk today)

| Path | What it is | License / terms | Notes |
|---|---|---|---|
| `fixtures/references/ref_synthetic_chr22.fasta` | Local educational contig (117,500 bp) | Original DIAMOND fixture. Not a genome download. | `official_grch38=false`. Never labelled GRCh38. |
| `fixtures/references/grch38_slices/` | Pinned ≤1000 bp GRCh38 slices + sha256 manifest | **Not landed yet** (Agent 2). When present: sequences retrieved from Ensembl REST release 116; retain Ensembl/EMBL-EBI attribution; slices are read-only. | Guardrail tests fail until this directory exists. |
| `fixtures/v14/**` | Annotation cache / ontology extract | **Not landed yet** (Agent 2). Must not vendor Z-Anatomy or BodyParts3D. | — |

## Source attribution (required on every evidence payload)

These services are queried or cached; they are not redistributed as full databases. Every evidence-bearing response carries `source_status[{source_id,status,version,retrieved_at}]`.

| Source | What V14 uses | Attribution / terms |
|---|---|---|
| **Uberon via OLS4** | Anatomy ids, labels, partonomy | Uberon: CC BY 3.0. OLS4 is an EMBL-EBI service. Cite Uberon + the OLS4 ontology version string on each node `source`. |
| **Ensembl REST** | Gene lookup, canonical transcript, region sequence, VEP consequence | Ensembl release **116**, assembly **GRCh38.p14**. Cite Ensembl REST + release on gene/locus/consequence payloads. Software is Apache-2.0; data under EMBL-EBI Terms of Use. |
| **Human Protein Atlas (HPA)** | Tissue enrichment / panel reason | [HPA licence](https://www.proteinatlas.org/about/licence): CC BY-SA 3.0. Cite HPA and the retrieved version. Do not drop share-alike credit. |
| **Bgee** | RNA-Seq expression calls (score, FDR, quality) keyed by `UBERON:` | [Bgee copyright](https://www.bgee.org/about/copyright): data CC0; still cite Bgee + version (`Bgee 15.x` or the live version string). Expression ≠ causality. |
| **GWAS Catalog REST API v2** | Variant–trait associations | EMBL-EBI Terms of Use. Cite Catalog v2, `study_accession`, PubMed id, first author, reported trait. Never a v1 URL as `source`. |
| **Synthetic chr22** | Legacy V10 teaching contig | Original fixture; see row above. |

## What this review does not grant

- Redistributing HPA or Uberon as a standalone atlas.
- Shipping a full GRCh38 FASTA.
- Mixing share-alike third-party meshes into the independently licensed repo.

`THIRD_PARTY_NOTICES.md` remains free of Z-Anatomy and BodyParts3D. Coordinator owns that file; Agent 5 will ask if a fixture row needs adding once Agent 2 lands slices.
