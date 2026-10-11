# Audit: memory (services/runtime/memory/*)

## FIXED
1. `dependency_invalidation.py` `invalidate_node` (recursive `_cascade`): no cycle guard and recursion depth bound by Python stack. A cyclic dependency (`a -> b -> a`, or a self-dependency) or a dependency chain deeper than ~1000 raised `RecursionError`, leaving the graph partially invalidated. Tests: `test_invalidate_cycle_terminates`, `test_invalidate_self_dependency_terminates`, `test_invalidate_deep_chain_does_not_overflow_stack`. Fix: iterative DFS with a visited set; pre-order, returned IDs, and per-path cascade reason strings are unchanged (locked by `test_invalidate_diamond_order_and_reasons_preserved`, `test_invalidate_already_stale_node_keeps_reason_and_reaches_new_children`, and the existing `test_v7_memory_dependency.py`).
2. `dependency_invalidation.py` `add_node`: re-adding an existing `node_id` with different dependencies left the old reverse edges in `_dependents`, so invalidating a former parent still (wrongly) invalidated the node, violating selective invalidation (V7-ADR-004). Test: `test_readding_node_drops_edges_to_old_dependencies`. Fix: remove the node from its previous parents' dependent lists before re-registering.
3. `dependency_invalidation.py` `add_node`: `node.dependencies` aliased the caller's list, so later caller mutation made the node's recorded dependencies diverge from the `_dependents` edge index. Test: `test_node_dependencies_not_aliased_to_caller_list`. Fix: copy the list.

## UNVERIFIED/NEEDS OTHER OWNER
- `dependency_invalidation.py:add_node`: a node added with a dependency that is already stale is created active (`is_stale=False`). May be intended (stale-ness is only set by `invalidate_node`); changing it is a behavior decision, so left as is.
- `dependency_invalidation.py:invalidate_node`: invalidating an ID that is not a registered node returns `[]` and does not cascade to nodes that declared it as a dependency (forward/dangling references). Locked by `test_invalidate_unknown_node_returns_empty` as current behavior; unclear whether intended.
- `add_node` replacing an existing stale node resets it to active (fresh `MemoryNode`); treated as an explicit replacement, not changed.
- Cascade reason strings nest the full upstream reason at each level, so memory is O(depth^2) for very deep chains. This is the existing documented format (tests assert on prefixes), so not changed.
- `get_active_memories`: `if node_type:` treats an empty string as "no filter". Not changed.
- `MemoryDependencyGraph` is in-memory only and not thread-safe; no module outside tests uses it (grep of `runtime.memory`), so no concurrency exposure was demonstrated.
- `MemoryNode.created_at` uses wall-clock time (non-deterministic by design, informational).

## VERIFIED OK
- Selective cascade to descendants only; unrelated branches untouched (existing V7 test).
- Diamond/multi-parent graphs: each node invalidated once, first-reached reason retained.
- Re-invalidating a stale node keeps its original reason, still reaches newly attached active children.
- `get_active_memories` filtering by type and staleness.
- `__init__.py` exports match the module contents.
