from __future__ import annotations

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from services.api.app.dependencies import get_evidence_repo
from services.api.app.routes import voice
from services.integrations.elevenlabs import ElevenLabsAdapter
from services.integrations.mongodb.models import EvidenceReceiptModel


def _receipt(**overrides) -> EvidenceReceiptModel:
    data = {
        "receipt_id": "rcpt_audit_voice",
        "receipt_digest": "d" * 64,
        "run_id": "run_audit_voice",
        "candidate_version_id": "cand_v1",
        "score": "1.0",
        "promoted": True,
        "decision_reason": "audit",
    }
    data.update(overrides)
    return EvidenceReceiptModel(**data)


class FakeEvidenceRepo:
    def __init__(self, receipt: EvidenceReceiptModel | None) -> None:
        self.receipt = receipt

    async def get_receipt(self, receipt_id: str):
        if self.receipt and self.receipt.receipt_id == receipt_id:
            return self.receipt
        return None

    async def get_receipt_by_run(self, run_id: str):
        if self.receipt and self.receipt.run_id == run_id:
            return self.receipt
        return None


def _client(receipt: EvidenceReceiptModel | None) -> AsyncClient:
    app = FastAPI()
    app.include_router(voice.router)
    app.dependency_overrides[get_evidence_repo] = lambda: FakeEvidenceRepo(receipt)
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _configured(monkeypatch, stream_impl) -> None:
    class ConfiguredAdapter(ElevenLabsAdapter):
        def __init__(self) -> None:
            super().__init__(api_key="test-key", enabled=True)

        async def stream_speech(self, text, mock_chunks=None):
            async for chunk in stream_impl(text):
                yield chunk

    monkeypatch.setattr(voice, "ElevenLabsAdapter", ConfiguredAdapter)


@pytest.mark.asyncio
async def test_briefing_unknown_receipt_is_404():
    async with _client(None) as client:
        resp = await client.post("/api/voice/briefing", json={"receipt_id": "nope"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_briefing_resolves_by_run_id_and_falls_back_to_captions(monkeypatch):
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    monkeypatch.delenv("ELEVENLABS_ENABLED", raising=False)
    async with _client(_receipt()) as client:
        resp = await client.post("/api/voice/briefing", json={"receipt_id": "run_audit_voice"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "NOT_CONFIGURED"
    assert body["voice_enabled"] is False
    assert body["receipt_id"] == "rcpt_audit_voice"
    assert "rcpt_audit_voice" in body["script"]


@pytest.mark.asyncio
async def test_briefing_streams_audio_when_configured(monkeypatch):
    async def ok_stream(text):
        yield b"abc"
        yield b"def"

    _configured(monkeypatch, ok_stream)
    async with _client(_receipt()) as client:
        resp = await client.post("/api/voice/briefing", json={"receipt_id": "rcpt_audit_voice"})
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "audio/mpeg"
    assert resp.headers["x-receipt-id"] == "rcpt_audit_voice"
    assert resp.content == b"abcdef"


@pytest.mark.asyncio
async def test_briefing_empty_stream_does_not_error(monkeypatch):
    async def empty_stream(text):
        return
        yield b""

    _configured(monkeypatch, empty_stream)
    async with _client(_receipt()) as client:
        resp = await client.post("/api/voice/briefing", json={"receipt_id": "rcpt_audit_voice"})
    assert resp.status_code == 200
    assert resp.content == b""


@pytest.mark.asyncio
async def test_briefing_upstream_failure_returns_caption_error_payload(monkeypatch):
    async def failing_stream(text):
        raise RuntimeError("ElevenLabs API error 401")
        yield b""

    _configured(monkeypatch, failing_stream)
    async with _client(_receipt()) as client:
        resp = await client.post("/api/voice/briefing", json={"receipt_id": "rcpt_audit_voice"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ERROR"
    assert body["voice_enabled"] is False
    assert "rcpt_audit_voice" in body["script"]
