#!/usr/bin/env bash
# DIAMOND Genome V15 Showcase Runner
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
PYTHON="${REPO}/.venv/bin/python"

echo "=== Executing DIAMOND Genome V15 Showcase Scenarios ==="
"$PYTHON" "$REPO/scripts/demo_v15.py"
