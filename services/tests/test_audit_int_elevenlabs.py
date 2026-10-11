from __future__ import annotations

import json

import httpx
import pytest

from services.integrations.elevenlabs import BriefingRequest, ElevenLabsAdapter
from services.integrations.elevenlabs import adapter as adapter_module

DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"
DEFAULT_MODEL = "eleven_multilingual_v2"


def _clear_env(monkeypatch) -> None:
    for name in (
        "ELEVENLABS_API_KEY",
        "ELEVENLABS_VOICE_ID",
        "ELEVENLABS_MODEL_ID",
        "ELEVENLABS_ENABLED",
    ):
        monkeypatch.delenv(name, raising=False)


def _install_transport(monkeypatch, handler) -> None:
    real_client = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(adapter_module.httpx, "AsyncClient", factory)


def _request(**overrides) -> BriefingRequest:
    data = {
        "receipt_id": "rcpt-1",
        "run_id": "run-1",
        "candidate_version_id": "cand-v2",
        "score": "6/6",
        "promoted": True,
        "decision_reason": "ok",
    }
    data.update(overrides)
    return BriefingRequest(**data)


def test_defaults_when_env_unset(monkeypatch):
    _clear_env(monkeypatch)
    adapter = ElevenLabsAdapter()
    assert adapter.voice_id == DEFAULT_VOICE
    assert adapter.model_id == DEFAULT_MODEL
    assert adapter.api_key == ""
    assert adapter.enabled is False
    assert adapter.status == "NOT_CONFIGURED"


def test_empty_env_values_from_env_example_fall_back_to_defaults(monkeypatch):
    # .env.example ships `ELEVENLABS_VOICE_ID=` (empty); an empty value must not
    # produce a blank voice id / model id.
    _clear_env(monkeypatch)
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "")
    monkeypatch.setenv("ELEVENLABS_MODEL_ID", "")
    adapter = ElevenLabsAdapter()
    assert adapter.voice_id == DEFAULT_VOICE
    assert adapter.model_id == DEFAULT_MODEL


def test_explicit_args_and_env_values_are_used(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "env-voice")
    monkeypatch.setenv("ELEVENLABS_MODEL_ID", "env-model")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "env-key")
    monkeypatch.setenv("ELEVENLABS_ENABLED", "TRUE")
    env_adapter = ElevenLabsAdapter()
    assert (env_adapter.voice_id, env_adapter.model_id, env_adapter.api_key) == (
        "env-voice",
        "env-model",
        "env-key",
    )
    assert env_adapter.status == "CONFIGURED"
    arg_adapter = ElevenLabsAdapter(api_key="k", voice_id="v", model_id="m", enabled=False)
    assert (arg_adapter.voice_id, arg_adapter.model_id, arg_adapter.api_key) == ("v", "m", "k")
    assert arg_adapter.status == "NOT_CONFIGURED"


def test_status_requires_enabled_and_key():
    assert ElevenLabsAdapter(enabled=True, api_key="").status == "NOT_CONFIGURED"
    assert ElevenLabsAdapter(enabled=False, api_key="k").status == "NOT_CONFIGURED"
    assert ElevenLabsAdapter(enabled=True, api_key="k").status == "CONFIGURED"


def test_script_is_deterministic_and_contains_no_nucleotide_payload():
    adapter = ElevenLabsAdapter(enabled=False, api_key="")
    for promoted in (True, False):
        req = _request(promoted=promoted)
        first = adapter.compose_briefing_script(req)
        assert first == adapter.compose_briefing_script(req)
        assert "cand-v2" in first
        assert "6/6" in first
    assert "rcpt-1" in adapter.compose_briefing_script(_request(promoted=True))


@pytest.mark.asyncio
async def test_stream_not_configured_raises_without_network(monkeypatch):
    def handler(request):  # pragma: no cover - must never be reached
        raise AssertionError("network used while NOT_CONFIGURED")

    _install_transport(monkeypatch, handler)
    adapter = ElevenLabsAdapter(enabled=True, api_key="")
    with pytest.raises(RuntimeError, match="NOT_CONFIGURED"):
        async for _ in adapter.stream_speech("hello"):
            pass


@pytest.mark.asyncio
async def test_stream_posts_expected_request_and_yields_chunks(monkeypatch):
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["key"] = request.headers.get("xi-api-key")
        seen["body"] = request.content
        return httpx.Response(200, content=b"\xff\xfb\x90\x44audio")

    _install_transport(monkeypatch, handler)
    adapter = ElevenLabsAdapter(enabled=True, api_key="secret-key", voice_id="voice-x", model_id="model-y")
    chunks = [c async for c in adapter.stream_speech("hello world")]
    assert b"".join(chunks) == b"\xff\xfb\x90\x44audio"
    assert seen["url"] == "https://api.elevenlabs.io/v1/text-to-speech/voice-x/stream"
    assert seen["key"] == "secret-key"
    body = json.loads(seen["body"])
    assert body["text"] == "hello world"
    assert body["model_id"] == "model-y"


@pytest.mark.asyncio
async def test_stream_with_default_config_never_hits_blank_voice_path(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "")
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(200, content=b"x")

    _install_transport(monkeypatch, handler)
    adapter = ElevenLabsAdapter(enabled=True, api_key="k")
    assert [c async for c in adapter.stream_speech("t")] == [b"x"]
    assert "text-to-speech//stream" not in seen["url"]
    assert f"/text-to-speech/{DEFAULT_VOICE}/stream" in seen["url"]


@pytest.mark.asyncio
async def test_stream_non_200_raises_without_leaking_api_key(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, content=b'{"detail":"invalid_api_key"}')

    _install_transport(monkeypatch, handler)
    adapter = ElevenLabsAdapter(enabled=True, api_key="secret-key")
    with pytest.raises(RuntimeError) as excinfo:
        async for _ in adapter.stream_speech("hello"):
            pass
    assert "401" in str(excinfo.value)
    assert "invalid_api_key" in str(excinfo.value)
    assert "secret-key" not in str(excinfo.value)


@pytest.mark.asyncio
async def test_mock_chunks_bypass_network_even_when_unconfigured():
    adapter = ElevenLabsAdapter(enabled=False, api_key="")
    assert [c async for c in adapter.stream_speech("t", mock_chunks=[b"a", b"b"])] == [b"a", b"b"]
