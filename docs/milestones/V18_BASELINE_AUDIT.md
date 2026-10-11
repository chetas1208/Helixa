# V18 baseline audit

Inspected 2026-10-11 before the research routes were added.

- Genome edit interpret is `deterministic-v14` in `services/runtime/genome_edit/parser.py`. Trait wishes already abstain from inventing an allele (`researchProposal.ts`).
- Anatomy evidence (`services/runtime/anatomy/evidence.py`) reads cached Bgee, HPA, and GWAS v2 files. Expression is not turned into a phenotype. Those caches are not a live investigation of an arbitrary prompt.
- V16 Voyage retrieval searches a small curated paraphrase corpus and stays lexical while `VOYAGE_ENABLED` is false.
- No `/api/research/investigations` route existed.
- The four-tab UI and HELIXA wordmark were already in place. This milestone does not replace them.

The new path is `POST /api/research/investigations`. It does not replace interpret-command and it does not write a genome revision.
