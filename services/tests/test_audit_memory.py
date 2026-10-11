from __future__ import annotations

from services.runtime.memory import MemoryDependencyGraph


def test_invalidate_cycle_terminates():
    graph = MemoryDependencyGraph()
    graph.add_node("a", "finding", {}, dependencies=["b"])
    graph.add_node("b", "finding", {}, dependencies=["a"])

    invalidated = graph.invalidate_node("a", "root cause")

    assert sorted(invalidated) == ["a", "b"]
    assert graph.get_node("a").invalidated_reason == "root cause"
    assert graph.get_node("b").is_stale is True


def test_invalidate_self_dependency_terminates():
    graph = MemoryDependencyGraph()
    graph.add_node("a", "finding", {}, dependencies=["a"])

    assert graph.invalidate_node("a", "why") == ["a"]


def test_invalidate_deep_chain_does_not_overflow_stack():
    graph = MemoryDependencyGraph()
    graph.add_node("n0", "dataset", {})
    depth = 1500
    for i in range(1, depth):
        graph.add_node(f"n{i}", "finding", {}, dependencies=[f"n{i - 1}"])

    invalidated = graph.invalidate_node("n0", "r")

    assert len(invalidated) == depth
    assert invalidated[0] == "n0"
    assert invalidated[-1] == f"n{depth - 1}"
    assert graph.get_active_memories() == []


def test_invalidate_diamond_order_and_reasons_preserved():
    graph = MemoryDependencyGraph()
    graph.add_node("root", "reference", {})
    graph.add_node("b", "finding", {}, dependencies=["root"])
    graph.add_node("c", "finding", {}, dependencies=["root"])
    graph.add_node("d", "memo", {}, dependencies=["b", "c"])

    assert graph.invalidate_node("root", "r") == ["root", "b", "d", "c"]
    assert graph.get_node("b").invalidated_reason == (
        "Cascaded invalidation from upstream dependency 'root': r"
    )
    assert graph.get_node("d").invalidated_reason == (
        "Cascaded invalidation from upstream dependency 'b': "
        "Cascaded invalidation from upstream dependency 'root': r"
    )


def test_invalidate_already_stale_node_keeps_reason_and_reaches_new_children():
    graph = MemoryDependencyGraph()
    graph.add_node("p", "reference", {})
    graph.invalidate_node("p", "first")
    graph.add_node("c", "finding", {}, dependencies=["p"])

    assert graph.invalidate_node("p", "second") == ["c"]
    assert graph.get_node("p").invalidated_reason == "first"


def test_invalidate_unknown_node_returns_empty():
    graph = MemoryDependencyGraph()
    graph.add_node("c", "finding", {}, dependencies=["ghost"])

    assert graph.invalidate_node("ghost", "r") == []
    assert graph.get_node("c").is_stale is False


def test_readding_node_drops_edges_to_old_dependencies():
    graph = MemoryDependencyGraph()
    graph.add_node("p1", "reference", {})
    graph.add_node("p2", "reference", {})
    graph.add_node("c", "finding", {}, dependencies=["p1"])
    graph.add_node("c", "finding", {}, dependencies=["p2"])

    assert graph.invalidate_node("p1", "r") == ["p1"]
    assert graph.get_node("c").is_stale is False
    assert graph.invalidate_node("p2", "r") == ["p2", "c"]


def test_node_dependencies_not_aliased_to_caller_list():
    graph = MemoryDependencyGraph()
    graph.add_node("p", "reference", {})
    deps = ["p"]
    node = graph.add_node("c", "finding", {}, dependencies=deps)
    deps.append("other")

    assert node.dependencies == ["p"]


def test_get_active_memories_filters_by_type():
    graph = MemoryDependencyGraph()
    graph.add_node("d", "dataset", {})
    graph.add_node("f", "finding", {}, dependencies=["d"])

    assert [n.node_id for n in graph.get_active_memories("finding")] == ["f"]
    graph.invalidate_node("d", "r")
    assert graph.get_active_memories() == []
