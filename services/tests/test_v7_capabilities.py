from __future__ import annotations

import pytest

from services.runtime.capabilities import (
    CapabilityKind,
    CapabilityRegistry,
    CapabilityStatus,
    DeclarativeMacro,
    FitnessTracker,
    InvalidMacroError,
    MacroStep,
    TrajectoryMiner,
    UnauthorizedPrimitiveError,
)


@pytest.mark.asyncio
async def test_capability_registry_and_safe_macro():
    registry = CapabilityRegistry()

    # Verify built-in primitives are registered as ACTIVE
    primitives = await registry.list_capabilities(status=CapabilityStatus.ACTIVE)
    assert len(primitives) >= 8
    assert any(p.capability_id == "run_validation" for p in primitives)

    # Valid declarative macro using only whitelisted tools
    macro = DeclarativeMacro(
        macro_id="macro-genomics-standard",
        name="Standard Validation Workflow",
        description="Inspects reference, inspects VCF, runs validation.",
        steps=[
            MacroStep(step_id="step1", primitive_tool_id="inspect_reference"),
            MacroStep(step_id="step2", primitive_tool_id="inspect_vcf"),
            MacroStep(step_id="step3", primitive_tool_id="run_validation"),
        ],
        required_primitives=["inspect_reference", "inspect_vcf", "run_validation"],
    )

    record = await registry.register_macro(macro)
    assert record.status == CapabilityStatus.DRAFT
    assert record.kind == CapabilityKind.DECLARATIVE_MACRO

    # Activate
    activated = await registry.activate_capability(record.capability_id)
    assert activated.status == CapabilityStatus.ACTIVE


@pytest.mark.asyncio
async def test_capability_registry_rejects_unsafe_code():
    registry = CapabilityRegistry()

    # Reject macro attempting unsafe injection
    unsafe_macro = DeclarativeMacro(
        macro_id="macro-unsafe-eval",
        name="Hostile Injection",
        description="Attempts code execution",
        steps=[
            MacroStep(
                step_id="step1",
                primitive_tool_id="inspect_vcf",
                argument_mapping={"bad": "exec('import os; os.system(\"rm -rf /\")')"},
            )
        ],
        required_primitives=["inspect_vcf"],
    )

    with pytest.raises(InvalidMacroError):
        await registry.register_macro(unsafe_macro)


@pytest.mark.asyncio
async def test_capability_registry_rejects_unauthorized_primitive():
    registry = CapabilityRegistry()

    # Reject macro referencing tool outside PolicyEnvelope whitelist
    unauthorized_macro = DeclarativeMacro(
        macro_id="macro-arbitrary-shell",
        name="Shell Runner",
        description="Attempts unauthorized shell invocation",
        steps=[
            MacroStep(step_id="step1", primitive_tool_id="unauthorized_bash_runner")
        ],
        required_primitives=["unauthorized_bash_runner"],
    )

    with pytest.raises(UnauthorizedPrimitiveError):
        await registry.register_macro(unauthorized_macro)


@pytest.mark.asyncio
async def test_trajectory_miner_and_fitness_tracker():
    events = [
        {"event_type": "tool.invocation", "payload": {"tool_name": "inspect_reference"}},
        {"event_type": "tool.invocation", "payload": {"tool_name": "inspect_vcf"}},
        {"event_type": "tool.invocation", "payload": {"tool_name": "run_validation"}},
    ]

    mined = TrajectoryMiner.mine_from_events(events)
    assert mined is not None
    assert len(mined.steps) == 3
    assert mined.required_primitives == ["inspect_reference", "inspect_vcf", "run_validation"]

    # Register mined macro
    registry = CapabilityRegistry()
    rec = await registry.register_macro(mined)
    await registry.activate_capability(rec.capability_id)

    # Fitness tracking and auto-quarantine test
    tracker = FitnessTracker(registry, quarantine_failure_threshold=2)
    # Success execution
    rec = await tracker.record_execution(rec.capability_id, success=True)
    assert rec.fitness_score == 1.0

    # Failure 1
    rec = await tracker.record_execution(rec.capability_id, success=False)
    assert rec.fitness_score == 0.5
    assert rec.status == CapabilityStatus.ACTIVE

    # Failure 2 (hits threshold 2)
    rec = await tracker.record_execution(rec.capability_id, success=False)
    assert rec.status == CapabilityStatus.QUARANTINED
