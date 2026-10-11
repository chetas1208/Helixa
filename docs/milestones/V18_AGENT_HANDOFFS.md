# V18 handoffs

One process, five sequential slices. Subagents were not launched.

| Slice | Result |
|---|---|
| A Sources | `services/runtime/research/sources/`. Ensembl and Europe PMC used live. GWAS v2, Open Targets, and HPA implemented and probed. ClinGen fail-closed. |
| B Evidence | In-memory investigation record, bundle hash, claim verifier. Mongo collections were not renamed and were not required for the live abstention. |
| C Intent | `parse_intent` plus `investigate`. Trait questions abstain. Explicit alleles are not applied. |
| D UI | `ResearchEvidencePanel` gained **Check sources**. The body, helix, and four tabs were not rebuilt. |
| E QA | `services/tests/test_v18_research.py`, `test_v18_live_ensembl.py`, `make verify-v18`. |

Contracts: `docs/milestones/V18_EVIDENCE_SCHEMA.md`.
