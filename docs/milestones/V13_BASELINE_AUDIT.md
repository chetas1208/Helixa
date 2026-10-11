# V13 baseline audit

The live editor, library, and sandbox already call `/api/v10`. That store is a local JSON file, not Atlas. The population engine is `services/runtime/population`, not `services/runtime/evolution` (that package is the analysis-harness search and was left alone).

Missing before this pass, and now present on the same store:

- Active snapshot with `selection_version`
- Text interpret that refuses a wrong reference base and does not apply the edit
- Separate genome lineage and harness lineage
- Body descriptor fixed at `ILLUSTRATIVE` with `anatomy_changed: false`
- Simulation list by workspace, playback manifest whose duration does not change the result hash
- Rename and archive
- `POST /api/voice/transcribe` returns HTTP 501 and `NOT_CONFIGURED`

Still absent: Atlas transactions, auth, async simulation jobs, SLiM, and a real speech provider.
