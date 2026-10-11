from __future__ import annotations

import logging
import os
import re
from typing import Any

import httpx
from pydantic import BaseModel

logger = logging.getLogger("diamond.raindrop")

_NUCLEOTIDE_RUN = re.compile(r"[ACGTNacgtn]{16,}")
_DISALLOWED_KEYS = {
    "sequence",
    "fasta",
    "vcf",
    "content",
    "file_bytes",
    "nucleotides",
    "secret",
    "token",
    "password",
    "api_key",
    "write_key",
    "authorization",
    "bases",
    "transcript",
    "audio",
    "reference_allele",
    "alternate_allele",
    "current_allele",
    "preview",
}

_ID_KEYS = frozenset(
    {
        "proposal_id",
        "workspace_id",
        "revision_id",
        "genome_revision_id",
        "locus_id",
        "anatomy_id",
        "gene_id",
        "run_id",
        "simulation_id",
    }
)

class RunMetadata(BaseModel):
    run_id: str
    task_id: str
    dataset_id: str
    harness_version: str
    started_at: str

class ToolEvent(BaseModel):
    run_id: str
    tool_name: str
    runtime_ms: float
    exit_code: int

class FailureEvent(BaseModel):
    run_id: str
    check_id: str
    severity: str
    message: str

class EvaluationTelemetry(BaseModel):
    run_id: str
    candidate_version_id: str
    score: str
    promoted: bool
    receipt_digest: str

class RaindropAdapter:
    """
    Vendor-isolated Raindrop telemetry adapter.
    Enforces strict privacy: never transmits raw nucleotide sequences,
    file bodies, patient IDs, or private secrets.
    """

    def __init__(
        self,
        endpoint: str | None = None,
        write_key: str | None = None,
        project_id: str | None = None,
        enabled: bool | None = None,
    ):
        self.endpoint = endpoint or os.getenv("RAINDROP_ENDPOINT", "https://api.raindrop.ai/v1")
        self.write_key = os.getenv("RAINDROP_WRITE_KEY", "") if write_key is None else write_key
        self.project_id = project_id or os.getenv("RAINDROP_PROJECT_ID", "")
        self.enabled = enabled if enabled is not None else (os.getenv("RAINDROP_ENABLED", "false").lower() == "true")
        self._mock_traces: list[dict[str, Any]] = []

    @property
    def status(self) -> str:
        if not self.enabled or not self.write_key:
            return "NOT_CONFIGURED"
        return "CONFIGURED"

    def _sanitize(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Drop secret and sequence keys, then scrub nucleotide runs inside remaining strings."""
        sanitized: dict[str, Any] = {}
        for key, value in payload.items():
            lowered = key.lower()
            if lowered in _DISALLOWED_KEYS or any(part in lowered for part in _DISALLOWED_KEYS):
                continue
            if _NUCLEOTIDE_RUN.search(key):
                continue
            sanitized[key] = self._scrub_value(value)
        return sanitized

    def _scrub_value(self, value: Any) -> Any:
        if isinstance(value, str):
            return _NUCLEOTIDE_RUN.sub("[redacted-nucleotide]", value)
        if isinstance(value, dict):
            return self._sanitize(value)
        if isinstance(value, list):
            return [self._scrub_value(item) for item in value]
        if isinstance(value, tuple):
            return tuple(self._scrub_value(item) for item in value)
        return value

    async def start_run(self, metadata: RunMetadata) -> bool:
        data = self._sanitize(metadata.model_dump())
        return await self._dispatch("run.started", data)

    async def record_tool(self, event: ToolEvent) -> bool:
        data = self._sanitize(event.model_dump())
        return await self._dispatch("tool.executed", data)

    async def record_failure(self, event: FailureEvent) -> bool:
        data = self._sanitize(event.model_dump())
        return await self._dispatch("integrity.failure", data)

    async def record_evaluation(self, event: EvaluationTelemetry) -> bool:
        data = self._sanitize(event.model_dump())
        return await self._dispatch("harness.evaluated", data)

    async def finish_run(self, run_id: str, summary: dict[str, Any]) -> bool:
        data = self._sanitize({"run_id": run_id, **summary})
        return await self._dispatch("run.finished", data)

    async def record_ids(self, event_name: str, ids: dict[str, Any]) -> bool:
        """Emit identifiers only. Sequence, audio and transcripts are dropped."""
        payload = {
            key: value
            for key, value in ids.items()
            if key in _ID_KEYS and isinstance(value, str) and value
        }
        return await self._dispatch(event_name, self._sanitize(payload))

    async def _dispatch(self, event_name: str, payload: dict[str, Any]) -> bool:
        record = {
            "event": event_name,
            "project_id": self.project_id,
            "payload": payload,
        }
        self._mock_traces.append(record)

        if not self.enabled or not self.write_key:
            return False

        try:
            headers = {
                "Authorization": f"Bearer {self.write_key}",
                "Content-Type": "application/json",
            }
            # Official ingest is POST /v1/events/track with an array body.
            event = {
                "user_id": str(payload.get("run_id") or "diamond"),
                "event": event_name,
                "properties": {key: value for key, value in payload.items() if key != "run_id"},
            }
            async with httpx.AsyncClient(timeout=4.0) as client:
                res = await client.post(f"{self.endpoint}/events/track", json=[event], headers=headers)
                return res.status_code in (200, 201, 202, 204)
        except Exception as e:
            logger.warning(f"Raindrop telemetry dispatch error (non-fatal): {e}")
            return False
