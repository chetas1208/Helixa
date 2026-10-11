# V13 domain model

Implemented on the existing JSON workspace file:

- Reference: synthetic chr22, `official_grch38: false`
- Workspace with genome revision and harness version as separate ids
- Edit proposal then commit. Commit is the confirmation. Interpret does not apply.
- Body descriptor: `ILLUSTRATIVE`, anatomy unchanged
- Simulation attached to `workspace_id`, with a playback manifest

Not implemented as separate Mongo collections. See ADR-023.
