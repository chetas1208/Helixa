.PHONY: dev test audit-backend verify verify-m01 verify-m02 verify-v8 verify-v8-atlas atlas-check demo demo-v8 worker demo-kill-worker mongo-start mongo-stop clean install audit verify-v7-science verify-v7-agents verify-v7-state verify-v7-sponsors verify-v7-security benchmark-v7 demo-v7 verify-v7 verify-v10 demo-v10 verify-v11 demo-v11 benchmark-v11 verify-v13 demo-v13 verify-v12-ui demo-v12-ui voyage-check verify-v16 demo-v16 verify-helixa-rebrand demo-helixa verify-v14 demo-v14 verify-v15 demo-v15

VENV = .venv
PYTHON = $(VENV)/bin/python
UVICORN = $(VENV)/bin/uvicorn
PYTEST = $(VENV)/bin/pytest
RUFF = $(VENV)/bin/ruff
MONGO_BIN = /home/923873155/.local/mongodb/bin/mongod
MONGO_DATA = /home/923873155/.local/share/diamond_mongo_data

install:
	uv venv $(VENV) --python 3.12
	uv pip install --python $(PYTHON) fastapi uvicorn pydantic httpx pymongo pysam pytest pytest-asyncio ruff python-multipart
	pnpm install

mongo-start:
	@mkdir -p $(MONGO_DATA)
	@if pgrep -f "mongod.*27017" > /dev/null; then \
		echo "MongoDB is already running on 127.0.0.1:27017"; \
	else \
		$(MONGO_BIN) --dbpath $(MONGO_DATA) --bind_ip 127.0.0.1 --port 27017 --fork --logpath $(MONGO_DATA)/mongod.log; \
		echo "MongoDB started on 127.0.0.1:27017"; \
	fi

mongo-stop:
	@pkill -f "mongod.*27017" || echo "MongoDB not running"

dev: mongo-start
	@echo "Starting backend and frontend..."
	$(UVICORN) services.api.app.main:app --host 127.0.0.1 --port 8000 --reload & \
	API_PID=$$!; \
	pnpm --filter web dev & \
	WEB_PID=$$!; \
	trap "kill $$API_PID $$WEB_PID 2>/dev/null" EXIT; \
	wait

test:
	@mkdir -p artifacts/test-results
	bash -o pipefail -c '$(PYTEST) -v services/tests | tee artifacts/test-results/backend-tests.txt'
	pnpm --filter web test

audit-backend:
	$(PYTEST) -q services/tests
	$(RUFF) check services

atlas-check:
	@echo "=== Checking MongoDB Atlas Connectivity and Write Permissions ==="
	$(PYTHON) scripts/check_atlas.py

demo-kill-worker:
	@echo "=== Executing Chaos Demo: Worker Failure, Fencing & Checkpoint Recovery ==="
	$(PYTHON) scripts/demo_chaos.py

verify-m01:
	@echo "=== Running DIAMOND Genome Milestone 01/10 Verification Suite ==="
	$(PYTHON) scripts/verify_m01.py

verify-m02:
	@echo "=== Running DIAMOND Genome Milestone 02/10 Verification Suite ==="
	$(PYTHON) scripts/verify_m02.py

verify-v8:
	@echo "=== Running DIAMOND Genome V8 verification ==="
	$(PYTHON) scripts/verify_v8.py

demo-v8:
	@echo "=== Running DIAMOND Genome V8 synthetic incident ==="
	$(PYTHON) scripts/demo_v8.py

verify-v8-atlas:
	@echo "=== Running DIAMOND Genome V8 Atlas probe ==="
	$(PYTHON) scripts/verify_v8_atlas.py

verify: verify-m02

demo-m02:
	@echo "=== Running DIAMOND Genome Milestone 02/10 Scientific Demo ==="
	$(PYTHON) scripts/demo_m02.py

demo: demo-m02

audit:
	@echo "=== Running DIAMOND Genome Full-System Adversarial Audit & Release Gate ==="
	./scripts/audit_system.sh

verify-v7-science:
	@echo "=== Verifying V7 Scientific & Benchmark Validators ==="
	$(PYTEST) -v services/tests/test_v7_benchmark_suites.py services/tests/test_genomics_validator.py services/tests/test_m02_genomics.py

verify-v7-agents:
	@echo "=== Verifying V7 Autonomous Evolution & Optimization ==="
	$(PYTEST) -v services/tests/test_v7_optimization.py services/tests/test_v7_capabilities.py services/tests/test_v7_evolution_search.py services/tests/test_harness_evolution.py

verify-v7-state:
	@echo "=== Verifying V7 Durability, Forensics & Memory Dependency ==="
	$(PYTEST) -v services/tests/test_v7_incident_forensics.py services/tests/test_v7_memory_dependency.py services/tests/test_m01_durability.py services/tests/test_mongo_recovery.py

verify-v7-sponsors:
	@echo "=== Verifying Sponsor Integration Handlers ==="
	$(PYTEST) -v services/tests/test_integrations.py

