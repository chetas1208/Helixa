"""Optional LLM hint for interpret-command. Off unless configured. Never authoritative."""

from __future__ import annotations

import os
from typing import Any


def llm_suggest_enabled() -> bool:
    flag = os.getenv("GENOME_EDIT_LLM_SUGGEST", "").strip().lower()
    if flag not in {"1", "true", "yes"}:
        return False
    provider = os.getenv("MODEL_PROVIDER", "deterministic")
    if provider == "deterministic":
        return False
    return bool(os.getenv("MODEL_API_KEY") and os.getenv("MODEL_NAME"))


def suggest_intent(text: str) -> dict[str, Any] | None:
    """May return a non-authoritative hint. The grammar result always wins."""
    if not llm_suggest_enabled() or not text.strip():
        return None
    # Deliberately not calling a model here unless a future owner wires a real client.
    # A missing implementation must not invent an intent.
    return None
