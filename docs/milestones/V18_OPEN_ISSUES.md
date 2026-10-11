# V18 open issues

- ClinGen is not configured. Do not treat that as a curated classification.
- Open Targets returned no target hits for the pigmentation token query. A different query can hit; a zero is not filled in.
- GWAS and HPA are implemented and were probed, but the no-gene question does not call them. Naming several genes stays `ambiguous` and does not pick one.
- Investigations live in process memory. A restart drops them. They are not yet an immutable Mongo snapshot.
- `POST .../confirm` checks REF and does not write a revision. The existing genome-edit proposal path still performs the commit.
- Voyage semantic search is not part of this chain.
- Playwright end-to-end for prompt → investigation → confirm was not run.
- Europe PMC titles are metadata. The papers were not read, and a title is not a finding.
