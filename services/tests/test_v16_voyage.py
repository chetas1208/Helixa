"""Mocked Atlas embedding and reranking client."""

import json

import httpx
import pytest

from services.integrations.voyage import VoyageAdapter, VoyageConfig, VoyageError
from services.integrations.voyage.sanitize import redact_secret
from services.integrations.voyage.types import versions_compatible

KEY = "unit-test-key-not-real"


def config(**overrides) -> VoyageConfig:
    values = dict(
        enabled=True,
        api_key=KEY,
        base_url="https://ai.mongodb.com/v1",
        geography="unscoped",
        key_scope="unscoped",
        embedding_model="voyage-4-large",
        fast_model="voyage-4-lite",
        rerank_model="rerank-3",
        timeout_seconds=2,
        max_retries=2,
        batch_size=2,
        max_input_chars=8000,
        allow_external_research_text=False,
        output_dimension=None,
    )
    values.update(overrides)
    return VoyageConfig(**values)


def _embed_body(count: int, dimension: int = 1024, value: float = 0.01) -> dict:
    return {
        "data": [{"index": index, "embedding": [value] * dimension} for index in range(count)],
        "model": "voyage-4-large",
        "usage": {"total_tokens": count},
    }


def test_disabled_and_missing_key_make_no_request():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(500)

    disabled = VoyageAdapter(config(enabled=False, api_key=KEY), transport=httpx.MockTransport(handler))
    assert disabled.health_state() == "disabled"
    assert disabled.status == "NOT_CONFIGURED"
    assert disabled.embed("BRCA1 association") is None
    missing = VoyageAdapter(config(enabled=True, api_key=""), transport=httpx.MockTransport(handler))
    assert missing.health_state() == "not_configured"
    assert missing.embed("BRCA1 association") is None
    assert calls["n"] == 0


def test_scope_mismatch_is_rejected_before_request(monkeypatch):
    monkeypatch.setenv("VOYAGE_ENABLED", "true")
    monkeypatch.setenv("VOYAGE_API_KEY", KEY)
    monkeypatch.setenv("VOYAGE_BASE_URL", "https://us.ai.mongodb.com/v1")
    monkeypatch.setenv("VOYAGE_KEY_SCOPE", "eu")
    with pytest.raises(VoyageError) as caught:
        VoyageConfig.from_env()
    assert caught.value.health == "wrong_scope"
    assert KEY not in str(caught.value)


def test_non_atlas_host_is_rejected(monkeypatch):
    monkeypatch.setenv("VOYAGE_BASE_URL", "https://api.openai.com/v1")
    with pytest.raises(VoyageError) as caught:
        VoyageConfig.from_env()
    assert caught.value.health == "wrong_scope"


def test_embedding_versions_do_not_mix_across_families():
    assert versions_compatible("voyage-4-large:float:1024", "voyage-4-lite:float:1024")
    assert not versions_compatible("voyage-4-large:float:1024", "voyage-3.5:float:1024")
    assert not versions_compatible("voyage-4-large:float:1024", "voyage-4-large:float:512")


@pytest.mark.asyncio
async def test_embed_uses_document_and_query_input_types():
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append(body)
        assert request.url.host == "ai.mongodb.com"
        assert request.url.path.endswith("/embeddings")
        assert KEY not in request.url.path
        return httpx.Response(200, json=_embed_body(len(body["input"])))

    adapter = VoyageAdapter(config(), transport=httpx.MockTransport(handler))
    documents = await adapter.embed_documents(["BRCA1 public association summary", "TP53 public summary"])
    query = await adapter.embed_query("BRCA1 association")
    assert seen[0]["input_type"] == "document"
    assert seen[1]["input_type"] == "query"
    assert seen[0]["model"] == "voyage-4-large"
    assert len(documents) == 2
    assert len(documents[0]) == 1024
    assert len(query) == 1024
    assert adapter.health_state() == "connected"
    assert adapter.usage.embedding_tokens == 3


