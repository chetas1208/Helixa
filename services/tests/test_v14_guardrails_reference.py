"""V14 reference guardrails: GRCh37 rejected, REF matches pinned FASTA, slices immutable."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from services.runtime.genome_workspace.store import WorkspaceStore
from services.tests.test_v14_guardrails import (
    REPO_OWNER_2,
    REPO_OWNER_4,
    require_attr,
    require_module,
    require_status,
)


@pytest.fixture
def isolated_client(tmp_path, monkeypatch):
    monkeypatch.setenv("V10_STATE_PATH", str(tmp_path / "v14_guardrails_ref.json"))
    from services.api.app.routes import v10

    previous = v10._store
    v10._store = WorkspaceStore(path=tmp_path / "v14_guardrails_ref.json")
    try:
        from services.api.app.main import app

        yield TestClient(app)
    finally:
        v10._store = previous

REPO = Path(__file__).resolve().parents[2]
SLICES = REPO / "fixtures" / "references" / "grch38_slices"
MYH7 = "ENSG00000092054"


def _slice_checksums() -> dict[str, str]:
    if not SLICES.exists():
        pytest.fail(
            f"{REPO_OWNER_2} has not landed fixtures/references/grch38_slices/. "
            "Pinned GRCh38 FASTA immutability cannot be proven."
        )
    files = [p for p in SLICES.rglob("*") if p.is_file()]
    if not files:
        pytest.fail(f"{SLICES} exists but contains no files (Agent 2).")
    return {str(p.relative_to(SLICES)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}


def test_grch38_slices_directory_exists():
    _slice_checksums()


def test_annotations_and_variants_reject_grch37(isolated_client: TestClient):
    for path in (
        f"/api/genes/{MYH7}/annotations?assembly=GRCh37",
        f"/api/genes/{MYH7}/variants?assembly=GRCh37",
        f"/api/genes/{MYH7}/annotations?assembly=hg19",
        f"/api/genes/{MYH7}/annotations?assembly=GRCh37.p13",
    ):
        response = isolated_client.get(path)
        if response.status_code == 404:
            pytest.fail(
                f"{REPO_OWNER_2} has not landed {path.split('?')[0]} (HTTP 404). "
                "GRCh37 must be rejected with HTTP 400, not missing."
            )
        assert response.status_code == 400, (
            f"{path} must reject non-GRCh38 assemblies with HTTP 400, got {response.status_code}: "
            f"{response.text[:300]}"
        )


def test_annotations_accept_grch38_only(isolated_client: TestClient):
    response = isolated_client.get(f"/api/genes/{MYH7}/annotations?assembly=GRCh38")
    require_status(response, f"GET /api/genes/{MYH7}/annotations?assembly=GRCh38", REPO_OWNER_2)
    payload = response.json()
    gene = payload.get("gene") or {}
    assert gene.get("assembly") == "GRCh38"
    assert gene.get("ensembl_release") == 116
    for locus in payload.get("loci") or []:
        assert locus.get("assembly") == "GRCh38"
        assert "GRCh37" not in (locus.get("locus_id") or "")
        assert "hg19" not in (locus.get("locus_id") or "")


def test_loci_module_ref_matches_pinned_fasta():
    loci = require_module("services.runtime.anatomy.loci", REPO_OWNER_2, "services/runtime/anatomy/loci.py")
    list_loci = require_attr(loci, "list_loci", REPO_OWNER_2, "services/runtime/anatomy/loci.py")
    base_at = require_attr(loci, "base_at", REPO_OWNER_2, "services/runtime/anatomy/loci.py")
    verify_checksums = require_attr(loci, "verify_checksums", REPO_OWNER_2, "services/runtime/anatomy/loci.py")
    asset = require_attr(loci, "REFERENCE_ASSET_ID", REPO_OWNER_2, "services/runtime/anatomy/loci.py")
    assert asset == "grch38_slices_ensembl116"

    listed = list_loci()
    assert listed, f"{REPO_OWNER_2} list_loci() is empty — no pinned GRCh38 slices."
    checks = verify_checksums()
    assert checks, "verify_checksums() returned no rows."
    failed = [row for row in checks if not row.get("ok")]
    assert failed == [], f"Pinned FASTA checksum mismatch: {failed}"

    locus = listed[0]
    position = int(locus["start"])
    observed = base_at(locus["locus_id"], position)
    assert observed in {"A", "C", "G", "T", "N"}
    window_fn = require_attr(loci, "window", REPO_OWNER_2, "services/runtime/anatomy/loci.py")
    bases = window_fn(locus["locus_id"], position, position)
    assert bases == observed


def test_wrong_stated_ref_is_needs_clarification_not_an_edit(isolated_client: TestClient):
    loci = require_module("services.runtime.anatomy.loci", REPO_OWNER_2, "services/runtime/anatomy/loci.py")
    list_loci = require_attr(loci, "list_loci", REPO_OWNER_2, "services/runtime/anatomy/loci.py")
    base_at = require_attr(loci, "base_at", REPO_OWNER_2, "services/runtime/anatomy/loci.py")
    listed = list_loci()
    assert listed, "No pinned loci (Agent 2)."
    locus = listed[0]
    position = int(locus["start"])
    actual = base_at(locus["locus_id"], position)
    wrong = "A" if actual != "A" else "C"
    response = isolated_client.post(
        "/api/genome-edit/interpret-command",
        json={
            "text": f"change {locus['contig']}:{position} from {wrong} to T",
            "source": "text",
        },
    )
    require_status(response, "POST /api/genome-edit/interpret-command", REPO_OWNER_4)
    payload = response.json()
    assert payload.get("intent") == "NEEDS_CLARIFICATION", (
        f"Stated REF {wrong} disagrees with pinned {actual}; intent must be NEEDS_CLARIFICATION, "
        f"got {payload.get('intent')!r}."
    )
    assert payload.get("intent") != "PRECISE_EDIT"
    reason = (payload.get("reason") or "") + " " + str(payload.get("edit") or "")
    assert actual in reason or (payload.get("edit") or {}).get("actual_ref") == actual, (
        f"NEEDS_CLARIFICATION must name the pinned base {actual}, got {payload!r}"
    )


def test_proposal_ref_check_uses_pinned_fasta(isolated_client: TestClient):
    loci = require_module("services.runtime.anatomy.loci", REPO_OWNER_2, "services/runtime/anatomy/loci.py")
    list_loci = require_attr(loci, "list_loci", REPO_OWNER_2, "services/runtime/anatomy/loci.py")
    base_at = require_attr(loci, "base_at", REPO_OWNER_2, "services/runtime/anatomy/loci.py")
    listed = list_loci()
    assert listed, "No pinned loci (Agent 2)."
    locus = listed[0]
    position = int(locus["start"])
    actual = base_at(locus["locus_id"], position)
    alt = "A" if actual != "A" else "G"

    ws = isolated_client.post("/api/v10/genome/workspaces", json={"name": "v14-ref-check"})
    require_status(ws, "POST /api/v10/genome/workspaces", REPO_OWNER_4)
    workspace = ws.json()

    created = isolated_client.post(
        "/api/genome-edit/proposals",
        json={
            "workspace_id": workspace["workspace_id"],
            "parent_revision_id": workspace["active_genome_revision_id"],
            "locus_id": locus["locus_id"],
            "reference_asset_id": "grch38_slices_ensembl116",
            "position": position,
            "alt": alt,
            "source": "text",
        },
    )
    require_status(
        created,
        "POST /api/genome-edit/proposals",
        REPO_OWNER_4,
        ok=(200, 201),
    )
    proposal = created.json()
    assert proposal.get("reference_allele") == actual
    validated = isolated_client.post(f"/api/genome-edit/proposals/{proposal['proposal_id']}/validate")
    require_status(validated, "POST /api/genome-edit/proposals/{id}/validate", REPO_OWNER_4)
    checks = {c["check"]: c for c in validated.json().get("checks") or []}
    assert "ref_matches_pinned_reference" in checks, (
        "Validation must include check ref_matches_pinned_reference."
    )
    assert checks["ref_matches_pinned_reference"]["passed"] is True


def test_baseline_fasta_is_immutable_after_an_edit(isolated_client: TestClient):
    before = _slice_checksums()
    loci = require_module("services.runtime.anatomy.loci", REPO_OWNER_2, "services/runtime/anatomy/loci.py")
    list_loci = require_attr(loci, "list_loci", REPO_OWNER_2, "services/runtime/anatomy/loci.py")
    base_at = require_attr(loci, "base_at", REPO_OWNER_2, "services/runtime/anatomy/loci.py")
    verify_checksums = require_attr(loci, "verify_checksums", REPO_OWNER_2, "services/runtime/anatomy/loci.py")
    listed = list_loci()
    locus = listed[0]
    position = int(locus["start"])
    actual = base_at(locus["locus_id"], position)
    alt = "C" if actual != "C" else "G"

    ws = isolated_client.post("/api/v10/genome/workspaces", json={"name": "v14-fasta-immut"})
    require_status(ws, "POST /api/v10/genome/workspaces", REPO_OWNER_4)
    workspace = ws.json()
    created = isolated_client.post(
        "/api/genome-edit/proposals",
        json={
            "workspace_id": workspace["workspace_id"],
            "parent_revision_id": workspace["active_genome_revision_id"],
            "locus_id": locus["locus_id"],
            "reference_asset_id": "grch38_slices_ensembl116",
            "position": position,
            "alt": alt,
            "source": "manual",
        },
    )
    if created.status_code < 400:
        proposal = created.json()
        isolated_client.post(f"/api/genome-edit/proposals/{proposal['proposal_id']}/validate")
        isolated_client.post(
            f"/api/genome-edit/proposals/{proposal['proposal_id']}/apply",
            json={"expected_counter": workspace["revision_counter"]},
            headers={"Idempotency-Key": "v14-fasta-immut-1"},
        )

    after = _slice_checksums()
    assert before == after, (
        "Pinned GRCh38 slice files changed after an edit. "
        "Reverting or applying an edit creates a revision; it never rewrites a slice."
    )
    failed = [row for row in verify_checksums() if not row.get("ok")]
    assert failed == [], f"verify_checksums failed after edit: {failed}"
    assert base_at(locus["locus_id"], position) == actual, (
        "base_at() must still return the pinned reference allele after a workspace edit."
    )


def test_synthetic_chr22_is_never_labelled_grch38():
    from services.runtime.genome_workspace import reference

    assert reference.ASSEMBLY != "GRCh38"
    assert reference.ASSEMBLY != "GRCh37"
    assert reference.ASSET_ID == "ref_synthetic_chr22"
    assert re.search(r"not (an official )?GRCh38", reference.LICENSE_NOTE, re.I)
    assert reference.REFERENCE_PATH.name == "ref_synthetic_chr22.fasta"
    original = hashlib.sha256(reference.REFERENCE_PATH.read_bytes()).hexdigest()
    _ = reference.sequence()
    _ = reference.base_at(1)
    assert hashlib.sha256(reference.REFERENCE_PATH.read_bytes()).hexdigest() == original
