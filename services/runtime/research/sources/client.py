"""Shared HTTP policy for public research sources. No secrets and no genome strings."""

from __future__ import annotations

import time
from typing import Any

import httpx

USER_AGENT = "HELIXA-V18/research (local educational; research-use-only)"


class SourceError(Exception):
    def __init__(self, source_id: str, status: str, message: str) -> None:
        self.source_id = source_id
        self.status = status
        super().__init__(message)


def get_json(
    url: str,
    *,
    source_id: str,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
    timeout: float = 12.0,
    transport: httpx.BaseTransport | None = None,
) -> tuple[int, Any]:
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    delay = 0.05
    last = "SOURCE_UNAVAILABLE"
    for attempt in range(3):
        try:
            with httpx.Client(transport=transport, timeout=timeout, follow_redirects=False) as client:
                if json_body is None:
                    response = client.get(url, params=params, headers=headers)
                else:
                    response = client.post(url, json=json_body, headers=headers)
        except httpx.TimeoutException as exc:
            last = "SOURCE_UNAVAILABLE"
            if attempt == 2:
                raise SourceError(source_id, last, "timeout") from exc
            time.sleep(delay)
            delay *= 2
            continue
        except httpx.HTTPError as exc:
            raise SourceError(source_id, "SOURCE_UNAVAILABLE", "network") from exc
        if response.status_code == 404:
            raise SourceError(source_id, "NOT_FOUND", "not found")
        if response.status_code in {429, 500, 502, 503, 504} and attempt < 2:
            time.sleep(delay)
            delay *= 2
            continue
        if response.status_code >= 400:
            raise SourceError(source_id, "SOURCE_UNAVAILABLE", f"HTTP {response.status_code}")
        try:
            return response.status_code, response.json()
        except ValueError as exc:
            raise SourceError(source_id, "SOURCE_UNAVAILABLE", "non-json") from exc
    raise SourceError(source_id, last, "retries exhausted")
