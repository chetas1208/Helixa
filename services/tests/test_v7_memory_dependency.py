from __future__ import annotations

from services.runtime.memory import MemoryDependencyGraph


def test_memory_dependency_graph_selective_invalidation():
    graph = MemoryDependencyGraph()

    # 1. Dataset node
    graph.add_node("ds-1", "dataset", {"filename": "patient_sample.vcf", "sha256": "abc123"})
    # 2. Reference node
    graph.add_node("ref-1", "reference", {"assembly": "GRCh38", "sha256": "ref_hash_v1"})
    # 3. Validator node
    graph.add_node("val-1", "validator", {"version": "1.0.0"})

    # 4. Finding node depends on ds-1 + ref-1 + val-1
    graph.add_node(
        "finding-1",
        "finding",
        {"locus": "chr22:10001", "result": "PASS"},
        dependencies=["ds-1", "ref-1", "val-1"],
    )

    # 5. Memo node depends on finding-1
    graph.add_node(
        "memo-1",
        "memo",
        {"conclusion": "Sample matches reference at chr22:10001"},
        dependencies=["finding-1"],
    )

    # 6. Unrelated dataset & finding
    graph.add_node("ds-unrelated", "dataset", {"filename": "control.vcf", "sha256": "xyz789"})
    graph.add_node("ref-unrelated", "reference", {"assembly": "GRCh37", "sha256": "ref_37_hash"})
    graph.add_node(
        "finding-unrelated",
        "finding",
        {"locus": "chr1:5000", "result": "PASS"},
        dependencies=["ds-unrelated", "ref-unrelated"],
    )

    # Initially, all are active
    active = graph.get_active_memories()
    assert len(active) == 8

    # Invalidate ref-1 (e.g. Reference genome was discovered to be modified/corrupted)
    invalidated = graph.invalidate_node("ref-1", "Reference checksum mismatch discovered")
    assert "ref-1" in invalidated
    assert "finding-1" in invalidated
    assert "memo-1" in invalidated

    # Unrelated nodes MUST NOT be invalidated!
    assert "finding-unrelated" not in invalidated
    assert "ds-unrelated" not in invalidated

    # Check state of invalidated nodes
    finding_node = graph.get_node("finding-1")
    assert finding_node.is_stale is True
    assert "Cascaded invalidation from upstream dependency 'ref-1'" in finding_node.invalidated_reason

    # Active memories now only contains unaffected items
    active_now = graph.get_active_memories()
    active_ids = {n.node_id for n in active_now}
    assert "finding-unrelated" in active_ids
    assert "finding-1" not in active_ids
    assert "memo-1" not in active_ids
