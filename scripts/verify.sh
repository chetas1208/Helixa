#!/usr/bin/env bash
set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "============================================================"
echo "DIAMOND Genome V4: Local Verification Suite"
echo "============================================================"

RESULTS_DIR="artifacts/test-results"
mkdir -p "$RESULTS_DIR"

PYTHON="$PROJECT_ROOT/.venv/bin/python"
PYTEST="$PROJECT_ROOT/.venv/bin/pytest"
PNPM="$(which pnpm)"

# 1. Environment & Tool Probes
echo "[1/5] Checking bioinformatics and environment dependencies..."
"$PYTHON" -c "
import pysam
print('  pysam:', pysam.__version__)
print('  samtools/bcftools:', pysam.__samtools_version__)
"
(which bcftools >/dev/null && bcftools --version | head -n 1) || /home/923873155/.local/bin/bcftools --version | head -n 1

# 2. Integration Status Probe
echo "[2/5] Running integration status probe..."
"$PYTHON" scripts/check_integrations.py

# 3. Backend Unit & Integration Tests (pytest)
echo "[3/5] Executing Python backend test suite..."
"$PYTEST" -v services/tests/ | tee "$RESULTS_DIR/backend-tests.txt"

# 4. Frontend Unit Tests (vitest)
echo "[4/5] Executing Frontend test suite..."
pnpm --filter web test | tee "$RESULTS_DIR/frontend-tests.txt"

# 5. Frontend Production Build Check
echo "[5/5] Verifying Frontend TypeScript and bundle build..."
pnpm --filter web build

echo "============================================================"
echo "ALL VERIFICATION CHECKS PASSED!"
echo "Test artifacts saved to: $RESULTS_DIR"
echo "============================================================"
