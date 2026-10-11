# V10 dependency audit

| Piece | Use | License note |
| --- | --- | --- |
| Existing FastAPI, Pydantic, React, Three | Reused | Already in the repo |
| Synthetic chr22 FASTA | Editable slice | Project fixture, not GRCh38 |
| SLiM 5 | Not installed, not vendored | GPL-3.0. Do not paste upstream source into this tree |
| tskit, msprime, stdpopsim | Not installed | Would be ancestry tools, not a substitute for this forward step |
| NASA POWER | Not called | `NASA_POWER_ENABLED=false` |
| Biomni, GEPA, Meta-Harness | Unchanged from V8 | Not biological evolution |
| NumPy | Not added | Binomial sampling is in the standard library |

No new third-party source tree was cloned for V10.
