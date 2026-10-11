"""Optional Ensembl VEP REST lookup. Failures stay unavailable; never invent a consequence."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

ENSEMBL_VEP_URL = os.getenv("ENSEMBL_VEP_URL", "https://rest.ensembl.org/vep/human/region")


def vep_enabled() -> bool:
    return os.getenv("ENSEMBL_VEP_ENABLED", "true").strip().lower() in {"1", "true", "yes"}


def lookup_consequence(contig: str, position: int, alt: str, assembly: str) -> dict[str, Any]:
    if assembly != "GRCh38" or not contig or not alt:
        return {"consequence_status": "unavailable", "consequence": None}
    if not vep_enabled():
        return {"consequence_status": "unavailable", "consequence": None}
    try:
        import httpx
    except ImportError:
        return {"consequence_status": "unavailable", "consequence": None}
    url = f"{ENSEMBL_VEP_URL}/{contig}:{position}-{position}/{alt}"
    try:
        response = httpx.get(
            url,
            headers={"Accept": "application/json"},
            params={"content-type": "application/json"},
            timeout=4.0,
        )
    except Exception:
        return {"consequence_status": "unavailable", "consequence": None}
    if response.status_code >= 400:
        return {"consequence_status": "unavailable", "consequence": None}
    try:
        payload = response.json()
    except Exception:
        return {"consequence_status": "unavailable", "consequence": None}
    row = payload[0] if isinstance(payload, list) and payload else payload
    if not isinstance(row, dict):
        return {"consequence_status": "unavailable", "consequence": None}
    transcripts = []
    for item in row.get("transcript_consequences") or []:
        if not isinstance(item, dict):
            continue
        transcripts.append(
            {
                "transcript_id": item.get("transcript_id") or "",
                "consequence_terms": list(item.get("consequence_terms") or []),
                "amino_acids": item.get("amino_acids"),
                "codons": item.get("codons"),
            }
        )
    return {
        "consequence_status": "computed",
        "consequence": {
            "tool": "Ensembl VEP REST",
            "release": row.get("assembly_name") or "GRCh38",
            "most_severe_consequence": row.get("most_severe_consequence") or "",
            "transcript_consequences": transcripts,
            "computed_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        },
    }
