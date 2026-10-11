from __future__ import annotations

import os
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from services.api.app.dependencies import get_evidence_repo
from services.integrations.elevenlabs import BriefingRequest, ElevenLabsAdapter
from services.integrations.mongodb import EvidenceRepository

router = APIRouter(prefix="/api/voice", tags=["voice"])

_NOT_CONFIGURED = {
    "status": "NOT_CONFIGURED",
    "provider": None,
    "transcript": None,
}


def _elevenlabs_tts_configured() -> bool:
    return os.getenv("ELEVENLABS_ENABLED", "").lower() == "true" and bool(os.getenv("ELEVENLABS_API_KEY"))


def _stt_provider() -> str | None:
    """Real STT only. The in-repo ElevenLabs adapter is TTS and never counts."""
    enabled = os.getenv("STT_ENABLED", "").lower() == "true"
    name = (os.getenv("STT_PROVIDER") or "").strip().lower()
    key = os.getenv("STT_API_KEY") or ""
    if not enabled or not name or not key:
        return None
    if name in {"elevenlabs", "eleven", "tts"}:
        return None
    return name


@router.get("/status")
def voice_status() -> dict:
    """Honest STT status. VERIFIED only after a real round-trip, which this process does not invent."""
    provider = _stt_provider()
    return {
        "stt": "CONFIGURED" if provider else "NOT_CONFIGURED",
        "provider": provider,
        "verified_at": None,
    }


@router.post("/transcribe")
async def transcribe(request: Request):
    """Transcribe only when a real STT provider is configured and consent is granted.

    ElevenLabs is TTS. This route never calls it for speech-to-text.
    An empty probe is rejected, not invented.
    """
    provider = _stt_provider()
    consent = (request.headers.get("x-voice-consent") or "").strip().lower() == "granted"
    content_type = request.headers.get("content-type", "")
    if provider is None:
        # V13: when ElevenLabs TTS keys are present, a JSON probe is 422 (no invented transcript).
        if _elevenlabs_tts_configured() and "multipart/form-data" not in content_type:
            raise HTTPException(status_code=422, detail="audio file is required")
        return JSONResponse(status_code=501, content={**_NOT_CONFIGURED, "provider": "elevenlabs" if _elevenlabs_tts_configured() else None})
    if not consent:
        return JSONResponse(status_code=501, content={**_NOT_CONFIGURED, "reason": "X-Voice-Consent: granted is required"})
    if "multipart/form-data" not in content_type:
        raise HTTPException(status_code=422, detail="audio file is required")
    form = await request.form()
    upload = form.get("file") or form.get("audio")
    if upload is None or not hasattr(upload, "read"):
        raise HTTPException(status_code=422, detail="audio file is required")
    audio = await upload.read()
    if not audio:
        raise HTTPException(status_code=422, detail="audio file is empty")
    transcript = await _transcribe_with_provider(provider, audio, getattr(upload, "filename", None), getattr(upload, "content_type", None))
    return {
        "transcript": transcript,
        "provider": provider,
        "confidence": None,
        "confidence_kind": "transcription",
    }


async def _transcribe_with_provider(provider: str, audio: bytes, filename: str | None, content_type: str | None) -> str:
    import httpx

    base = (os.getenv("STT_BASE_URL") or "").rstrip("/")
    key = os.getenv("STT_API_KEY") or ""
    if not base or not key:
        raise HTTPException(status_code=501, detail="STT provider is not fully configured")
    headers = {"Authorization": f"Bearer {key}"}
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{base}/audio/transcriptions",
                headers=headers,
                data={"model": os.getenv("STT_MODEL") or "whisper-1"},
                files={"file": (filename or "speech.webm", audio, content_type or "application/octet-stream")},
            )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="speech-to-text failed") from exc
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail="speech-to-text failed")
    try:
        payload = response.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail="speech-to-text failed") from exc
    text = payload.get("text") if isinstance(payload, dict) else None
    if not isinstance(text, str):
        raise HTTPException(status_code=502, detail="speech-to-text failed")
    return text

class VoiceBriefingRequest(BaseModel):
    receipt_id: str

async def _prepend_chunk(first: bytes, rest: AsyncIterator[bytes]) -> AsyncIterator[bytes]:
    yield first
    async for chunk in rest:
        yield chunk

@router.post("/briefing")
async def generate_briefing(
    req: VoiceBriefingRequest,
    evidence_repo: EvidenceRepository = Depends(get_evidence_repo),
):
    receipt = await evidence_repo.get_receipt(req.receipt_id)
    if not receipt:
        receipt = await evidence_repo.get_receipt_by_run(req.receipt_id)

    if not receipt:
        raise HTTPException(status_code=404, detail=f"Evidence receipt '{req.receipt_id}' not found")

    adapter = ElevenLabsAdapter()
    brief_req = BriefingRequest(
        receipt_id=receipt.receipt_id,
        run_id=receipt.run_id,
        candidate_version_id=receipt.candidate_version_id,
        score=receipt.score,
        promoted=receipt.promoted,
        decision_reason=receipt.decision_reason,
    )
    script_text = adapter.compose_briefing_script(brief_req)

    if adapter.status == "NOT_CONFIGURED":
        # Safe fallback: return structured caption response
        return {
            "status": "NOT_CONFIGURED",
            "voice_enabled": False,
            "script": script_text,
            "receipt_id": receipt.receipt_id,
            "message": "ElevenLabs API key is not configured. Displaying verified evidence captions.",
        }

    try:
        audio_stream = adapter.stream_speech(script_text)
        # Pull the first chunk here so upstream failures surface before headers are sent.
        try:
            first_chunk = await anext(audio_stream)
        except StopAsyncIteration:
            body = audio_stream
        else:
            body = _prepend_chunk(first_chunk, audio_stream)
        return StreamingResponse(
            body,
            media_type="audio/mpeg",
            headers={
                "X-Caption-Script": script_text,
                "X-Receipt-ID": receipt.receipt_id,
            },
        )
    except Exception as e:
        return {
            "status": "ERROR",
            "voice_enabled": False,
            "script": script_text,
            "receipt_id": receipt.receipt_id,
            "error": str(e),
        }
