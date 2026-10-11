"""HTTP client for MongoDB Atlas Voyage embeddings and reranking.

The model API key authenticates POST /embeddings and POST /rerank only.
It is not a database URI, an Atlas Admin key, or a chat-completion key.
"""

from __future__ import annotations

import asyncio
import math
import random
from typing import Any

import httpx

from services.integrations.voyage.config import VoyageConfig
from services.integrations.voyage.errors import InputTooLong, VoyageError
from services.integrations.voyage.sanitize import assert_safe_for_remote, redact_secret
from services.integrations.voyage.types import (
    MODEL_DIMENSIONS,
    EmbeddingBatch,
    HealthState,
    RankedDocument,
    UsageRecord,
    embedding_version,
)

_RETRYABLE = {429, 500, 502, 503, 504}


def _finite_vector(vector: list[Any], dimension: int) -> list[float]:
    if len(vector) != dimension:
        raise VoyageError("unavailable", "Embedding length is inconsistent.")
    out: list[float] = []
    for value in vector:
        try:
            number = float(value)
        except (TypeError, ValueError) as exc:
            raise VoyageError("unavailable", "Embedding value is not numeric.") from exc
        if not math.isfinite(number):
            raise VoyageError("unavailable", "Embedding value is not finite.")
        out.append(number)
    return out


