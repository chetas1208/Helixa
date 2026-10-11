# V18 retrieval evaluation

This is not a Voyage quality run. Voyage stayed out of the investigation.

## What was measured

One live question, 2026-10-11:

`Show me research about pigmentation and UV exposure, and whether any known variants relate to these traits.`

Query tokens sent to Europe PMC after dropping instruction words: pigmentation, UV, exposure, variants (see `_query_for`).

| Source | Result |
|---|---|
| Uberon local | `UBERON:0002097` Skin |
| Europe PMC | 3 records: PMID `42827362`, `42737661`, `42565097` |
| Open Targets search | 0 target hits for that query string |
| Ensembl / GWAS / HPA | skipped, because the user did not type one gene symbol |
| Edit proposal | abstain |

The three PMIDs and titles are copied from the Europe PMC JSON into `artifacts/milestones/v18/live_pigmentation.json`. Titles include a pigmentation paper (`42565097`) and a photoexposed-skin paper (`42827362`). That is retrieval of metadata, not a graded reading of the studies.

No Recall@k or nDCG is reported. There is no frozen 15-query judgment set, so those scores would be invented. Mocked tests cover abstention, fabricated PMID rejection, and the MC1R fixture path.

## Live Ensembl

`test_v18_live_ensembl.py` called `lookup/symbol/homo_sapiens/MC1R` and required an `ENSG` id, symbol `MC1R`, assembly `GRCh38`, contig `16`. It passed in this session.
