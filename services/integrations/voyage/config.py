"""Environment configuration for MongoDB Atlas embedding and reranking."""

from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlparse

from services.integrations.voyage.errors import VoyageError
from services.integrations.voyage.types import ALLOWED_HOSTS


def _flag(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() == "true"


def _int(name: str, default: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError as exc:
        raise VoyageError("unavailable", f"{name} must be an integer.") from exc
    if value < 0:
        raise VoyageError("unavailable", f"{name} must be >= 0.")
    return value


def host_geography(base_url: str) -> str:
    host = (urlparse(base_url).hostname or "").lower()
    if host not in ALLOWED_HOSTS:
        raise VoyageError(
            "wrong_scope",
            f"VOYAGE_BASE_URL host '{host or '(missing)'}' is not an Atlas embedding endpoint. "
            "Use ai.mongodb.com, us.ai.mongodb.com, or eu.ai.mongodb.com. "
            "This client does not call chat completion hosts.",
        )
    if host == "ai.mongodb.com":
        return "unscoped"
    if host.startswith("us."):
        return "us"
    return "eu"


@dataclass(frozen=True)
class VoyageConfig:
    enabled: bool
    api_key: str
    base_url: str
    geography: str
    key_scope: str
    embedding_model: str
    fast_model: str
    rerank_model: str
    timeout_seconds: float
    max_retries: int
    batch_size: int
    max_input_chars: int
    allow_external_research_text: bool
    output_dimension: int | None

    @classmethod
    def from_env(cls) -> VoyageConfig:
        base = (
            os.getenv("VOYAGE_BASE_URL")
            or os.getenv("VOYAGE_API_BASE")
            or "https://ai.mongodb.com/v1"
        ).rstrip("/")
        geography = host_geography(base)
        key_scope = os.getenv("VOYAGE_KEY_SCOPE", "").strip().lower()
        if key_scope and key_scope != geography:
            raise VoyageError(
                "wrong_scope",
                f"VOYAGE_KEY_SCOPE={key_scope} does not match endpoint geography {geography}. "
                "Refusing to try another region.",
            )
        dimension_raw = os.getenv("VOYAGE_OUTPUT_DIMENSION", "").strip()
        dimension = int(dimension_raw) if dimension_raw else None
        return cls(
            enabled=_flag("VOYAGE_ENABLED"),
            api_key=os.getenv("VOYAGE_API_KEY", "").strip(),
            base_url=base,
            geography=geography,
            key_scope=key_scope or geography,
            embedding_model=(
                os.getenv("VOYAGE_EMBEDDING_MODEL") or os.getenv("VOYAGE_MODEL") or "voyage-4-large"
            ).strip(),
            fast_model=os.getenv("VOYAGE_FAST_MODEL", "voyage-4-lite").strip(),
            rerank_model=os.getenv("VOYAGE_RERANK_MODEL", "rerank-3").strip(),
            timeout_seconds=float(os.getenv("VOYAGE_TIMEOUT_SECONDS", "30")),
            max_retries=_int("VOYAGE_MAX_RETRIES", 3),
            batch_size=max(1, _int("VOYAGE_BATCH_SIZE", 32)),
            max_input_chars=max(1, _int("VOYAGE_MAX_INPUT_CHARS", 8000)),
            allow_external_research_text=_flag("VOYAGE_ALLOW_EXTERNAL_RESEARCH_TEXT"),
            output_dimension=dimension,
        )

    @property
    def host(self) -> str:
        return urlparse(self.base_url).hostname or ""
