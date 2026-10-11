"""V14 scientific guardrails: laterality, evidence tiers, empty organs, source outage.

These tests encode the locked contract in docs/milestones/V14_UI_CONTRACTS.md.
If Agent 2/4 have not landed a module or route, the test FAILS with a clear owner+path.
That is correct. Do not skip a missing scientific rule.
"""

from __future__ import annotations

import importlib
from typing import Any

import pytest
from fastapi.testclient import TestClient

from services.runtime.genome_workspace.store import WorkspaceStore

REPO_OWNER_2 = "V14 Agent 2 (evidence + mapping)"
REPO_OWNER_4 = "V14 Agent 4 (contracts + persistence)"

EXPRESSION_CAVEAT = (
    "Expression shows the gene is active in this tissue. "
    "It does not show that editing it changes this organ."
)
BANNED_CAUSAL_COPY = (
    "genes that control",
    "gene that controls",
    "controls this organ",
    "causes this organ",
    "will enlarge",
    "will make your",
    "makes the organ",
)
PHENOTYPE_KINDS = {
    "VARIANT_TRAIT_ASSOCIATION",
    "CURATED_GENE_PHENOTYPE_RELATIONSHIP",
}
EXPRESSION_SOURCES = {"bgee", "hpa", "human_protein_atlas"}


def require_module(dotted: str, owner: str, path: str):
    try:
        return importlib.import_module(dotted)
    except ModuleNotFoundError as exc:
        pytest.fail(
            f"{owner} has not landed {path} ({dotted}): {exc}. "
            "Scientific guardrail cannot pass until that file exists."
        )


def require_attr(module: Any, name: str, owner: str, path: str):
    if not hasattr(module, name):
        pytest.fail(f"{owner} landed {path} but it does not export `{name}`.")
    return getattr(module, name)


def require_status(response, path: str, owner: str, ok: tuple[int, ...] = (200,)):
    if response.status_code == 404:
        pytest.fail(
            f"{owner} has not landed {path} (HTTP 404). "
            "Guardrail test fails until the route exists."
        )
    if response.status_code not in ok:
        pytest.fail(
            f"{path} returned HTTP {response.status_code}: {response.text[:500]}"
        )
    return response


@pytest.fixture
def isolated_client(tmp_path, monkeypatch):
    monkeypatch.setenv("V10_STATE_PATH", str(tmp_path / "v14_guardrails.json"))
    from services.api.app.routes import v10

    previous = v10._store
    v10._store = WorkspaceStore(path=tmp_path / "v14_guardrails.json")
    try:
        from services.api.app.main import app

        yield TestClient(app)
    finally:
        v10._store = previous


def test_anatomy_registry_module_is_present():
    require_module("services.runtime.anatomy.registry", REPO_OWNER_2, "services/runtime/anatomy/registry.py")


def test_anatomy_tree_laterality_left_and_right_are_distinct():
    registry = require_module(
        "services.runtime.anatomy.registry", REPO_OWNER_2, "services/runtime/anatomy/registry.py"
    )
    get_node = require_attr(registry, "get_node", REPO_OWNER_2, "services/runtime/anatomy/registry.py")
    resolve_text = require_attr(registry, "resolve_text", REPO_OWNER_2, "services/runtime/anatomy/registry.py")
    list_nodes = require_attr(registry, "list_nodes", REPO_OWNER_2, "services/runtime/anatomy/registry.py")

    nodes = list_nodes()
    assert nodes, f"{REPO_OWNER_2} returned an empty anatomy tree."

    left_hand = get_node("UBERON:0002398@left")
    right_hand = get_node("UBERON:0002398@right")
    assert left_hand, "Left hand UBERON:0002398@left is missing from the tree (Agent 2)."
    assert right_hand, "Right hand UBERON:0002398@right is missing from the tree (Agent 2)."
    assert left_hand["id"] != right_hand["id"]
    assert left_hand["laterality"] == "left"
    assert right_hand["laterality"] == "right"
    assert left_hand["ontology_id"] == "UBERON:0002398"
    assert right_hand["ontology_id"] == "UBERON:0002398"
    assert left_hand["ontology_status"] == "verified"
    assert right_hand["ontology_status"] == "verified"

    left_lung = get_node("UBERON:0002168")
    assert left_lung, "Left lung UBERON:0002168 (own Uberon class) is missing (Agent 2)."
    assert left_lung["laterality"] == "left"
    assert "@" not in left_lung["id"], (
        "Left lung has its own Uberon class; it must not be stored as a @left composite."
    )

    resolved = resolve_text("left hand")
    assert "UBERON:0002398@left" in resolved, (
        f"resolve_text('left hand') must be laterality-aware; got {resolved!r}"
    )
    assert "UBERON:0002398@right" not in resolved


