from __future__ import annotations

import hashlib
from typing import Any

from services.runtime.capabilities.macro_schema import DeclarativeMacro, MacroStep


class TrajectoryMiner:
    """
    Mines reusable declarative workflows from verified successful trajectories.
    Converts repetitive validation patterns into safe, typed macro candidates.
    """

    @staticmethod
    def mine_from_events(events: list[dict[str, Any]]) -> DeclarativeMacro | None:
        tool_invocations: list[str] = []
        for evt in events:
            if evt.get("event_type") == "tool.invocation":
                tool = evt.get("payload", {}).get("tool_name")
                if tool:
                    tool_invocations.append(tool)

        if len(tool_invocations) < 2:
            return None

        # Build steps
        steps: list[MacroStep] = []
        primitives: list[str] = []
        for idx, tool in enumerate(tool_invocations):
            steps.append(
                MacroStep(
                    step_id=f"step_{idx + 1}_{tool}",
                    primitive_tool_id=tool,
                    argument_mapping={"dataset_id": "input.dataset_id"},
                    output_key=f"out_{tool}",
                )
            )
            if tool not in primitives:
                primitives.append(tool)

        pattern_id = hashlib.sha256("-".join(tool_invocations).encode("utf-8")).hexdigest()[:8]
        return DeclarativeMacro(
            macro_id=f"macro-mined-{pattern_id}",
            name=f"Automated Sequence ({len(tool_invocations)} steps)",
            description=f"Mined workflow executing: {' -> '.join(tool_invocations)}",
            steps=steps,
            required_primitives=primitives,
        )
