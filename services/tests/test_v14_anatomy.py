"""V14 anatomy tree, search, evidence honesty, and GRCh38 slice tests (offline)."""

from __future__ import annotations

import hashlib
from collections import defaultdict

from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.api.app.routes import anatomy as anatomy_routes
from services.runtime.anatomy import genes, loci, registry
from services.runtime.anatomy.paths import EXPRESSION_CAVEAT, SLICES_DIR
from services.runtime.anatomy.seed import HAND_L, HAND_R


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(anatomy_routes.router)
    return TestClient(app)


def test_tree_is_acyclic_and_left_right_are_distinct():
    nodes = registry.list_nodes()
    by_id = {n["id"]: n for n in nodes}
    assert len(by_id) == len(nodes)
    children = defaultdict(list)
    for node in nodes:
        for parent in node["parent_ids"]:
            children[parent].append(node["id"])
            assert parent in by_id or parent == node["id"]
    # Cycle check via Kahn / DFS colouring.
    visiting: set[str] = set()
    seen: set[str] = set()

    def walk(nid: str) -> None:
        assert nid not in visiting, nid
        if nid in seen:
            return
        visiting.add(nid)
        for child in children.get(nid, []):
            walk(child)
        visiting.remove(nid)
        seen.add(nid)

    for nid in by_id:
        walk(nid)

    left_hand = registry.get_node(HAND_L)
    right_hand = registry.get_node(HAND_R)
    assert left_hand and right_hand
    assert left_hand["id"] != right_hand["id"]
    assert left_hand["laterality"] == "left"
    assert right_hand["laterality"] == "right"
    lungs = {registry.get_node("UBERON:0002168")["id"], registry.get_node("UBERON:0002167")["id"]}
    assert lungs == {"UBERON:0002168", "UBERON:0002167"}


def test_left_hand_search_resolves_to_left_id():
    hits = registry.search("left hand", limit=8)
    assert hits
    assert all(h.get("result_type") for h in hits)
    top = next(h for h in hits if h["result_type"] == "anatomy")
    assert top["id"] == HAND_L
    assert top["laterality"] == "left"
    typo = registry.search("left han", limit=8)
    assert any(h["id"] == HAND_L for h in typo)
    assert any(h.get("corrected_from") for h in typo) or typo[0]["id"] == HAND_L


def test_resolve_text_is_laterality_aware():
    ids = registry.resolve_text("focus the left hand and the heart")
    assert HAND_L in ids
    assert "UBERON:0000948" in ids
    assert HAND_R not in ids


def test_empty_organ_has_honest_empty_reason():
    client = _client()
    # Left ear has no cached panel expression or association rows.
    resp = client.get("/api/anatomy/UBERON:0035295/genes")
    assert resp.status_code == 200
    body = resp.json()
    assert body["items"] == []
    assert body["empty_reason"]
    assert "not" in body["empty_reason"].lower() or "no panel" in body["empty_reason"].lower()
    assert any(s["source_id"] for s in body["source_status"])


def test_expression_payload_cannot_be_read_as_causality():
    client = _client()
    resp = client.get("/api/anatomy/UBERON:0000948/genes")
    assert resp.status_code == 200
    body = resp.json()
    assert body["items"], "heart should have cached expression for the panel"
    for item in body["items"]:
        if item["evidence_kind"] == "tissue-expression":
            assert item["interpretation_tier"] == "observed-expression"
            assert item["caveat"] == EXPRESSION_CAVEAT
            assert "does not show that editing" in item["caveat"]
            assert item["interpretation_tier"] not in {"curated-relationship", "statistical-association"}
    kinds = {item["evidence_kind"] for item in body["items"]}
    # Expression route default does not invent GWAS or curated phenotype.
    assert "curated-gene-phenotype" not in kinds


def test_gwas_records_include_study_context():
    client = _client()
    resp = client.get("/api/genes/ENSG00000092054/variants?assembly=GRCh38")
    assert resp.status_code == 200
    body = resp.json()
    assert body["source"] == "GWAS Catalog REST API v2"
    assert body["associations"], "MYH7 should have cached GWAS v2 associations"
    row = body["associations"][0]
    assert row["study_accession"]
    assert row["pubmed_id"]
    assert row["reported_trait"] or row["efo_traits"]
    assert row["p_value"] is not None
    assert "gwas" in {s["source_id"] for s in body["source_status"]}