def test_lateral_composite_only_when_uberon_has_no_lateral_class():
    registry = require_module(
        "services.runtime.anatomy.registry", REPO_OWNER_2, "services/runtime/anatomy/registry.py"
    )
    list_nodes = require_attr(registry, "list_nodes", REPO_OWNER_2, "services/runtime/anatomy/registry.py")
    nodes = list_nodes()
    by_id = {n["id"]: n for n in nodes}
    composites = [n for n in nodes if "@left" in n["id"] or "@right" in n["id"]]
    assert composites, "No @left/@right composites found; hand/foot laterality is required."
    for node in composites:
        bare = node["id"].split("@", 1)[0]
        assert bare not in by_id or by_id[bare].get("laterality") in {None, "none", "midline"}, (
            f"{node['id']} is a lateral composite but {bare} is already a lateral class; "
            "composites are only allowed when Uberon has no left/right class."
        )
        if node.get("ontology_status") == "verified":
            assert node.get("ontology_id") == bare, (
                f"Verified composite {node['id']} must store ontology_id={bare!r}."
            )
        else:
            assert node.get("ontology_status") == "unmapped"
            assert node.get("ontology_id") is None, (
                f"Unmapped DIAMOND composite {node['id']} must not invent an ontology_id."
            )
            assert bare.startswith("DIAMOND:")


def test_http_tree_exposes_laterality_and_source_status(isolated_client: TestClient):
    response = isolated_client.get("/api/anatomy/tree")
    require_status(response, "GET /api/anatomy/tree", REPO_OWNER_2)
    payload = response.json()
    assert "nodes" in payload and payload["nodes"], "Anatomy tree nodes are empty."
    assert "source_status" in payload, "Every evidence-bearing response must carry source_status."
    laterality = {n.get("laterality") for n in payload["nodes"]}
    assert {"left", "right"} <= laterality or any("@" in n.get("id", "") for n in payload["nodes"]), (
        "Tree has no left/right laterality."
    )


def test_expression_is_not_causality_and_carries_tier_plus_caveat(isolated_client: TestClient):
    tree = isolated_client.get("/api/anatomy/tree")
    require_status(tree, "GET /api/anatomy/tree", REPO_OWNER_2)
    heart = next(
        (n for n in tree.json()["nodes"] if n.get("ontology_id") == "UBERON:0000948" or "heart" in n.get("label", "").lower()),
        None,
    )
    assert heart, "Heart node is missing from the anatomy tree (Agent 2)."

    genes = isolated_client.get(f"/api/anatomy/{heart['id']}/genes")
    require_status(genes, f"GET /api/anatomy/{heart['id']}/genes", REPO_OWNER_2)
    payload = genes.json()
    items = payload.get("items") or []
    if not items:
        reason = payload.get("empty_reason")
        assert reason, (
            f"Heart gene panel is empty with no honest empty_reason. "
            f"empty_reason={reason!r}"
        )
        for node in tree.json()["nodes"]:
            more = isolated_client.get(f"/api/anatomy/{node['id']}/genes")
            if more.status_code != 200:
                continue
            extra = more.json().get("items") or []
            if extra:
                payload = more.json()
                items = extra
                break
        if not items:
            pytest.fail(
                f"{REPO_OWNER_2} has not cached any tissue-expression rows yet "
                f"(heart empty_reason={reason!r}). Caveat+tier cannot be proven on an empty panel."
            )
    for item in items:
        if item.get("evidence_kind") != "tissue-expression":
            continue
        assert item.get("interpretation_tier") == "observed-expression", (
            f"{item.get('evidence_id')} tissue-expression must be tier observed-expression, "
            f"not {item.get('interpretation_tier')!r} (expression is not causality)."
        )
        caveat = (item.get("caveat") or "").strip()
        assert caveat == EXPRESSION_CAVEAT, (
            f"Expression caveat must be the contract sentence, not a causal claim. Got: {caveat!r}"
        )
        blob = " ".join(str(item.get(k) or "") for k in ("qualitative_label", "context", "caveat", "panel_reason")).lower()
        for banned in BANNED_CAUSAL_COPY:
            assert banned not in blob, f"Banned causal copy {banned!r} in expression evidence {item.get('evidence_id')}"
    note = (payload.get("panel_note") or "").lower()
    for banned in BANNED_CAUSAL_COPY:
        assert banned not in note, f"Banned causal copy {banned!r} in panel_note"


