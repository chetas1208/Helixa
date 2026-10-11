"""V14 lineage guardrails: genome revision lineage is not harness lineage."""

from __future__ import annotations

from services.runtime.genome_workspace.reference import base_at
from services.runtime.genome_workspace.store import WorkspaceStore


def test_genome_lineage_is_not_harness_lineage(tmp_path):
    store = WorkspaceStore(path=tmp_path / "state.json")
    workspace = store.create_workspace("v14-lineage")
    ref = base_at(8)
    alt = "G" if ref != "G" else "C"
    proposal = store.propose(workspace["workspace_id"], 8, alt, "")
    edited = store.commit(workspace["workspace_id"], proposal["proposal_id"], workspace["revision_counter"])

    genome = store.genome_lineage(edited["workspace_id"])
    harness = store.harness_lineage(edited["workspace_id"])
    assert genome["kind"] == "GENOME_REVISION"
    assert harness["kind"] == "ANALYSIS_HARNESS"
    assert harness["distinct_from_genome"] is True
    genome_ids = {node["genome_revision_id"] for node in genome["nodes"]}
    harness_ids = {node["harness_version_id"] for node in harness["nodes"]}
    assert genome_ids.isdisjoint(harness_ids), (
        "A genome revision id must never appear as a harness version id."
    )
    assert edited["active_genome_revision_id"] in genome_ids
    assert edited["active_harness_version_id"] in harness_ids
    assert edited["active_genome_revision_id"] != edited["active_harness_version_id"]


def test_genome_lineage_carries_edits_summary_when_present(tmp_path):
    store = WorkspaceStore(path=tmp_path / "state.json")
    workspace = store.create_workspace("v14-summary")
    ref = base_at(3)
    alt = "A" if ref != "A" else "T"
    proposal = store.propose(workspace["workspace_id"], 3, alt, "")
    edited = store.commit(workspace["workspace_id"], proposal["proposal_id"], workspace["revision_counter"])
    genome = store.genome_lineage(edited["workspace_id"])
    nodes_with_edits = [n for n in genome["nodes"] if n.get("edit_count", 0) > 0]
    assert nodes_with_edits, "Committed edit missing from genome lineage."
    # Agent 4 must add edits_summary[] (gene symbol, locus, position, ref, alt, anatomy ids).
    # Until that lands this fails on purpose — harness lineage stays summary-free.
    summaries = [n.get("edits_summary") for n in nodes_with_edits]
    assert any(summaries), (
        "V14 Agent 4 has not landed genome_lineage.edits_summary[]. "
        "Evolution must show gene/locus/anatomy on genome nodes; harness lineage stays unchanged."
    )
    harness = store.harness_lineage(edited["workspace_id"])
    assert all("edits_summary" not in node for node in harness["nodes"])
