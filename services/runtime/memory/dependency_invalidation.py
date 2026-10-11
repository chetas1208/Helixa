from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass
class MemoryNode:
    node_id: str
    node_type: str  # dataset, reference, annotation, validator, harness, finding, evaluation, memo
    payload: dict[str, Any]
    dependencies: list[str] = field(default_factory=list)  # parent node IDs
    is_stale: bool = False
    invalidated_reason: str | None = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class MemoryDependencyGraph:
    """
    Provenance-backed scientific memory dependency graph (Amelia/Substrate-inspired).
    Enforces selective downstream invalidation when reference checksums or
    validator versions change, preventing superseded assumptions from
    silently corrupting future agent reasoning.
    """

    def __init__(self):
        self._nodes: dict[str, MemoryNode] = {}
        # Mapping from parent_id -> list of dependent child_ids
        self._dependents: dict[str, list[str]] = {}

    def add_node(
        self,
        node_id: str,
        node_type: str,
        payload: dict[str, Any],
        dependencies: list[str] | None = None,
    ) -> MemoryNode:
        deps = list(dependencies or [])
        previous = self._nodes.get(node_id)
        if previous is not None:
            for old_dep in previous.dependencies:
                children = self._dependents.get(old_dep)
                if children:
                    self._dependents[old_dep] = [c for c in children if c != node_id]
        node = MemoryNode(
            node_id=node_id,
            node_type=node_type,
            payload=payload,
            dependencies=deps,
        )
        self._nodes[node_id] = node

        for dep in deps:
            if dep not in self._dependents:
                self._dependents[dep] = []
            self._dependents[dep].append(node_id)

        return node

    def get_node(self, node_id: str) -> MemoryNode | None:
        return self._nodes.get(node_id)

    def invalidate_node(self, node_id: str, reason: str) -> list[str]:
        """
        Invalidates a node and cascades invalidation to all downstream dependents.
        Returns list of newly invalidated node IDs.
        """
        invalidated_ids: list[str] = []
        visited: set[str] = set()
        stack: list[tuple[str, str]] = [(node_id, reason)]

        while stack:
            curr_id, cascade_reason = stack.pop()
            if curr_id in visited:
                continue
            visited.add(curr_id)
            node = self._nodes.get(curr_id)
            if not node:
                continue
            if not node.is_stale:
                node.is_stale = True
                node.invalidated_reason = cascade_reason
                invalidated_ids.append(curr_id)

            # Cascade to children (reversed so pops preserve declaration order)
            child_reason = (
                f"Cascaded invalidation from upstream dependency '{curr_id}': {cascade_reason}"
            )
            for child_id in reversed(self._dependents.get(curr_id, [])):
                stack.append((child_id, child_reason))

        return invalidated_ids

    def get_active_memories(self, node_type: str | None = None) -> list[MemoryNode]:
        nodes = [n for n in self._nodes.values() if not n.is_stale]
        if node_type:
            nodes = [n for n in nodes if n.node_type == node_type]
        return nodes
