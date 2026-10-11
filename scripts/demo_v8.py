#!/usr/bin/env python3
"""Run the synthetic V8 incident and write artifacts/v8."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from services.runtime.v8.experiment import run_campaign  # noqa: E402


def main() -> None:
    output = ROOT / "artifacts" / "v8"
    result = run_campaign(output, fixtures_root=ROOT)
    summary = {
        "status": result["status"],
        "promoted": result["promoted"],
        "fingerprint": result["fingerprint"],
        "promotion_writes": result["promotion_writes"],
        "output_dir": str(output),
    }
    (output / "demo_summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    if result["status"] != "COMPLETED" or not result["fingerprint_matches"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
