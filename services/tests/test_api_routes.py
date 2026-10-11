import pytest
from httpx import ASGITransport, AsyncClient

from services.api.app.main import app


@pytest.mark.asyncio
async def test_api_health_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["service"] == "diamond-genome-api"
        assert data["database"] == "CONNECTED"
        assert resp.headers.get("X-Content-Type-Options") == "nosniff"
        assert resp.headers.get("X-Frame-Options") == "DENY"

@pytest.mark.asyncio
async def test_api_health_ready_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/health/ready")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ready"] is True
        assert data["status"] == "READY"
        assert data["database"]["write_verified"] is True

@pytest.mark.asyncio
async def test_api_integrations_status_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/integrations/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["mongodb"]["status"] in ("CONNECTED", "WRITE_VERIFIED")
        assert data["raindrop"]["status"] in ("NOT_CONFIGURED", "CONFIGURED")
        assert data["elevenlabs"]["status"] in ("NOT_CONFIGURED", "CONFIGURED")

@pytest.mark.asyncio
async def test_api_datasets_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/datasets")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["datasets"]) >= 1
        assert data["datasets"][0]["dataset_id"] == "SYNTH-GENOME-INCIDENT-001"

@pytest.mark.asyncio
async def test_api_run_creation_and_evolution_flow():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Create run
        create_resp = await client.post("/api/runs", json={"vcf_filename": "ref_mismatch.vcf"})
        assert create_resp.status_code == 200
        run_data = create_resp.json()
        run_id = run_data["run_id"]
        assert run_data["status"] == "CREATED"

        # 2. Evolve run (triggers PCHE cycle)
        evolve_resp = await client.post(f"/api/runs/{run_id}/evolve")
        assert evolve_resp.status_code == 200
        evolve_data = evolve_resp.json()
        assert evolve_data["status"] == "PROMOTED"
        assert evolve_data["active_harness_version"] == "harness-v2-candidate"

        # 3. Query events
        events_resp = await client.get(f"/api/runs/{run_id}/events")
        assert events_resp.status_code == 200
        events_data = events_resp.json()
        assert len(events_data["events"]) >= 5

        # 4. Query lineage
        lineage_resp = await client.get("/api/harnesses/harness-v1/lineage")
        assert lineage_resp.status_code == 200
        lineage_data = lineage_resp.json()
        assert len(lineage_data["nodes"]) >= 2
        assert len(lineage_data["edges"]) >= 1

        # 5. Scene state
        scene_resp = await client.get("/api/scene/state")
        assert scene_resp.status_code == 200
        scene_data = scene_resp.json()
        assert scene_data["cycle_duration"] == 300.0

        # 6. Spoken briefing (caption fallback or audio stream)
        receipt_id = evolve_data["evidence_receipt_id"]
        brief_resp = await client.post("/api/voice/briefing", json={"receipt_id": receipt_id})
        assert brief_resp.status_code == 200
        if brief_resp.headers.get("content-type", "").startswith("audio/") or "x-caption-script" in brief_resp.headers:
            script = brief_resp.headers.get("x-caption-script", "")
        else:
            brief_data = brief_resp.json()
            script = brief_data.get("script", "")
        assert "reference allele integrity incident" in script
