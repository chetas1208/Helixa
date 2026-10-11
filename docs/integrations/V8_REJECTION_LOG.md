# V8 rejection log

| Proposal | Disposition | Why |
|---|---|---|
| Instantiate Biomni's agent inside the API worker | Rejected | Upstream README: generated code runs with broad system privileges. No rootless runtime was provisioned, so the fail-closed path is no agent. |
| Import Meta-Harness reference examples | Rejected | Examples call an external coding agent and are not a production orchestrator. Local deterministic patches are used instead. Provenance is not labeled `META_HARNESS`. |
| Call `gepa.optimize` | Rejected for this campaign | Requires a reflection model. No genomic payload is sent. Status `INSTALLED_UNCONFIGURED`. |
| `biomni_variant_consequence_lookup` | Rejected at invoke | Would have emitted a fabricated missense/MODERATE label. The method raises and the adapter returns `ERROR`. |
| Liftover without a chain | `INCONCLUSIVE` | No chain file. Coordinates are not rewritten. |
| Candidate `execute_shell` plus disabling contig checks | Rejected by `PolicyEnvelope` before evaluation | Recorded in `artifacts/v8/harness_diff.json`. |
| nf-core/sarek, BioAgent Bench datasets, BioinformaticsAgent runtime | Not integrated | Trees were cloned and licensed, then left unused. Dataset files and Nextflow were not installed. |
| Atlas verification from local MongoDB | Rejected | `scripts/verify_v8_atlas.py` exits 2 unless `MONGODB_REQUIRE_ATLAS=true` and the URI contains `mongodb.net`. |
| Hardcoded Proof-page success receipt | Removed | The Proof view loads `/api/v8/latest` or shows an empty state. |
