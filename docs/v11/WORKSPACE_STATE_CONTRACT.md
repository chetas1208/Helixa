# V11 workspace state contract

Authoritative pointer for this build: one `active_workspace_id` inside `artifacts/v10/state.json` (or `V10_STATE_PATH`).

A workspace has:

- `workspace_id`
- `revision_counter` (optimistic lock on commit and select)
- `active_genome_revision_id`
- `active_harness_version_id` (`harness-pche-baseline`, not the genome revision)
- revisions with `edits`, `preview_1_48`, and `sequence_sha256`

Selecting workspace B does not rewrite workspace A. A commit with the wrong counter returns 409. The synthetic FASTA file is not modified.

A simulation record stores `workspace_id`. The Studio screen drops the on-screen simulation when the selected workspace changes, so frames from A are not shown while B is active.

This file is local JSON. It is not an Atlas transaction.
