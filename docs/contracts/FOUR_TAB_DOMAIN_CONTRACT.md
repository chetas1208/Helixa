# Four-tab domain contract

One active workspace id is the binding object. A genome revision id and a harness version id are different strings.

| Tab | Reads |
| --- | --- |
| Genome editor | `GET /api/v10/genome/window`, proposals, commit |
| Genome and harness history | `genome-lineage` and `harness-lineage` |
| Earth simulation | `POST /api/v10/evolution/simulations`, `GET .../playback` |
| Library | `GET /api/v10/genome/workspaces`, `POST .../select` |

`GET /api/v10/genome/workspaces/active/snapshot` returns `selection_version`, the workspace, the genome revision id, the harness version id, the latest simulation id for that workspace, and a body descriptor. The body effect class is `ILLUSTRATIVE`. Anatomy does not change.

Selecting a workspace increments `selection_version`. An archived workspace cannot be selected. A repeated commit `Idempotency-Key` does not create a second revision.

Playback `duration_seconds` is presentation. The stored `result_sha256` and frames stay the same if the duration changes.