def test_phenotype_relationships_are_never_derived_from_expression():
    registry = require_module(
        "services.runtime.anatomy.registry", REPO_OWNER_2, "services/runtime/anatomy/registry.py"
    )
    get_node = require_attr(registry, "get_node", REPO_OWNER_2, "services/runtime/anatomy/registry.py")
    heart = get_node("UBERON:0000948")
    assert heart, "Heart UBERON:0000948 missing (Agent 2)."

    from services.api.app.main import app

    client = TestClient(app)
    detail = client.get(f"/api/anatomy/{heart['id']}")
    require_status(detail, f"GET /api/anatomy/{heart['id']}", REPO_OWNER_2)
    relationships = detail.json().get("relationships") or []
    for rel in relationships:
        if rel.get("kind") not in PHENOTYPE_KINDS:
            continue
        source = (rel.get("source_id") or "").lower()
        assert source not in EXPRESSION_SOURCES, (
            f"Relationship {rel.get('kind')} {rel} is derived from expression source {source!r}. "
            "Contract: VARIANT_TRAIT_ASSOCIATION and CURATED_GENE_PHENOTYPE_RELATIONSHIP "
            "are never derived from GENE_EXPRESSED_IN."
        )


def test_empty_organ_is_honest_not_fabricated(isolated_client: TestClient):
    tree = isolated_client.get("/api/anatomy/tree")
    require_status(tree, "GET /api/anatomy/tree", REPO_OWNER_2)
    nodes = tree.json()["nodes"]
    candidates = [n for n in nodes if n.get("mesh_status") == "unavailable"] or nodes
    empty_id = None
    empty_payload = None
    for node in candidates:
        response = isolated_client.get(f"/api/anatomy/{node['id']}/genes")
        if response.status_code != 200:
            continue
        payload = response.json()
        if not payload.get("items"):
            empty_id = node["id"]
            empty_payload = payload
            break
    if empty_payload is None:
        unknown = isolated_client.get("/api/anatomy/DIAMOND:unmapped-empty-organ/genes")
        assert unknown.status_code in {200, 404}, (
            "Unknown organ must be 404 or an honest empty panel, never a fabricated gene list."
        )
        if unknown.status_code == 200:
            empty_id = "DIAMOND:unmapped-empty-organ"
            empty_payload = unknown.json()
            assert empty_payload.get("items") in {[], None}
        else:
            return
    reason = empty_payload.get("empty_reason")
    assert reason, (
        f"GET /api/anatomy/{empty_id}/genes returned items=[] without empty_reason. "
        "Empty organs must be honest, not silent, and never filled with fabricated genes."
    )
    assert empty_payload.get("items") == []
    assert not empty_payload.get("genes"), (
        f"Empty organ {empty_id} fabricated a genes[] list while items are empty."
    )
    low = str(reason).lower()
    for banned in BANNED_CAUSAL_COPY:
        assert banned not in low


def test_source_outage_is_cached_or_unavailable_never_fabricated(isolated_client: TestClient):
    tree = isolated_client.get("/api/anatomy/tree")
    require_status(tree, "GET /api/anatomy/tree", REPO_OWNER_2)
    statuses = tree.json().get("source_status") or []
    assert statuses, "GET /api/anatomy/tree missing source_status[]"
    for row in statuses:
        assert row.get("status") in {"live", "cached", "unavailable"}, (
            f"source_status.status must be live|cached|unavailable, got {row!r}"
        )
    heart = next(
        (n for n in tree.json()["nodes"] if n.get("ontology_id") == "UBERON:0000948" or "heart" in n.get("label", "").lower()),
        None,
    )
    assert heart
    genes = isolated_client.get(f"/api/anatomy/{heart['id']}/genes")
    require_status(genes, f"GET /api/anatomy/{heart['id']}/genes", REPO_OWNER_2)
    payload = genes.json()
    gene_status = {s["source_id"]: s for s in payload.get("source_status") or []}
    assert gene_status, "Gene panel missing source_status"
    for source_id, row in gene_status.items():
        if row["status"] == "unavailable":
            leaked = [
                item
                for item in payload.get("items") or []
                if item.get("source_id") == source_id
            ]
            assert leaked == [], (
                f"Source {source_id} is unavailable but the panel fabricated {len(leaked)} rows. "
                "A source that cannot answer returns unavailable and an empty list."
            )


def test_body_descriptor_never_claims_an_organ_effect(tmp_path):
    store = WorkspaceStore(path=tmp_path / "state.json")
    workspace = store.create_workspace("guardrail-body")
    from services.runtime.genome_workspace.reference import base_at

    ref = base_at(6)
    alt = "A" if ref != "A" else "T"
    proposal = store.propose(workspace["workspace_id"], 6, alt, "")
    store.commit(workspace["workspace_id"], proposal["proposal_id"], workspace["revision_counter"])
    body = store.body_descriptor(workspace["workspace_id"])
    assert body["anatomy_changed"] is False
    assert body["effect_class"] == "ILLUSTRATIVE"
    assert "do not change body geometry" in " ".join(body.get("limitations") or []).lower() or (
        "navigation" in (body.get("reason") or "").lower()
    )
