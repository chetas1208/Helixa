"""Errors for the Atlas embedding and reranking client. Messages never include secrets."""

from __future__ import annotations


class VoyageError(Exception):
    """Provider failure. `health` is a stable status string, not a connectivity claim."""

    def __init__(self, health: str, message: str, *, status_code: int | None = None) -> None:
        self.health = health
        self.status_code = status_code
        super().__init__(message)


class UnsafePayload(VoyageError):
    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__("refused", f"Outbound research text rejected ({reason}).")


class InputTooLong(VoyageError):
    def __init__(self, limit: int) -> None:
        super().__init__("unavailable", f"Input exceeds {limit} characters.")
