#!/usr/bin/env bash
set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=== Setting up DIAMOND Genome V4 Environment ==="

# 1. Python virtualenv
if [ ! -d ".venv" ]; then
  echo "Creating uv Python 3.12 virtual environment..."
  uv venv .venv --python 3.12
fi

echo "Installing backend dependencies..."
uv pip install --python .venv/bin/python \
  fastapi uvicorn pydantic httpx pymongo pysam pytest pytest-asyncio ruff python-multipart

# 2. Node & Frontend
echo "Installing frontend dependencies..."
pnpm install

# 3. Generate fixtures
echo "Generating synthetic research fixtures..."
.venv/bin/python scripts/generate_fixtures.py
.venv/bin/python scripts/generate_manifest.py

# 4. Seed MongoDB
echo "Seeding MongoDB collections..."
.venv/bin/python scripts/seed_demo.py

echo "=== Setup complete! Use 'make dev' or 'make verify' ==="