class VoyageAdapter:
    """Sync `embed` stays for existing callers. New work uses the async protocol methods."""

    def __init__(
        self,
        config: VoyageConfig | None = None,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.config = config or VoyageConfig.from_env()
        self._transport = transport
        self._verified = False
        self._health: HealthState = self._initial_health()
        self.usage = UsageRecord(embedding_model=self.config.embedding_model, rerank_model=self.config.rerank_model)
        self._sem = asyncio.Semaphore(2)

    def _initial_health(self) -> HealthState:
        if not self.config.enabled:
            return "disabled"
        if not self.config.api_key:
            return "not_configured"
        return "configured_unverified"

    @property
    def status(self) -> str:
        """Legacy sponsor flag. CONFIGURED means a key is enabled, not that a call succeeded."""
        if self._health in {"disabled", "not_configured"}:
            return "NOT_CONFIGURED"
        return "CONFIGURED"

    def health_state(self) -> HealthState:
        return self._health

    def _ready(self) -> None:
        if not self.config.allow_external_research_text and self._health == "disabled":
            raise VoyageError("disabled", "Voyage is disabled (VOYAGE_ENABLED=false).")
        if self._health == "disabled":
            raise VoyageError("disabled", "Voyage is disabled (VOYAGE_ENABLED=false).")
        if self._health == "not_configured":
            raise VoyageError("not_configured", "VOYAGE_API_KEY is empty.")
        if not self.config.allow_external_research_text:
            # Remote calls of approved research text are still gated by the caller.
            # The flag blocks treating user content as eligible; the adapter itself
            # only sends text that passed assert_safe_for_remote.
            pass

    def _guard_text(self, text: str) -> str:
        if len(text) > self.config.max_input_chars:
            raise InputTooLong(self.config.max_input_chars)
        assert_safe_for_remote(text)
        return text

    def _expected_dimension(self, model: str) -> int | None:
        if self.config.output_dimension:
            return self.config.output_dimension
        return MODEL_DIMENSIONS.get(model)

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
        }

    def _classify(self, status_code: int, body: str) -> HealthState:
        lowered = body.lower()
        if status_code in {401, 403} and any(
            token in lowered for token in ("geography", "scope", "endpoint", "region")
        ):
            return "wrong_scope"
        if status_code in {401, 403}:
            return "permission_denied"
        if status_code == 429:
            return "rate_limited"
        return "unavailable"

    async def _request(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        self._ready()
        if path not in {"/embeddings", "/rerank"}:
            raise VoyageError("unavailable", "Only embeddings and rerank are permitted.")
        delay = 0.05
        last_health: HealthState = "unavailable"
        attempts = self.config.max_retries + 1
        async with self._sem:
            for attempt in range(attempts):
                try:
                    async with httpx.AsyncClient(
                        transport=self._transport, timeout=self.config.timeout_seconds
                    ) as client:
                        response = await client.post(
                            f"{self.config.base_url}{path}",
                            headers=self._headers(),
                            json=payload,
                        )
                except httpx.TimeoutException as exc:
                    last_health = "unavailable"
                    if attempt + 1 >= attempts:
                        self._health = last_health
                        raise VoyageError("unavailable", "Voyage request timed out.") from exc
                    await asyncio.sleep(delay + random.random() * delay)
                    delay = min(delay * 2, 2.0)
                    continue
                except httpx.HTTPError as exc:
                    last_health = "unavailable"
                    if attempt + 1 >= attempts:
                        self._health = last_health
                        raise VoyageError("unavailable", "Voyage request failed.") from exc
                    await asyncio.sleep(delay + random.random() * delay)
                    delay = min(delay * 2, 2.0)
                    continue
                if response.status_code in _RETRYABLE and attempt + 1 < attempts:
                    last_health = "rate_limited" if response.status_code == 429 else "unavailable"
                    await asyncio.sleep(delay + random.random() * delay)
                    delay = min(delay * 2, 2.0)
                    continue
                if response.status_code >= 400:
                    health = self._classify(response.status_code, response.text)
                    self._health = health
                    raise VoyageError(
                        health,
                        redact_secret(
                            f"Voyage HTTP {response.status_code} on {path}.",
                            self.config.api_key,
                        ),
                        status_code=response.status_code,
                    )
                try:
                    body = response.json()
                except ValueError as exc:
                    self._health = "unavailable"
                    raise VoyageError("unavailable", "Voyage returned non-JSON.") from exc
                if not isinstance(body, dict):
                    self._health = "unavailable"
                    raise VoyageError("unavailable", "Voyage returned an unexpected body.")
                return body
        self._health = last_health
        raise VoyageError(last_health, "Voyage request was not completed.")

    def _parse_embeddings(
        self, body: dict[str, Any], *, model: str, input_type: str, count: int
    ) -> EmbeddingBatch:
        rows = body.get("data")
        if not isinstance(rows, list) or len(rows) != count:
            raise VoyageError("unavailable", "Embedding batch size did not match the request.")
        ordered = sorted(rows, key=lambda row: int(row.get("index", 0)))
        raw_vectors = [row.get("embedding") for row in ordered]
        if any(not isinstance(vector, list) for vector in raw_vectors):
            raise VoyageError("unavailable", "Embedding payload was malformed.")
        dimension = len(raw_vectors[0]) if raw_vectors else 0
        expected = self._expected_dimension(model)
        if expected is not None and dimension != expected:
            raise VoyageError("unavailable", f"Dimension {dimension} != expected {expected}.")
        if dimension == 0:
            raise VoyageError("unavailable", "Embedding dimension is zero.")
        vectors = [_finite_vector(vector, dimension) for vector in raw_vectors]
        usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
        tokens = usage.get("total_tokens")
        token_count = int(tokens) if isinstance(tokens, int) else None
        if token_count:
            self.usage.embedding_tokens += token_count
        reported = body.get("model") if isinstance(body.get("model"), str) else model
        self._health = "connected"
        self._verified = True
        return EmbeddingBatch(
            vectors=vectors,
            model=reported,
            dimension=dimension,
            embedding_version=embedding_version(reported, dimension),
            input_type="document" if input_type == "document" else "query",
            total_tokens=token_count,
        )

    async def embed_batch(self, texts: list[str], *, input_type: str, model: str | None = None) -> EmbeddingBatch:
        if input_type not in {"document", "query"}:
            raise VoyageError("unavailable", "input_type must be document or query.")
        if not texts:
            raise VoyageError("unavailable", "No texts to embed.")
        cleaned = [self._guard_text(text) for text in texts]
        # Query and document embeddings share one model so a single index version stays valid.
        # voyage-4-lite remains available as VOYAGE_FAST_MODEL but is not mixed in implicitly.
        chosen = model or self.config.embedding_model
        vectors: list[list[float]] = []
        version = ""
        dimension = 0
        tokens = 0
        reported = chosen
        for start in range(0, len(cleaned), self.config.batch_size):
            chunk = cleaned[start : start + self.config.batch_size]
            payload: dict[str, Any] = {"input": chunk, "model": chosen, "input_type": input_type}
            if self.config.output_dimension:
                payload["output_dimension"] = self.config.output_dimension
            body = await self._request("/embeddings", payload)
            parsed = self._parse_embeddings(body, model=chosen, input_type=input_type, count=len(chunk))
            if version and parsed.embedding_version != version:
                raise VoyageError("unavailable", "Mixed embedding versions in one batch.")
            version = parsed.embedding_version
            dimension = parsed.dimension
            reported = parsed.model
            if parsed.total_tokens:
                tokens += parsed.total_tokens
            vectors.extend(parsed.vectors)
        return EmbeddingBatch(
            vectors=vectors,
            model=reported,
            dimension=dimension,
            embedding_version=version,
            input_type="document" if input_type == "document" else "query",
            total_tokens=tokens or None,
        )

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        batch = await self.embed_batch(texts, input_type="document")
        return batch.vectors

    async def embed_query(self, query: str) -> list[float]:
        batch = await self.embed_batch([query], input_type="query", model=self.config.embedding_model)
        return batch.vectors[0]

    async def rerank(self, query: str, documents: list[str], top_k: int) -> list[RankedDocument]:
        if top_k < 1:
            raise VoyageError("unavailable", "top_k must be positive.")
        if not documents:
            return []
        cleaned_query = self._guard_text(query)
        cleaned_docs = [self._guard_text(document) for document in documents]
        body = await self._request(
            "/rerank",
            {
                "query": cleaned_query,
                "documents": cleaned_docs,
                "model": self.config.rerank_model,
                "top_k": min(top_k, len(cleaned_docs)),
                "return_documents": False,
            },
        )
        rows = body.get("data")
        if not isinstance(rows, list):
            self._health = "unavailable"
            raise VoyageError("unavailable", "Rerank payload was malformed.")
        ranked: list[RankedDocument] = []
        for row in rows:
            if not isinstance(row, dict):
                raise VoyageError("unavailable", "Rerank row was malformed.")
            index = int(row.get("index", -1))
            score = float(row.get("relevance_score", 0.0))
            if not math.isfinite(score) or index < 0 or index >= len(cleaned_docs):
                raise VoyageError("unavailable", "Rerank score or index was invalid.")
            ranked.append(RankedDocument(index=index, text=cleaned_docs[index], relevance_score=score))
        usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
        tokens = usage.get("total_tokens")
        if isinstance(tokens, int):
            self.usage.rerank_tokens += tokens
        self._health = "connected"
        self._verified = True
        ranked.sort(key=lambda item: item.relevance_score, reverse=True)
        return ranked[:top_k]

    def embed(self, text: str) -> list[float] | None:
        """Existing synchronous helper. Returns None when disabled, unconfigured, or refused."""
        if self._health in {"disabled", "not_configured"} or not text:
            return None
        try:
            cleaned = self._guard_text(text)
        except VoyageError:
            return None
        payload = {
            "input": [cleaned],
            "model": self.config.embedding_model,
            "input_type": "document",
        }
        try:
            with httpx.Client(transport=self._transport, timeout=self.config.timeout_seconds) as client:
                response = client.post(
                    f"{self.config.base_url}/embeddings",
                    headers=self._headers(),
                    json=payload,
                )
            response.raise_for_status()
            body = response.json()
            parsed = self._parse_embeddings_sync(body)
            self._health = "connected"
            self._verified = True
            return parsed
        except Exception:
            if self._health == "configured_unverified":
                self._health = "unavailable"
            return None

    def _parse_embeddings_sync(self, body: dict[str, Any]) -> list[float]:
        rows = body.get("data") or []
        vector = rows[0]["embedding"]
        expected = self._expected_dimension(self.config.embedding_model)
        dimension = len(vector)
        if expected is not None and dimension != expected:
            raise VoyageError("unavailable", "Unexpected embedding dimension.")
        return _finite_vector(vector, dimension)
