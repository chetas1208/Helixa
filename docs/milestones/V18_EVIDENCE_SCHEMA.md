# V18 evidence schema

Version: `helixa-research-1`. Stored in process memory (`InvestigationStore`). Optional Mongo collections from V16 are unchanged. No database rename.

An investigation record contains:

- `intent`: operation `explore`, `propose_edit`, or `refuse`; redacted excerpt; gene tokens the user actually typed.
- `records`: parsed source rows with `source_id`, external id, and `source_url`.
- `claims`: text that names only those ids. `verify_claim_support` drops a claim whose PMID, Ensembl id, or GWAS association id is not in the records.
- `proposal`: `abstain` when no `contig:position REF>ALT` was typed. `blocked_until_reference_check` when an allele was typed. This route does not write a revision.
- `bundle_hash`: sha256 of the source ids, not of a model essay.

Claim types used: `ANNOTATED`, `ASSOCIATED`, `OBSERVED`, `HYPOTHESIS`. A tissue-expression row cannot be saved as `PREDICTED` with predicate `BODY_FROM_EXPRESSION`.

`POST /api/research/edit-proposals/{id}/confirm` compares REF with `try_base_at` and returns `reference_matched_not_committed` or 409. `wrote_revision` is false.