verify-v7-security:
	@echo "=== Verifying Evidence Seal & Security Bounds ==="
	$(PYTEST) -v services/tests/test_v7_evidence_seal.py services/tests/test_v7_capabilities.py

benchmark-v7:
	@echo "=== Running DIAMOND Genome V7 Benchmark Suite ==="
	$(PYTHON) scripts/benchmark_v7.py

demo-v7:
	@echo "=== Running DIAMOND Genome V7 3-Minute Operator Demo ==="
	$(PYTHON) scripts/demo_v7.py

verify-v7: verify-v7-science verify-v7-agents verify-v7-state verify-v7-security benchmark-v7
	@echo "=== Full DIAMOND Genome V7 Verification Suite PASSED ==="

verify-v10:
	@echo "=== V10 population model, workspace store, and playback helper ==="
	$(RUFF) check services/runtime/population services/runtime/genome_workspace services/api/app/routes/v10.py services/tests/test_v10_wright_fisher.py services/tests/test_v10_workspace.py scripts/demo_v10.py
	$(PYTEST) -q services/tests/test_v10_wright_fisher.py services/tests/test_v10_workspace.py
	pnpm --filter web exec vitest run tests/playback.test.ts
	$(PYTHON) scripts/demo_v10.py

demo-v10:
	$(PYTHON) scripts/demo_v10.py

verify-v11:
	@echo "=== V11 diploid checks, workspace switch, and V10 regression ==="
	$(RUFF) check services/runtime/population services/runtime/genome_workspace services/api/app/routes/v10.py services/tests/test_v10_wright_fisher.py services/tests/test_v10_workspace.py services/tests/test_v11_science.py scripts/benchmark_v11.py
	$(PYTEST) -q services/tests/test_v10_wright_fisher.py services/tests/test_v10_workspace.py services/tests/test_v11_science.py
	pnpm --filter web exec vitest run tests/playback.test.ts

demo-v11: benchmark-v11

benchmark-v11:
	$(PYTHON) scripts/benchmark_v11.py

verify-v13:
	@echo "=== V13 workspace contract, playback independence, voice status ==="
	$(RUFF) check services/runtime/genome_workspace services/api/app/routes/v10.py services/api/app/routes/voice.py services/tests/test_v13_contract.py
	$(PYTEST) -q services/tests/test_v13_contract.py services/tests/test_v11_science.py services/tests/test_v10_workspace.py

demo-v13: verify-v13

worker:
	$(PYTHON) -m services.runtime.orchestration.worker

clean:
	rm -rf dist apps/web/dist .pytest_cache artifacts/test-results/*

verify-v12-ui:
	@echo "=== V12 frontend: tsc, source audit, vitest, vite build, Playwright (mocked + real + visual) ==="
	bash scripts/verify_v12_ui.sh all

demo-v12-ui:
	@echo "=== V12 frontend demo: throwaway backend + vite dev server (see docs/frontend/V12_DEMO_SCRIPT.md) ==="
	bash scripts/verify_v12_ui.sh demo

voyage-check:
	@echo "=== Sanitized Voyage embedding probe (fails closed without a key) ==="
	$(PYTHON) scripts/voyage_check.py

verify-v16:
	@echo "=== V16 retrieval adapter, lexical fallback, privacy, and panel ==="
	$(PYTHON) scripts/verify_v16.py

demo-v16:
	$(PYTHON) scripts/demo_v16.py

verify-helixa-rebrand:
	@echo "=== HELIXA display rename: identity, health field, tab titles ==="
	bash scripts/verify-helixa-rebrand.sh

demo-helixa:
	@echo "=== HELIXA product showcase ==="
	bash scripts/demo-helixa.sh

verify-v14:
	@echo "=== DIAMOND Genome V14 Anatomy-First Genome Editor Verification ==="
	bash scripts/verify_v14.sh all

demo-v14:
	@echo "=== DIAMOND Genome V14 Anatomy-First Genome Editor Acceptance Demo ==="
	$(PYTHON) scripts/demo_v14.py

verify-v15:
	@echo "=== DIAMOND Genome V15 Master Campaign Verification ==="
	bash scripts/verify-v15.sh

demo-v15:
	@echo "=== DIAMOND Genome V15 Master Campaign Showcase ==="
	bash scripts/demo-v15.sh

verify-v18:
	@echo "=== V18 evidence chain: mocked sources, claim checks, live Ensembl ==="
	$(RUFF) check services/runtime/research services/api/app/routes/v18_research.py services/tests/test_v18_research.py services/tests/test_v18_live_ensembl.py
	$(PYTEST) -q services/tests/test_v18_research.py services/tests/test_v18_live_ensembl.py

research-live-check:
	$(PYTEST) -q services/tests/test_v18_live_ensembl.py

demo-v18:
	$(PYTHON) -c "from services.runtime.research.investigate import investigate; r=investigate('Show me research about pigmentation and UV exposure', live=False); print(r['proposal']['status'])"
