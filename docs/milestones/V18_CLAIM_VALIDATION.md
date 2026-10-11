# V18 claim validation

Protected rules, with the check that enforces them:

1. A PMID in a claim must be a `pmid` on a returned Europe PMC row. Fixture PMID `99999999` fails `verify_claim_support`.
2. An Ensembl id in a claim must be the lookup id. Live `MC1R` id was `ENSG00000258839`.
3. A GWAS association id must be the id returned by v2. The probe id was `226283227`. The claim text says the association is not an appearance edit.
4. HPA RNA specificity is `OBSERVED` expression. A `BODY_FROM_EXPRESSION` prediction is rejected.
5. Trait questions without `chr:pos REF>ALT` get `proposal.status = abstain`.
6. Clinical-treatment and "design a virus" wording is `operation: refuse` before any HTTP call.
7. ClinGen has no payload.
8. Confirming an edit does not create a genome revision.

Live pigmentation claims are title metadata plus the local Uberon skin term. They are not a reading of the papers and not an edit.
