#!/usr/bin/env bash
# HELIXA V17 Rebrand Verification Runner
# Verifies product display name, health endpoint, brand tests, tab contracts, and TypeScript build.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
PYTHON="${REPO}/.venv/bin/python"
PYTEST="${REPO}/.venv/bin/pytest"
RUFF="${REPO}/.venv/bin/ruff"
OUT="${REPO}/artifacts/helixa-v17"

mkdir -p "$OUT"

echo "========================================================================"
echo "  HELIXA V17 — Product Identity & Rebrand Verification Suite"
echo "========================================================================"

echo -e "\n[1/5] Checking Python Code Quality (Identity & Config)..."
"$RUFF" check services/api/app/config.py services/api/app/routes/health.py services/api/app/main.py services/tests/test_v17_identity.py
echo "  -> Ruff: PASS"

echo -e "\n[2/5] Running Backend Identity and Health Tests..."
"$PYTEST" -q services/tests/test_v17_identity.py services/tests/test_api_routes.py::test_api_health_endpoint
echo "  -> Backend Identity Tests: PASS"

echo -e "\n[3/5] Running Frontend Vitest Brand & Contract Tests..."
pnpm --filter web exec vitest run tests/v17/brand.test.ts tests/v12/contracts.test.ts
echo "  -> Vitest Brand Tests: PASS"

echo -e "\n[4/5] Checking Frontend TypeScript Compilation..."
pnpm --filter web exec tsc --noEmit
echo "  -> TypeScript Compiler: PASS (clean)"

echo -e "\n[5/5] Checking Branding Documentation Integrity..."
test -f "${REPO}/docs/branding/HELIXA_RENAME_INVENTORY.md"
test -f "${REPO}/docs/branding/NAME_CLEARANCE_REQUIRED.md"
echo "  -> Branding Documentation: PASS"

# Generate machine-readable JSON report
"$PYTHON" - "$OUT/rebrand_verification.json" << 'PY'
import json, sys, time
out_path = sys.argv[1]
report = {
    "campaign": "HELIXA V17",
    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "status": "PASS",
    "product_display_name": "HELIXA",
    "tagline": "Explore DNA. Understand change.",
    "gates": {
        "ruff_lint": "PASS",
        "backend_identity_tests": "PASS",
        "vitest_brand_tests": "PASS",
        "frontend_tsc": "PASS",
        "branding_docs": "PASS"
    },
    "verdict": "VERIFIED_REBRAND_SAFE"
}
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)
PY

echo -e "\n========================================================================"
echo "  ALL REBRAND GATES PASSED! Report saved to:"
echo "  artifacts/helixa-v17/rebrand_verification.json"
echo "========================================================================"