def test_grch37_is_rejected():
    client = _client()
    for path in (
        "/api/genes/ENSG00000092054/annotations?assembly=GRCh37",
        "/api/genes/ENSG00000092054/variants?assembly=hg19",
        "/api/genes/MYH7/annotations?assembly=NCBI36",
    ):
        resp = client.get(path)
        assert resp.status_code == 400, path


def test_ref_window_checksum_matches_file():
    loc = next(item for item in loci.list_loci() if item["gene_symbol"] == "MYH7")
    checks = {row["locus_id"]: row for row in loci.verify_checksums()}
    assert checks[loc["locus_id"]]["ok"] is True
    seq = loci.window(loc["locus_id"], loc["start"], min(loc["end"], loc["start"] + 199))
    file_seq = []
    for line in (SLICES_DIR / loc["fasta_file"]).read_text(encoding="utf-8").splitlines():
        if line and not line.startswith(">"):
            file_seq.append(line.strip().upper())
    full = "".join(file_seq)
    assert hashlib.sha256(full.encode("ascii")).hexdigest() == loc["sequence_sha256"]
    assert seq == full[: len(seq)]
    assert loci.base_at(loc["locus_id"], loc["start"]) == full[0]


def test_loci_and_gene_contracts():
    assert loci.REFERENCE_ASSET_ID == "grch38_slices_ensembl116"
    myh7 = genes.get_gene("MYH7")
    assert myh7 and myh7["gene_id"] == "ENSG00000092054"
    assert myh7["ensembl_release"] == 116
    assert myh7["assembly"] == "GRCh38"
    assert myh7["canonical_transcript"] == "ENST00000355349.4"
    assert genes.get_gene("ENSG00000092054")["symbol"] == "MYH7"
    loc = loci.get_locus(myh7["locus_ids"][0])
    assert loc and loc["assembly"] == "GRCh38"
    assert loc["length"] <= 1000
    assert loci.locus_for_position("14", loc["start"] + 1)["gene_symbol"] == "MYH7"


def test_search_always_sets_result_type():
    client = _client()
    for q in ("heart", "MYH7", "expression", "cardiovascular", "grch38:MYH7"):
        body = client.get("/api/anatomy/search", params={"q": q}).json()
        assert body["query"] == q
        assert body["results"]
        assert all(r["result_type"] in {
            "anatomy", "system", "gene", "locus", "variant", "trait", "evidence-category"
        } for r in body["results"])


def test_tree_and_detail_routes():
    client = _client()
    tree = client.get("/api/anatomy/tree").json()
    assert tree["root_id"] == "UBERON:0013702"
    assert tree["nodes"] and tree["systems"]
    ids = {n["id"] for n in tree["nodes"]}
    assert HAND_L in ids and HAND_R in ids
    detail = client.get("/api/anatomy/UBERON:0000948").json()
    assert detail["node"]["id"] == "UBERON:0000948"
    assert detail["breadcrumb"][0]["id"] == "UBERON:0013702"
    assert any(r["kind"] == "ANATOMICAL_PART_OF" for r in detail["relationships"])
    tissues = client.get("/api/genes/ENSG00000092054/tissues").json()
    assert tissues["items"]
    assert all(i["caveat"] == EXPRESSION_CAVEAT for i in tissues["items"] if i["evidence_kind"] == "tissue-expression")
    gene = client.get("/api/genes/MYH7").json()
    assert gene["gene_id"] == "ENSG00000092054"
    window = client.get(
        f"/api/genome-edit/loci/{gene['locus_ids'][0]}/window",
        params={"start": 23412700, "end": 23412720},
    )
    assert window.status_code == 200
    assert window.json()["coordinate"] == "1-based inclusive"
    assert len(window.json()["bases"]) == 21
    too_wide = client.get(
        f"/api/genome-edit/loci/{gene['locus_ids'][0]}/window",
        params={"start": 23412700, "end": 23413200},
    )
    assert too_wide.status_code == 400
    assert client.get("/api/genome-edit/loci").json()["loci"]


def test_unavailable_source_does_not_invent_rows(monkeypatch):
    client = _client()

    def empty(_gene):
        return []

    monkeypatch.setattr("services.runtime.anatomy.evidence.gwas_associations", empty)
    monkeypatch.setattr(
        "services.runtime.anatomy.evidence.source_status_for",
        lambda *ids: [{"source_id": i, "status": "unavailable", "version": None, "retrieved_at": None} for i in ids],
    )
    body = client.get("/api/genes/MYH7/variants?assembly=GRCh38").json()
    assert body["associations"] == []
    assert body["source_status"][0]["status"] == "unavailable"
