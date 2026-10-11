from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import ValidationError

from services.api.app.dependencies import get_mongo_client
from services.integrations.mongodb import EventRepository, MongoDBClient
from services.runtime.genomics.contracts import ValidationFinding

router = APIRouter(prefix="/api", tags=["findings"])

_EVENT_PAGE_SIZE = 200
_MAX_EVENT_PAGES = 50


def _to_finding(raw: Any) -> dict[str, Any] | None:
    """Project a recorded finding onto the UI Finding shape; None if it is not a valid finding."""
    if not isinstance(raw, dict):
        return None
    try:
        finding = ValidationFinding(**raw)
    except (ValidationError, TypeError):
        return None

    out: dict[str, Any] = {
        "check_id": finding.check_id,
        "status": finding.status.value,
        "severity": finding.severity.value,
        "message": finding.message,
    }
    if finding.locus is not None:
        out["locus"] = {
            "chrom": finding.locus.chrom,
            "pos": finding.locus.pos,
            "ref": finding.locus.ref,
            "alt": list(finding.locus.alt),
        }
    metadata = dict(finding.metadata)
    if finding.observed_value is not None:
        metadata.setdefault("observed_value", finding.observed_value)
    if finding.expected_value is not None:
        metadata.setdefault("expected_value", finding.expected_value)
    if metadata:
        out["metadata"] = metadata
    return out


def _collect(raw_findings: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_findings, list):
        return []
    return [f for f in (_to_finding(r) for r in raw_findings) if f is not None]


@router.get("/runs/{run_id}/findings")
async def get_run_findings(
    run_id: str = Path(min_length=1, max_length=256),
    mongo: MongoDBClient = Depends(get_mongo_client),
):
    """
    Findings recorded for a run. Read from the persisted run document first,
    then from run-event payloads that carry a `findings` list.
    """
    run_doc = await mongo.db.runs.find_one({"run_id": run_id}, {"_id": 0, "findings": 1})
    events = EventRepository(mongo=mongo)

    findings = _collect(run_doc.get("findings")) if run_doc else []

    known = run_doc is not None
    if not findings:
        after_seq = 0
        for _ in range(_MAX_EVENT_PAGES):
            page = await events.get_events(run_id=run_id, after_seq=after_seq, limit=_EVENT_PAGE_SIZE)
            if not page:
                break
            known = True
            for evt in page:
                findings.extend(_collect(evt.payload.get("findings")))
            if len(page) < _EVENT_PAGE_SIZE:
                break
            after_seq = page[-1].seq

    if not known:
        known = await mongo.db.evidence_receipts.find_one({"run_id": run_id}, {"_id": 1}) is not None
    if not known:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

    return {"run_id": run_id, "findings": findings}
