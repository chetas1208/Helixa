from __future__ import annotations

import json

import httpx
import pytest

from services.runtime.providers import (
    DeterministicProposer,
    Message,
    OpenAICompatibleProvider,
)
from services.runtime.providers import adapter as adapter_module


def _install_transport(monkeypatch, handler):
    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        adapter_module.httpx,
        "AsyncClient",
        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw),
    )


def _clear_model_env(monkeypatch):
    for name in ("MODEL_BASE_URL", "MODEL_API_KEY", "MODEL_NAME"):
        monkeypatch.delenv(name, raising=False)


async def test_deterministic_ref_mismatch_proposal_is_stable():
    msgs = [Message(role="user", content="Validation failed on reference_ref_allele_match.")]
    first = await DeterministicProposer().generate(msgs)
    second = await DeterministicProposer().generate(msgs)
    assert first == second
    assert first.is_fallback is True
    assert first.provider_name == "deterministic-research-proposer"
    assert first.tool_calls[0]["arguments"]["require_reference_allele_check"] is True


async def test_deterministic_unknown_trace_proposes_nothing():
    resp = await DeterministicProposer().generate([Message(role="user", content="all clear")])
    assert resp.tool_calls == []
    assert resp.is_fallback is True


async def test_unconfigured_provider_falls_back_and_makes_no_http_call(monkeypatch):
    _clear_model_env(monkeypatch)

    def handler(request):
        raise AssertionError("network must not be used when unconfigured")

    _install_transport(monkeypatch, handler)
    resp = await OpenAICompatibleProvider().generate([Message(role="user", content="REF allele")])
    assert resp.is_fallback is True
    assert resp.provider_name == "deterministic-research-proposer"


async def test_empty_env_values_from_env_example_use_defaults(monkeypatch):
    # .env.example ships MODEL_BASE_URL= and MODEL_NAME= empty; load_dotenv exports them as "".
    monkeypatch.setenv("MODEL_BASE_URL", "")
    monkeypatch.setenv("MODEL_API_KEY", "sk-test")
    monkeypatch.setenv("MODEL_NAME", "")
    provider = OpenAICompatibleProvider()
    assert provider.is_configured is True
    assert provider.base_url == "https://api.openai.com/v1"
    assert provider.model_name == "gpt-4o-mini"


async def test_trailing_slash_base_url_does_not_double_slash(monkeypatch):
    _clear_model_env(monkeypatch)
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

    _install_transport(monkeypatch, handler)
    provider = OpenAICompatibleProvider(base_url="https://llm.example/v1/", api_key="k")
    await provider.generate([Message(role="user", content="hi")])
    assert seen["url"] == "https://llm.example/v1/chat/completions"


async def test_null_content_response_is_accepted(monkeypatch):
    _clear_model_env(monkeypatch)

    def handler(request):
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": None, "tool_calls": [{"id": "c1"}]}}]},
        )

    _install_transport(monkeypatch, handler)
    provider = OpenAICompatibleProvider(base_url="https://llm.example/v1", api_key="k")
    resp = await provider.generate([Message(role="user", content="hi")])
    assert resp.content == ""
    assert resp.is_fallback is False
    assert resp.provider_name == "openai-compatible"


async def test_configured_request_shape_and_response(monkeypatch):
    _clear_model_env(monkeypatch)
    seen = {}

    def handler(request):
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": "hello"}}]})

    _install_transport(monkeypatch, handler)
    provider = OpenAICompatibleProvider(
        base_url="https://llm.example/v1", api_key="k", model_name="m1"
    )
    resp = await provider.generate([Message(role="user", content="hi")])
    assert seen["auth"] == "Bearer k"
    assert seen["body"] == {"model": "m1", "messages": [{"role": "user", "content": "hi"}]}
    assert resp.content == "hello"
    assert resp.is_fallback is False


async def test_http_error_propagates_without_leaking_api_key(monkeypatch):
    _clear_model_env(monkeypatch)

    def handler(request):
        return httpx.Response(401, json={"error": "bad key"})

    _install_transport(monkeypatch, handler)
    provider = OpenAICompatibleProvider(base_url="https://llm.example/v1", api_key="sk-secret")
    with pytest.raises(httpx.HTTPStatusError) as exc:
        await provider.generate([Message(role="user", content="hi")])
    assert "sk-secret" not in str(exc.value)
