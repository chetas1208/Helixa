from __future__ import annotations

import logging
import os
from collections.abc import AsyncGenerator

import httpx
from pydantic import BaseModel

logger = logging.getLogger("diamond.elevenlabs")

class BriefingRequest(BaseModel):
    receipt_id: str
    run_id: str
    candidate_version_id: str
    score: str
    promoted: bool
    decision_reason: str

class ElevenLabsAdapter:
    """
    Server-side streaming TTS adapter for verified research evidence briefings.
    Strictly opt-in and evidence-derived. Never transmits raw genetic sequence data.
    """

    def __init__(
        self,
        api_key: str | None = None,
        voice_id: str | None = None,
        model_id: str | None = None,
        enabled: bool | None = None,
    ):
        self.api_key = os.getenv("ELEVENLABS_API_KEY", "") if api_key is None else api_key
        self.voice_id = (os.getenv("ELEVENLABS_VOICE_ID") or "21m00Tcm4TlvDq8ikWAM") if voice_id is None else voice_id
        self.model_id = (os.getenv("ELEVENLABS_MODEL_ID") or "eleven_multilingual_v2") if model_id is None else model_id
        self.enabled = enabled if enabled is not None else (os.getenv("ELEVENLABS_ENABLED", "false").lower() == "true")

    @property
    def status(self) -> str:
        if not self.enabled or not self.api_key:
            return "NOT_CONFIGURED"
        return "CONFIGURED"

    @property
    def stt_status(self) -> str:
        """This adapter is TTS. It is never a verified speech-to-text provider."""
        return "NOT_CONFIGURED"

    def compose_briefing_script(self, req: BriefingRequest) -> str:
        """
        Synthesizes a concise, deterministic 2-3 sentence evidence briefing
        without raw nucleotides.
        """
        if req.promoted:
            return (
                f"Computational verification identified a reference allele integrity incident in the baseline harness. "
                f"Candidate harness {req.candidate_version_id} verified the mismatch on the held-out dataset "
                f"with a score of {req.score} while preserving valid controls without false positives. "
                f"Evidence receipt {req.receipt_id} is permanently recorded."
            )
        else:
            return (
                f"Computational verification evaluated candidate harness {req.candidate_version_id}. "
                f"The candidate achieved a score of {req.score} and was not promoted due to insufficient evidence. "
                f"The baseline harness has been retained."
            )

    async def stream_speech(
        self,
        text: str,
        mock_chunks: list[bytes] | None = None,
    ) -> AsyncGenerator[bytes, None]:
        """
        Streams MP3 audio chunks from ElevenLabs or provides mock stream for local verification.
        """
        if mock_chunks is not None:
            for chunk in mock_chunks:
                yield chunk
            return

        if not self.enabled or not self.api_key:
            # Yield empty / raise to trigger text caption fallback
            raise RuntimeError("ElevenLabs is NOT_CONFIGURED. Fallback to text captions.")

        url = f"https://api.elevenlabs.io/v1/text-to-speech/{self.voice_id}/stream"
        headers = {
            "xi-api-key": self.api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        }
        payload = {
            "text": text,
            "model_id": self.model_id,
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.8,
            },
        }

        async with httpx.AsyncClient(timeout=20.0) as client:
            async with client.stream("POST", url, json=payload, headers=headers) as response:
                if response.status_code != 200:
                    err_body = await response.aread()
                    raise RuntimeError(f"ElevenLabs API error {response.status_code}: {err_body.decode('utf-8', errors='replace')}")
                async for chunk in response.aiter_bytes():
                    yield chunk
