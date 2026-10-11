"""V14 performance probes against in-process modules / a throwaway TestClient.

Never talks to :8000. Writes artifacts/milestones/v14/benchmark.json.
Missing Agent 2/4 APIs are recorded as status=missing — that is honest, not a silent pass.
"""

from __future__ import annotations

import importlib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
OUT = REPO / "artifacts" / "milestones" / "v14" / "benchmark.json"


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _probe(name: str, fn) -> dict:
    started = time.perf_counter()
    try:
        detail = fn()
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        row = {"name": name, "status": "ok", "elapsed_ms": elapsed_ms}
        if isinstance(detail, dict):
            row.update(detail)
        return row
    except ModuleNotFoundError as exc:
        return {"name": name, "status": "missing", "error": str(exc), "elapsed_ms": None}
    except Exception as exc:
        return {
            "name": name,
            "status": "fail",
            "error": f"{type(exc).__name__}: {exc}",
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
        }


def probe_registry() -> dict:
    registry = importlib.import_module("services.runtime.anatomy.registry")
    nodes = registry.list_nodes()
    return {"nodes": len(nodes)}


def probe_tree_http() -> dict:
    from fastapi.testclient import TestClient

    from services.api.app.main import app

    client = TestClient(app)
    response = client.get("/api/anatomy/tree")
    return {"http": response.status_code, "bytes": len(response.content)}


def probe_heart_genes() -> dict:
    from fastapi.testclient import TestClient

    from services.api.app.main import app

    client = TestClient(app)
    response = client.get("/api/anatomy/UBERON:0000948/genes")
    payload = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
    return {"http": response.status_code, "items": len(payload.get("items") or [])}


def probe_locus_window() -> dict:
    loci = importlib.import_module("services.runtime.anatomy.loci")
    listed = loci.list_loci()
    if not listed:
        raise RuntimeError("list_loci() empty")
    locus = listed[0]
    bases = loci.window(locus["locus_id"], locus["start"], min(locus["start"] + 39, locus["end"]))
    return {"locus_id": locus["locus_id"], "bases": len(bases)}


def probe_interpret() -> dict:
    from fastapi.testclient import TestClient

    from services.api.app.main import app

    client = TestClient(app)
    response = client.post(
        "/api/genome-edit/interpret-command",
        json={"text": "make my hands bigger", "source": "text"},
    )
    payload = response.json() if response.status_code < 500 else {}
    return {"http": response.status_code, "intent": payload.get("intent")}


def main() -> int:
    probes = [
        _probe("anatomy.registry.list_nodes", probe_registry),
        _probe("GET /api/anatomy/tree", probe_tree_http),
        _probe("GET /api/anatomy/UBERON:0000948/genes", probe_heart_genes),
        _probe("anatomy.loci.window", probe_locus_window),
        _probe("POST /api/genome-edit/interpret-command", probe_interpret),
    ]
    receipt = {
        "milestone": "v14",
        "generated_at": _now(),
        "note": (
            "Timings are in-process TestClient / local modules on this CPU. "
            "They are not GPU frame times and they never hit :8000."
        ),
        "probes": probes,
        "ok": sum(1 for p in probes if p["status"] == "ok"),
        "missing": sum(1 for p in probes if p["status"] == "missing"),
        "fail": sum(1 for p in probes if p["status"] == "fail"),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipt, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
