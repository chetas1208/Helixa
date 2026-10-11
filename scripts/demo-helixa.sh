#!/usr/bin/env bash
# HELIXA V17 Showcase Runner
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
PYTHON="${REPO}/.venv/bin/python"
OUT="${REPO}/artifacts/helixa-v17"

mkdir -p "$OUT"

echo "========================================================================"
echo "  HELIXA V17 — Product Identity Showcase"
echo "========================================================================"

"$PYTHON" - "$OUT/demo_output.json" << 'PY'
import json, sys, time
from services.api.app.config import config
from services.api.app.routes.health import _product_display_name

out_path = sys.argv[1]

print(f"  Official Product Display Name: {config.product_display_name}")
print(f"  Dynamic Display Name:          {_product_display_name()}")
print(f"  Persistent Database Name:      {config.mongodb_database} (preserved)")
print(f"  Persistent Service Identifier: {config.mongodb_app_name} (preserved)")
print(f"  Short Tagline:                 Explore DNA. Understand change.")
print(f"  Four-Tab Layout:")
print(f"    [1] Genome Editor")
print(f"    [2] Genome & Harness Evolution")
print(f"    [3] Earth Evolution Sandbox")
print(f"    [4] Harness Library")

demo_payload = {
    "product_name": config.product_display_name,
    "tagline": "Explore DNA. Understand change.",
    "category": "Interactive genome engineering, scientific evidence, and hypothetical evolutionary simulation platform.",
    "four_tabs": [
        "Genome Editor",
        "Genome & Harness Evolution",
        "Earth Evolution Sandbox",
        "Harness Library"
    ],
    "compatibility": {
        "mongodb_database": config.mongodb_database,
        "service_id": config.mongodb_app_name,
        "backward_compatible": True
    },
    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "status": "OPERATIONAL"
}

with open(out_path, "w", encoding="utf-8") as f:
    json.dump(demo_payload, f, indent=2)

print("\n  Summary saved to:")
print(f"  {out_path}")
PY

echo "========================================================================"
