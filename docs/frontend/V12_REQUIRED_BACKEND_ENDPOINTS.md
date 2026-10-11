# Backend gaps the V12 UI reports honestly (nothing here is faked in the frontend)

| # | Missing capability | Frontend behaviour today | Contract needed |
|---|---|---|---|
| 1 | Natural-language edit interpretation | Local deterministic grammar parser handles explicit statements ("change base 4 to A"); anything else asks the user to select a base. Labelled "Parsed locally", never "agent". | `POST /api/v10/genome/workspaces/{id}/interpret {text, selected_position?}` -> `{proposals[], ambiguity?}` |
| 2 | Speech-to-text | Text always works. Voice uses browser Web Speech API only if present, with a privacy disclosure; otherwise "Voice transcription not configured". ElevenLabs TTS is NOT STT. | `POST /api/voice/transcribe` (or ephemeral realtime token) |
| 3 | Simulation > 2000 generations | Backend returns 409. UI computes the minimum declared generation time (`horizon / 2000`) and shows it as an editable assumption; 2,000,000 y needs >= 1000 y/generation. | Tier-B coarse engine or chunked frames |
| 4 | List simulations per workspace | Client remembers simulation ids per workspace (ids only, localStorage) and refetches by id. | `GET /api/v10/evolution/simulations?workspace_id=` |
| 5 | Simulation progress/cancel | Run is one synchronous request: UI shows pending -> complete/failed; no fake ETA or progress. | async job + status + cancel |
| 6 | Replicates | Client submits N runs with distinct seeds; each is a real result. | `replicates` on the request |
| 7 | Rename / duplicate / archive workspace | Controls disabled with explanation. Fork = `branch`. | PATCH/POST routes |
| 8 | Per-workspace harness lineage | Harness track reads `/api/harnesses` + `/lineage`; links to a workspace only when ids match, else says so. | workspace -> harness lineage |
| 9 | Insert/delete edits | Only 1-base substitutions offered. | extended proposal schema |
| 10 | Auth/roles | Not present; no auth UI. | - |
| 11 | Body asset | Procedural neutral silhouette (illustrative). | - |
