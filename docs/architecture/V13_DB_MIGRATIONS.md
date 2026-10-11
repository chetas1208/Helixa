# V13 database

No new Mongo migration was applied. Workspace, revision, and simulation records remain in `V10_STATE_PATH` or `artifacts/v10/state.json`.

`selection_version` increments on select and on archive of the active workspace. That is a file compare-and-swap under a process lock, not a Mongo transaction.

Atlas mode was not probed in this pass. Do not describe this file as Atlas.
