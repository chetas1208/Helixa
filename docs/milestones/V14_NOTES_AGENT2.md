# V14 Agent 2 notes — Genomic evidence research & mapping

Status: **routes + offline tests pass**. Coordinator: do not treat this as a contract change unless a request is listed below.

## What landed

Python API (contract §8a):

- `services/runtime/anatomy/registry.py` — `get_node`, `search`, `list_nodes`, `resolve_text`
- `services/runtime/anatomy/loci.py` — `REFERENCE_ASSET_ID`, `list_loci`, `get_locus`, `locus_for_position`, `base_at`, `window`, `verify_checksums`
- `services/runtime/anatomy/genes.py` — `get_gene`

FastAPI (`services/api/app/routes/anatomy.py`, optional router already registered in `main.py`):

- `GET /api/anatomy/tree|search|{id}|{id}/genes`
- `GET /api/genes/{id}|{id}/tissues|{id}/annotations|{id}/variants`
- `GET /api/genome-edit/loci` and `/loci/{locus_id}/window`

Ingest: `scripts/v14_ingest_sources.py` (`--offline` uses `fixtures/v14/cache/` only).

Tree: 77 nodes. Level A exterior L/R + Level B organs aligned with Agent 1 ids (`UBERON:0002398@left` etc.). Every CURIE verified against OLS4 Uberon **2026-10-01**. Lateral composites only where Uberon has no class. Dedicated classes used for L/R lung, kidney, eye, ear.

Pinned slices (Ensembl 116 / GRCh38.p14, 240 bp, sha256 in manifest): MYH7, PAX6, COL1A1, CFTR, HBB, TYR, BDNF, ACTN3.

Evidence: Bgee + HPA → `tissue-expression` / `observed-expression` with `measured_anatomy_id` + contract caveat. GWAS **v2** → `variant-trait-association` / `statistical-association` with study accession, PubMed, traits, p-value, beta/CI when present. No phenotype derived from expression.

## Commands

```bash
# live ingest (User-Agent required). Do not point at :8000.
python scripts/v14_ingest_sources.py

# rebuild derived fixtures from cache (no network)
python scripts/v14_ingest_sources.py --offline

# tests
python -m pytest services/tests/test_v14_anatomy.py services/tests/test_v14_anatomy_ingest.py -q

# throwaway API (never :8000; never kill :5173/:8000)
mkdir -p /tmp/v14_agent2
V10_STATE_PATH=/tmp/v14_agent2/state.json \
  .venv/bin/python -m uvicorn services.api.app.main:app --host 127.0.0.1 --port 8142
```

Live probe on `:8142` (2026-10-11): tree 200 (70 spatial nodes), `left hand` → `UBERON:0002398@left`, heart genes 8 expression rows with caveat/tier, left ear `empty_reason` + 0 items, MYH7 annotations 62 transcripts, GRCh37 → 400, GWAS v2 24 associations (`GCST90856967`), 8 loci, MYH7 window 21 bp.

## Results (2026-10-11)

| Step | Result |
|---|---|
| OLS4 Uberon | 82/82 CURIEs verified; versionIri `…/releases/2026-10-01/uberon.owl` |
| Ensembl | release 116, GRCh38.p14, REST 15.12. MYH7 `ENSG00000092054` 14:23412732-23436137 strand -1, canonical `ENST00000355349.4` |
| Slices | 8 × 240 bp; MYH7 window `14:23412700-23412939` (contract example) |
| Bgee | 8 genes; MYH7 105 calls (e.g. apex of heart score 99.94, FDR <= 1e-14, gold) |
| HPA | 8 per-gene JSON; MYH7 group enriched heart muscle / skeletal muscle / tongue |
| GWAS v2 | MYH7 24 associations (accession, PubMed, traits, p, beta, CI present) |
| pytest | **13 passed** (`test_v14_anatomy.py` + `test_v14_anatomy_ingest.py`) |
| :8142 live | tree/search/heart/genes/annotations/GWAS/loci/window 200; GRCh37 400; left ear empty_reason |
| Bgee homepage | 403 with our User-Agent; version **15.2.5** taken from the public listing, not the API |

## OLS4 corrections vs textbook guesses

| Guess | OLS4 label (kept id, fixed ontology_label) |
|---|---|
| UBERON:0000915 “thorax” | thoracic segment of trunk |
| UBERON:0001467 “pectoral girdle” | shoulder |
| UBERON:0001235 “adrenal gland” | adrenal cortex (Agent 1 id retained) |
| UBERON:0002387 | pes (foot) — used for L/R foot |
| UBERON:0002398 | manus (hand) — `@left/@right` (no lateral class) |
| Left/right lung, kidney, eye, ear | dedicated classes; not composites |

## Interop with Agent 1 / Agent 4

- Node ids match `apps/web/src/features/anatomy/ids.ts` so the atlas and API share identity.
- Agent 4 already imports `services.runtime.anatomy.{loci,registry,genes}` from `genome_edit/references.py`. Those modules now exist.
- Face and fingers stay `DIAMOND:` as Agent 1 bound meshes to those ids. OLS4 *does* have `UBERON:0001456` (face) and `UBERON:0002389` (manual digit) but no lateral digit classes.

## Leftover gaps

- Bgee calls are often on fine-grained structures. We map a curated subset (apex of heart, palpebral conjunctiva, pons, cerebellum parts, …) onto tree nodes and always keep `measured_anatomy_id`. Unmapped calls still appear on `/api/genes/{id}/tissues`.
- HPA tissue names are mapped only when the name is in `hpa_tissue_map.json` (verified CURIEs). “skin 1” is mapped; we did not download `search_download.php`.
- No HPO / Open Targets phenotype rows. Unavailable source → empty list + `source_status: unavailable`. We do not invent `curated-gene-phenotype`.
- `UBERON:0002305` in the HPA map is OLS4 “layer of hippocampus”, not a generic hippocampus class.
- Did not start or touch `:8000` / `:5173`.

## Contract change requests

None.
