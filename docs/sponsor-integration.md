# Sponsor Integrations: MongoDB, Raindrop & ElevenLabs

## 1. MongoDB Native Integration
- **Local vs Atlas**: DIAMOND natively supports both local MongoDB (`mongodb://127.0.0.1:27017`) and MongoDB Atlas via the official `pymongo` Async API.
- **Contract Parity**: Both local and Atlas profiles use identical document schemas, collection indexes, and lease semantics.
- **Verification**: `scripts/check_integrations.py` tests the connection and reports `CONNECTED` or `NOT_CONFIGURED`.

## 2. Raindrop Observability
- **Adapter**: `services.integrations.raindrop.adapter.RaindropAdapter`.
- **Capability**: Records structured execution spans, tool invocations, validation anomalies, mutation events, and worker recoveries.
- **Status Reporting**: In the absence of credentials, gracefully reports `NOT_CONFIGURED` without impacting core workflows. Tested with full mock transport.
- **Privacy Controls**: Nucleotide sequences and file bodies are stripped. Only pseudonymous identifiers and error classifications are sent.

## 3. ElevenLabs Research Narration
- **Adapter**: `services.integrations.elevenlabs.adapter.ElevenLabsAdapter`.
- **Capability**: Server-side streaming audio generation via `POST /v1/text-to-speech/{voice_id}/stream`.
- **Trigger**: Strictly user-initiated through the **Explain Evidence** button. Never auto-plays.
- **Fallback**: Generates deterministic text captions when credentials are unconfigured or when streaming fails.
