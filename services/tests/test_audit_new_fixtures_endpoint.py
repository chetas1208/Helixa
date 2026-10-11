from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.api.app.routes import fixtures as fixtures_route
from services.api.app.routes.fixtures import router
from services.api.app.routes.validation import resolve_fixture_path

REPO_ROOT = Path(__file__).resolve().parents[2]
CATEGORIES = {"invalid", "valid", "heldout", "incident", "other"}


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _by_name(payload: dict) -> dict[str, dict]:
    return {f["name"]: f for f in payload["fixtures"]}


def _make_tree(root: Path) -> None:
    for rel in (
        "valid/a_valid.vcf",
        "invalid/ref_mismatch.vcf",
        "invalid/b_bad.vcf",
        "invalid/trunc.vcf.gz",
        "heldout/h_one.vcf",
        "v7/cases/01_ok.vcf",
        "v7/cases/02_sealed.vcf",
        "stray.vcf",
    ):
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("##fileformat=VCFv4.2\n")
    (root / "references").mkdir()
    (root / "references" / "ref.fasta").write_text(">chr22\nA\n")
    (root / "valid" / "notes.txt").write_text("x")
    (root / "valid" / "upper.VCF.bak").write_text("x")
    manifest = root / "v7" / "manifests" / "sealed_holdout_manifest.json"
    manifest.parent.mkdir(parents=True)
    manifest.write_text(json.dumps([{"case_id": "02_sealed", "filename": "02_sealed.vcf", "sha256": "0" * 64}]))


