"""V14 GWAS guardrails: Catalog REST API v2 with study context, never a causal claim."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from services.runtime.genome_workspace.store import WorkspaceStore
from services.tests.test_v14_guardrails import REPO_OWNER_2, require_status

MYH7 = "ENSG00000092054"
GWAS_SOURCE = "GWAS Catalog REST API v2"
REQUIRED_ASSOC_FIELDS = (
    "association_id",
    "study_accession",
    "pubmed_id",
    "first_author",
    "reported_trait",
    "p_value",
    "source_url",
)


@pytest.fixture
def isolated_client(tmp_path, monkeypatch):
    monkeypatch.setenv("V10_STATE_PATH", str(tmp_path / "v14_guardrails_gwas.json"))
    from services.api.app.routes import v10

    previous = v10._store
    v10._store = WorkspaceStore(path=tmp_path / "v14_guardrails_gwas.json")
    try:
        from services.api.app.main import app

        yield TestClient(app)
    finally:
        v10._store = previous


def test_gwas_variants_are_catalog_v2_with_study_context(isolated_client: TestClient):
    response = isolated_client.get(f"/api/genes/{MYH7}/variants?assembly=GRCh38")
    require_status(response, f"GET /api/genes/{MYH7}/variants?assembly=GRCh38", REPO_OWNER_2)
    payload = response.json()
    assert payload.get("source") == GWAS_SOURCE, (
        f"GWAS payload source must be {GWAS_SOURCE!r}, got {payload.get('source')!r}. "
        "v1 Catalog URLs and invented associations are banned."
    )
    statuses = payload.get("source_status") or []
    assert statuses, "GWAS response missing source_status"
    gwas_rows = [s for s in statuses if "gwas" in (s.get("source_id") or "").lower()]
    assert gwas_rows, f"source_status has no GWAS row: {statuses}"

    associations = payload.get("associations") or []
    unavailable = any(s.get("status") == "unavailable" for s in gwas_rows)
    if unavailable:
        assert associations == [], (
            "GWAS source is unavailable but associations were fabricated."
        )
        return

    if not associations:
        cached = any(s.get("status") in {"cached", "live"} for s in gwas_rows)
        assert cached or unavailable, (
            "Empty GWAS list without live|cached|unavailable status is not honest."
        )
        return

    for assoc in associations:
        missing = [f for f in REQUIRED_ASSOC_FIELDS if not assoc.get(f) and assoc.get(f) != 0]
        assert not missing, f"GWAS association missing study context {missing}: {assoc}"
        traits = assoc.get("reported_trait")
        assert traits, "reported_trait is required study context"
        assert assoc.get("study_accession"), "study_accession is required (GWAS v2)"
        assert assoc.get("pubmed_id"), "pubmed_id is required study context"
        blob = str(assoc).lower()
        assert "causes" not in blob
        assert "controls this organ" not in blob


def test_gwas_v1_path_is_not_the_source(isolated_client: TestClient):
    response = isolated_client.get(f"/api/genes/{MYH7}/variants?assembly=GRCh38")
    if response.status_code == 404:
        pytest.fail(f"{REPO_OWNER_2} has not landed GET /api/genes/{{id}}/variants.")
    payload = response.json()
    source = str(payload.get("source") or "")
    assert "/gwas/rest/api/v1" not in source.lower()
    assert "v2" in source.lower()
