from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class CapabilityKind(str, Enum):
    PRIMITIVE = "primitive"
    DECLARATIVE_MACRO = "declarative_macro"


class CapabilityStatus(str, Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    QUARANTINED = "quarantined"
    RETIRED = "retired"


class MacroGuard(BaseModel):
    condition_key: str
    operator: str = "equals"  # equals, not_equals, exists, is_true
    expected_value: Any = True
    on_violation: str = "abort"  # abort, warn


class MacroStep(BaseModel):
    step_id: str
    primitive_tool_id: str
    argument_mapping: dict[str, str] = Field(default_factory=dict)
    output_key: str = "step_result"
    guards: list[MacroGuard] = Field(default_factory=list)


class DeclarativeMacro(BaseModel):
    macro_id: str
    name: str
    description: str
    version: str = "1.0.0"
    steps: list[MacroStep] = Field(default_factory=list)
    required_primitives: list[str] = Field(default_factory=list)

    def validate_no_unsafe_constructs(self) -> tuple[bool, str]:
        # Strict security validation: ensure no executable code or shell injection
        forbidden_substrings = ["exec", "eval", "__import__", "os.system", "subprocess", "sh", "bash"]
        for step in self.steps:
            for k, v in step.argument_mapping.items():
                for bad in forbidden_substrings:
                    if bad in k.lower() or bad in str(v).lower():
                        return False, f"Forbidden unsafe instruction in argument mapping: {bad}"
        return True, "Macro complies with declarative safety standards."


class CapabilityRecord(BaseModel):
    capability_id: str
    kind: CapabilityKind
    name: str
    description: str
    status: CapabilityStatus = CapabilityStatus.DRAFT
    fitness_score: float = 1.0
    total_executions: int = 0
    failed_executions: int = 0
    macro_spec: DeclarativeMacro | None = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