def test_real_fixtures_listed_and_resolvable(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.chdir(REPO_ROOT)
    resp = client.get("/api/fixtures")
    assert resp.status_code == 200
    payload = resp.json()
    assert set(payload) == {"fixtures"}
    fixtures = payload["fixtures"]
    assert fixtures
    names = [f["name"] for f in fixtures]
    assert len(names) == len(set(names))
    for f in fixtures:
        assert set(f) == {"name", "category", "description"}
        assert f["category"] in CATEGORIES
        assert isinstance(f["description"], str) and f["description"]
        assert "/" not in f["name"] and "\\" not in f["name"]
        assert f["name"].endswith((".vcf", ".vcf.gz"))
        assert resolve_fixture_path(f["name"]).is_file()
    by_name = _by_name(payload)
    assert by_name["ref_mismatch.vcf"]["category"] == "incident"
    assert by_name["valid_snvs.vcf"]["category"] == "valid"
    assert by_name["absent_assembly.vcf"]["category"] == "invalid"
    assert by_name["unseen_mismatch.vcf"]["category"] == "heldout"
    assert by_name["heldout_contig_mismatch.vcf"]["category"] == "heldout"
    assert by_name["13_stale_reference.vcf"]["category"] == "heldout"
    assert by_name["16_second_family_failure.vcf"]["category"] == "heldout"
    assert by_name["01_correct_snv.vcf"]["category"] == "other"
    assert "truncated.vcf.gz" in by_name


def test_deterministic_order(client: TestClient):
    first = client.get("/api/fixtures").json()
    second = client.get("/api/fixtures").json()
    assert first == second


def test_heldout_descriptions_do_not_leak_outcomes(client: TestClient):
    for f in client.get("/api/fixtures").json()["fixtures"]:
        if f["category"] == "heldout":
            assert f["description"] == "Held-out transfer fixture"


def test_synthetic_tree_filtering_and_categories(tmp_path: Path, client: TestClient, monkeypatch: pytest.MonkeyPatch):
    root = tmp_path / "fixtures"
    _make_tree(root)
    monkeypatch.setattr(fixtures_route, "FIXTURES_ROOT", root)
    payload = client.get("/api/fixtures").json()
    by_name = _by_name(payload)
    assert set(by_name) == {
        "a_valid.vcf",
        "ref_mismatch.vcf",
        "b_bad.vcf",
        "trunc.vcf.gz",
        "h_one.vcf",
        "01_ok.vcf",
        "02_sealed.vcf",
        "stray.vcf",
    }
    assert by_name["a_valid.vcf"]["category"] == "valid"
    assert by_name["ref_mismatch.vcf"]["category"] == "incident"
    assert by_name["b_bad.vcf"]["category"] == "invalid"
    assert by_name["trunc.vcf.gz"]["category"] == "invalid"
    assert by_name["h_one.vcf"]["category"] == "heldout"
    assert by_name["01_ok.vcf"]["category"] == "other"
    assert by_name["02_sealed.vcf"]["category"] == "heldout"
    assert by_name["stray.vcf"]["category"] == "other"
    assert by_name["02_sealed.vcf"]["description"] == "Held-out transfer fixture"
    assert [f["name"] for f in payload["fixtures"]] == [
        "h_one.vcf",
        "b_bad.vcf",
        "ref_mismatch.vcf",
        "trunc.vcf.gz",
        "stray.vcf",
        "01_ok.vcf",
        "02_sealed.vcf",
        "a_valid.vcf",
    ]


def test_missing_root_returns_empty(tmp_path: Path, client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(fixtures_route, "FIXTURES_ROOT", tmp_path / "nope")
    assert client.get("/api/fixtures").json() == {"fixtures": []}


def test_symlinks_are_not_followed(tmp_path: Path, client: TestClient, monkeypatch: pytest.MonkeyPatch):
    root = tmp_path / "fixtures"
    (root / "valid").mkdir(parents=True)
    (root / "valid" / "real.vcf").write_text("x")
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.vcf").write_text("x")
    os.symlink(outside / "secret.vcf", root / "valid" / "link_file.vcf")
    os.symlink(outside, root / "linked_dir")
    monkeypatch.setattr(fixtures_route, "FIXTURES_ROOT", root)
    assert [f["name"] for f in client.get("/api/fixtures").json()["fixtures"]] == ["real.vcf"]


def test_duplicate_basename_listed_once_with_resolver_priority(
    tmp_path: Path, client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    root = tmp_path / "fixtures"
    for rel in ("invalid/dup.vcf", "valid/dup.vcf", "extra/dup.vcf"):
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text("x")
    monkeypatch.setattr(fixtures_route, "FIXTURES_ROOT", root)
    fixtures = client.get("/api/fixtures").json()["fixtures"]
    assert [(f["name"], f["category"]) for f in fixtures] == [("dup.vcf", "valid")]


def test_glob_metacharacter_names_skipped(tmp_path: Path, client: TestClient, monkeypatch: pytest.MonkeyPatch):
    root = tmp_path / "fixtures"
    (root / "valid").mkdir(parents=True)
    (root / "valid" / "ok.vcf").write_text("x")
    (root / "valid" / "we[ird].vcf").write_text("x")
    monkeypatch.setattr(fixtures_route, "FIXTURES_ROOT", root)
    assert [f["name"] for f in client.get("/api/fixtures").json()["fixtures"]] == ["ok.vcf"]


@pytest.mark.parametrize("content", ["not json", '{"a": 1}', '[{"filename": 3}]', "[1]"])
def test_untrusted_sealed_manifest_hides_v7_cases(
    tmp_path: Path, client: TestClient, monkeypatch: pytest.MonkeyPatch, content: str
):
    root = tmp_path / "fixtures"
    _make_tree(root)
    (root / "v7" / "manifests" / "sealed_holdout_manifest.json").write_text(content)
    monkeypatch.setattr(fixtures_route, "FIXTURES_ROOT", root)
    names = {f["name"] for f in client.get("/api/fixtures").json()["fixtures"]}
    assert "02_sealed.vcf" not in names and "01_ok.vcf" not in names
    assert "a_valid.vcf" in names


def test_missing_sealed_manifest_hides_v7_cases(tmp_path: Path, client: TestClient, monkeypatch: pytest.MonkeyPatch):
    root = tmp_path / "fixtures"
    _make_tree(root)
    (root / "v7" / "manifests" / "sealed_holdout_manifest.json").unlink()
    monkeypatch.setattr(fixtures_route, "FIXTURES_ROOT", root)
    names = {f["name"] for f in client.get("/api/fixtures").json()["fixtures"]}
    assert "02_sealed.vcf" not in names and "01_ok.vcf" not in names


def test_no_query_parameter_can_alter_listing(client: TestClient):
    base = client.get("/api/fixtures").json()
    assert client.get("/api/fixtures", params={"path": "../../etc", "root": "/"}).json() == base
    assert client.post("/api/fixtures").status_code == 405
