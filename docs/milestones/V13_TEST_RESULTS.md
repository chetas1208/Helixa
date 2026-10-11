# V13 test results

`make verify-v13` on 2026-10-11:

- Ruff: passed
- pytest `test_v13_contract.py`, `test_v11_science.py`, `test_v10_workspace.py`: 23 passed, 1 Starlette deprecation warning, 0 failed

Covered: snapshot switches between two workspaces, body stays illustrative, genome and harness ids do not overlap, wrong reference text is rejected, vague text asks for clarification, a repeated commit key does not double-apply, playback duration 60 and 120 share one result hash, archived workspaces cannot be selected, `POST /api/voice/transcribe` is HTTP 501 `NOT_CONFIGURED`.

Not run: full older suite, Atlas, Raindrop ingestion, real ElevenLabs audio, worker kill/resume.