@pytest.mark.asyncio
async def test_rerank_and_auth_rate_limit_and_partial_batch():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if request.url.path.endswith("/rerank"):
            return httpx.Response(
                200,
                json={
                    "data": [
                        {"index": 1, "relevance_score": 0.9},
                        {"index": 0, "relevance_score": 0.1},
                    ],
                    "model": "rerank-3",
                    "usage": {"total_tokens": 4},
                },
            )
        return httpx.Response(200, json=_embed_body(1))

    adapter = VoyageAdapter(config(), transport=httpx.MockTransport(handler))
    ranked = await adapter.rerank("BRCA1", ["unrelated note", "BRCA1 association"], 1)
    assert ranked[0].index == 1
    assert ranked[0].relevance_score == 0.9
    assert adapter.usage.rerank_tokens == 4

    def deny(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(401, text=f"nope {KEY}")

    denied = VoyageAdapter(config(max_retries=3), transport=httpx.MockTransport(deny))
    before = calls["n"]
    with pytest.raises(VoyageError) as caught:
        await denied.embed_query("BRCA1 association")
    assert caught.value.health == "permission_denied"
    assert calls["n"] == before + 1
    assert KEY not in str(caught.value)

    state = {"n": 0}

    def limit(request: httpx.Request) -> httpx.Response:
        state["n"] += 1
        if state["n"] == 1:
            return httpx.Response(429, json={"detail": "slow down"})
        return httpx.Response(200, json=_embed_body(1))

    limited = VoyageAdapter(config(max_retries=2), transport=httpx.MockTransport(limit))
    vector = await limited.embed_query("TP53 summary")
    assert len(vector) == 1024
    assert state["n"] == 2

    def short(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_embed_body(1))

    partial = VoyageAdapter(config(), transport=httpx.MockTransport(short))
    with pytest.raises(VoyageError):
        await partial.embed_documents(["one summary", "two summary"])


@pytest.mark.asyncio
async def test_timeout_retries_then_unavailable_and_chat_is_refused():
    calls = {"n": 0}

    def boom(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        raise httpx.TimeoutException("timed out")

    adapter = VoyageAdapter(config(max_retries=1), transport=httpx.MockTransport(boom))
    with pytest.raises(VoyageError) as caught:
        await adapter.embed_query("BRCA1 association")
    assert caught.value.health == "unavailable"
    assert calls["n"] == 2

    def forbidden(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json={})

    guarded = VoyageAdapter(config(), transport=httpx.MockTransport(forbidden))
    with pytest.raises(VoyageError) as chat:
        await guarded._request("/chat/completions", {"model": "gpt"})
    assert chat.value.health == "unavailable"
    assert calls["n"] == 2


@pytest.mark.asyncio
async def test_malformed_vectors_and_secret_redaction():
    def nan_handler(request: httpx.Request) -> httpx.Response:
        body = _embed_body(1)
        body["data"][0]["embedding"][0] = "NaN"
        return httpx.Response(200, json=body)

    adapter = VoyageAdapter(config(), transport=httpx.MockTransport(nan_handler))
    with pytest.raises(VoyageError) as caught:
        await adapter.embed_query("BRCA1 association")
    assert caught.value.health == "unavailable"

    def wrong_dim(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_embed_body(1, dimension=3))

    short = VoyageAdapter(config(), transport=httpx.MockTransport(wrong_dim))
    with pytest.raises(VoyageError):
        await short.embed_query("BRCA1 association")
    assert redact_secret(f"token {KEY}", KEY) == "token [redacted]"


@pytest.mark.asyncio
async def test_scope_error_body_is_classified_without_retry():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(403, text="geography scope mismatch for endpoint")

    adapter = VoyageAdapter(config(max_retries=3), transport=httpx.MockTransport(handler))
    with pytest.raises(VoyageError) as caught:
        await adapter.embed_query("BRCA1 association")
    assert caught.value.health == "wrong_scope"
    assert calls["n"] == 1
