"""Route contract: honest status, lexical citations, no sequence in the response."""

import pytest
from httpx import ASGITransport, AsyncClient

from services.api.app.main import app


@pytest.mark.asyncio
async def test_research_status_and_search_are_honest_without_a_live_key():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        status = await client.get("/api/v16/research/status")
        assert status.status_code == 200
        body = status.json()
        assert body["health"] in {
            "disabled",
            "not_configured",
            "configured_unverified",
            "connected",
            "rate_limited",
            "permission_denied",
            "wrong_scope",
            "unavailable",
        }
        assert body["verified"] is False or body["health"] == "connected"
        assert "api_key" not in status.text.lower() or "api_key" in body.get("disclaimer", "").lower()
        search = await client.post(
            "/api/v16/research/search",
            json={
                "query": "BRCA1 hereditary breast cancer association",
                "context": {"gene_id": "BRCA1", "task_type": "editor", "assembly": "GRCh38"},
                "top_k": 4,
                "policy": "exact_lexical",
            },
        )
        assert search.status_code == 200
        payload = search.json()
        assert payload["untrusted"] is True
        assert payload["citations"][0]["document_id"] == "doc-brca1"
        assert "ACGTACGTACGTACGT" not in search.text
        refused = await client.post(
            "/api/v16/research/search",
            json={"query": "ACGT" * 30, "policy": "exact_lexical"},
        )
        assert refused.status_code == 200
        assert refused.json()["status"] == "refused"
        bad = await client.post(
            "/api/v16/research/search",
            json={"query": "BRCA1", "policy": "change_the_evaluator"},
        )
        assert bad.status_code == 400
