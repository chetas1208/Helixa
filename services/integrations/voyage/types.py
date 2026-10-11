"""Shared retrieval types. Embeddings and reranking only; no chat completion."""

from __future__ import annotations

from typing import Literal, Protocol

from pydantic import BaseModel, Field

HealthState = Literal[
    "disabled",
    "not_configured",
    "configured_unverified",
    "connected",
    "rate_limited",
    "permission_denied",
    "wrong_scope",
    "unavailable",
]

# Default float dimensions from MongoDB Voyage model docs (fetched 2026-10-11).
MODEL_DIMENSIONS: dict[str, int] = {
    "voyage-4-large": 1024,
    "voyage-4": 1024,
    "voyage-4-lite": 1024,
    "voyage-4-nano": 512,
    "voyage-3-large": 1024,
    "voyage-3.5": 1024,
    "voyage-3.5-lite": 1024,
    "voyage-code-4": 1024,
    "voyage-code-3": 1024,
    "voyage-finance-2": 1024,
    "voyage-law-2": 1024,
    "voyage-code-2": 1536,
}

# voyage-4, voyage-4-large, and voyage-4-lite embeddings are documented as compatible.
SERIES_4_COMPATIBLE = frozenset({"voyage-4-large", "voyage-4", "voyage-4-lite"})

ALLOWED_HOSTS = frozenset({"ai.mongodb.com", "us.ai.mongodb.com", "eu.ai.mongodb.com"})


class RankedDocument(BaseModel):
    index: int
    text: str
    relevance_score: float
    document_id: str | None = None


class EmbeddingBatch(BaseModel):
    vectors: list[list[float]]
    model: str
    dimension: int
    embedding_version: str
    input_type: Literal["document", "query"]
    total_tokens: int | None = None


class UsageRecord(BaseModel):
    embedding_tokens: int = 0
    rerank_tokens: int = 0
    embedding_model: str | None = None
    rerank_model: str | None = None


class ResearchRetrievalModel(Protocol):
    async def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    async def embed_query(self, query: str) -> list[float]: ...

    async def rerank(self, query: str, documents: list[str], top_k: int) -> list[RankedDocument]: ...


def embedding_version(model: str, dimension: int) -> str:
    return f"{model}:float:{dimension}"


def versions_compatible(left: str, right: str) -> bool:
    """True only when two embedding version strings may share one index."""
    if left == right:
        return True
    try:
        l_model, l_dtype, l_dim = left.split(":")
        r_model, r_dtype, r_dim = right.split(":")
    except ValueError:
        return False
    if l_dtype != r_dtype or l_dim != r_dim or l_dtype != "float":
        return False
    return l_model in SERIES_4_COMPATIBLE and r_model in SERIES_4_COMPATIBLE


class ProviderStatus(BaseModel):
    health: HealthState
    legacy_status: Literal["CONFIGURED", "NOT_CONFIGURED"]
    embedding_model: str | None = None
    fast_model: str | None = None
    rerank_model: str | None = None
    base_host: str | None = None
    key_scope: str | None = None
    verified: bool = False
    usage: UsageRecord = Field(default_factory=UsageRecord)
