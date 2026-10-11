# V10 contracts

Identifiers in use:

- `workspace_id` (`ws-…`)
- `genome_revision_id` (`rev-…`)
- `harness_version_id` fixed string `harness-pche-baseline` (analysis harness, not an edited genome)
- `simulation_id` (`sim-…`)
- `result_sha256` over the simulation payload

Routes mounted at `/api/v10`:

- `GET /genome/baselines`
- `GET /genome/window?start=&end=`
- `POST /genome/workspaces`
- `GET /genome/workspaces`
- `GET /genome/workspaces/active`
- `GET /genome/workspaces/{id}`
- `POST /genome/workspaces/{id}/select` body `{expected_counter}`
- `POST /genome/workspaces/{id}/branch` body `{name}`
- `POST /genome/workspaces/{id}/proposals` body `{position, alt, note}`
- `POST /genome/workspaces/{id}/commit` body `{proposal_id, expected_counter}`
- `GET /genome/workspaces/{id}/intelligence`
- `GET /evolution/environments`
- `GET /evolution/parameters`
- `POST /evolution/simulations`
- `GET /evolution/simulations/{id}`

A stale `expected_counter` returns HTTP 409. A horizon that needs more than 2000 generations returns HTTP 409 and does not emit frames. `Idempotency-Key` returns the stored simulation.

State file: `V10_STATE_PATH` or `artifacts/v10/state.json`. This is local JSON. It is not an Atlas write.
