# Audit: route_voice (services/api/app/routes/voice.py)

## FIXED
1. services/api/app/routes/voice.py (generate_briefing, former lines 49-66): the `try/except` around `StreamingResponse(adapter.stream_speech(...))` could never fire, because `stream_speech` is an async generator and nothing runs until Starlette iterates it after the 200 headers are sent. A configured adapter whose upstream failed (for example a non-200 from ElevenLabs) therefore escaped as an unhandled exception and an aborted stream, and the documented `{"status":"ERROR", "script": ...}` caption fallback was dead code.
   - Failing test: `test_briefing_upstream_failure_returns_caption_error_payload` (services/tests/test_audit_route_voice.py). It failed with RuntimeError raised from inside the response body iterator.
   - Fix: pull the first chunk with `anext()` inside the `try`, then stream via a small `_prepend_chunk` wrapper. An empty stream is still returned as an empty 200. Response shape, headers and the NOT_CONFIGURED path are unchanged.

## UNVERIFIED/NEEDS OTHER OWNER
- voice.py:56 `X-Caption-Script` header carries the script text, which embeds `candidate_version_id` from the stored receipt. A non-latin-1 character or a newline in that id would make Starlette fail to encode the header (500). Receipt ids are system-generated, so I could not show a realistic trigger and left it unchanged. Changing the header encoding would also alter the public contract.
- voice.py ERROR branch `"error": str(e)` echoes the upstream ElevenLabs error body (see services/integrations/elevenlabs/adapter.py `stream_speech`, `int_elevenlabs` owner). It does not contain the API key (sent only in the request header), but it forwards vendor detail to the client. Left as is because the client-visible `error` field is existing behavior.
- voice.py `VoiceBriefingRequest.receipt_id` has no length bound. This is low risk because it is only used as an equality key in Mongo queries.
- adapter.py:`compose_briefing_script` (owner `int_elevenlabs`): the promoted-branch text hard-codes "reference allele integrity incident" and "held-out dataset" regardless of receipt content. This is existing behavior asserted by test_api_routes.py, so I did not change it.

## VERIFIED OK
- Receipt lookup order (receipt_id, then run_id) and the 404 on an unknown id.
- NOT_CONFIGURED fallback: the script is evidence-derived, contains no sequence data, and the response carries `voice_enabled: false`.
- The streaming success path: audio/mpeg media type, X-Receipt-ID and caption headers, and byte-exact concatenated body.
- No Mongo `_id` leakage: the repo projects `_id: 0` and the route returns only selected fields.
- No clinical claims in the route text; the stance is unchanged.
