# V18 source matrix

Checked against live responses on 2026-10-11 unless noted. A row is not "integrated" just because the function exists.

| Source | Endpoint used | Auth | License note | This run |
|---|---|---|---|---|
| Ensembl REST | `GET /lookup/symbol/homo_sapiens/{symbol}` | none | Ensembl terms. Annotation only. | **Live.** `MC1R` → `ENSG00000258839`, GRCh38, chromosome 16. Pytest `test_v18_live_ensembl.py` passed. |
| Europe PMC | `GET /europepmc/webservices/rest/search` | none | Metadata and titles only. Full text not stored. | **Live** for the pigmentation question. PMIDs `42827362`, `42737661`, `42565097` in `artifacts/milestones/v18/live_pigmentation.json`. |
| GWAS Catalog REST v2 | `GET /gwas/rest/api/v2/associations?mapped_gene=` | none | Association is not a causal edit. v1 findBy routes are not used. | **Probed live** for `MC1R` (association `226283227`, p `5e-54`). Not called when the user names no gene. |
| Open Targets GraphQL v4 | `POST /api/v4/graphql` `search` | none | Search hit is not a phenotype probability. | **Probed live** for `MC1R` → `ENSG00000258839`. The long pigmentation query returned 0 target hits and that zero is kept. |
| Human Protein Atlas | `GET /{ensembl_id}.json` | none | CC BY attribution. Expression is not organ shape. | **Probed live** for `ENSG00000258839` (RNA tissue specificity field present). Called only after a resolved Ensembl id. |
| Uberon | Local registry node `UBERON:0002097` | none | Pinned local term, not a fresh OLS download. | Local. Skin matched the word pigmentation. |
| ClinGen | none | none | Not downloaded. | **not_configured.** No classifications are invented. |
| Voyage | existing V16 adapter | `VOYAGE_API_KEY` | Embeddings only. | Not used by this investigation. Still disabled until `VOYAGE_ENABLED=true`. |

Rate limits: each connector retries 429/5xx twice with a short backoff, then `SOURCE_UNAVAILABLE`. No synthetic paper is substituted.
