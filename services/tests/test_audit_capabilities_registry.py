from __future__ import annotations

import os
import uuid

import pytest
from pymongo import AsyncMongoClient

from services.runtime.capabilities import (
    CapabilityKind,
    CapabilityRegistry,
    CapabilityStatus,
    DeclarativeMacro,
    FitnessTracker,
    InvalidMacroError,
    MacroStep,
    TrajectoryMiner,
)

MONGO_URI = os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017")


@pytest.fixture
async def collection():
    client = AsyncMongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
    db = client[os.getenv("MONGODB_DATABASE", "diamond_audit_capabilities_registry")]
    col = db[f"capabilities_{uuid.uuid4().hex}"]
    try:
        yield col
    finally:
        await col.drop()
        await client.close()


def _macro(macro_id: str = "macro-audit", tools: tuple[str, ...] = ("inspect_vcf", "run_validation")):
    return DeclarativeMacro(
        macro_id=macro_id,
        name="Audit macro",
        description="audit",
        steps=[MacroStep(step_id=f"s{i}", primitive_tool_id=t) for i, t in enumerate(tools)],
        required_primitives=list(tools),
    )


# --- registry: primitives are immutable -------------------------------------------------


async def test_register_macro_cannot_shadow_builtin_primitive():
    registry = CapabilityRegistry()
    before = await registry.get_capability("run_validation")
    assert before is not None and before.kind == CapabilityKind.PRIMITIVE

    with pytest.raises(InvalidMacroError):
        await registry.register_macro(_macro("run_validation"))

    after = await registry.get_capability("run_validation")
    assert after is not None
    assert after.kind == CapabilityKind.PRIMITIVE
    assert after.status == CapabilityStatus.ACTIVE
    assert after.macro_spec is None


async def test_register_macro_with_fresh_id_still_works():
    registry = CapabilityRegistry()
    rec = await registry.register_macro(_macro("macro-fresh"))
    assert rec.status == CapabilityStatus.DRAFT
    assert (await registry.get_capability("macro-fresh")) is rec


# --- registry: a real PyMongo collection must not be truth-tested -----------------------


async def test_registry_with_real_collection_register_activate_quarantine(collection):
    registry = CapabilityRegistry(mongo_collection=collection)

    rec = await registry.register_macro(_macro("macro-mongo"))
    assert rec.status == CapabilityStatus.DRAFT

    stored = await collection.find_one({"capability_id": "macro-mongo"})
    assert stored is not None and stored["status"] == "draft"

    activated = await registry.activate_capability("macro-mongo")
    assert activated.status == CapabilityStatus.ACTIVE
    assert (await collection.find_one({"capability_id": "macro-mongo"}))["status"] == "active"

    quarantined = await registry.quarantine_capability("macro-mongo", reason="audit")
    assert quarantined.status == CapabilityStatus.QUARANTINED
    fetched = await registry.get_capability("macro-mongo")
    assert fetched is not None and fetched.status == CapabilityStatus.QUARANTINED

    listed = await registry.list_capabilities(status=CapabilityStatus.QUARANTINED)
    assert [c.capability_id for c in listed] == ["macro-mongo"]
    assert not any(
        c.capability_id == "macro-mongo"
        for c in await registry.list_capabilities(status=CapabilityStatus.ACTIVE)
    )


# --- fitness: counters must survive when the registry is Mongo-backed -------------------


async def test_fitness_counters_persist_with_real_collection(collection):
    registry = CapabilityRegistry(mongo_collection=collection)
    await registry.register_macro(_macro("macro-fit"))
    await registry.activate_capability("macro-fit")
    tracker = FitnessTracker(registry, quarantine_failure_threshold=2)

    await tracker.record_execution("macro-fit", success=True)
    await tracker.record_execution("macro-fit", success=False)

    doc = await collection.find_one({"capability_id": "macro-fit"})
    assert doc["total_executions"] == 2
    assert doc["failed_executions"] == 1
    assert doc["fitness_score"] == 0.5
    assert doc["status"] == "active"


async def test_fitness_auto_quarantine_with_real_collection(collection):
    registry = CapabilityRegistry(mongo_collection=collection)
    await registry.register_macro(_macro("macro-fit-q"))
    await registry.activate_capability("macro-fit-q")
    tracker = FitnessTracker(registry, quarantine_failure_threshold=2)

    rec = await tracker.record_execution("macro-fit-q", success=False)
    assert rec.status == CapabilityStatus.ACTIVE
    rec = await tracker.record_execution("macro-fit-q", success=False)
    assert rec.status == CapabilityStatus.QUARANTINED

    doc = await collection.find_one({"capability_id": "macro-fit-q"})
    assert doc["status"] == "quarantined"
    assert doc["failed_executions"] == 2
    assert doc["total_executions"] == 2


# --- fitness: in-memory behavior locked ------------------------------------------------


async def test_fitness_in_memory_counters_and_unknown_capability():
    registry = CapabilityRegistry()
    tracker = FitnessTracker(registry, quarantine_failure_threshold=3)
    rec = await tracker.record_execution("run_validation", success=False)
    assert (rec.total_executions, rec.failed_executions, rec.fitness_score) == (1, 1, 0.0)
    assert rec.status == CapabilityStatus.ACTIVE
    with pytest.raises(KeyError):
        await tracker.record_execution("does-not-exist", success=True)


# --- miner: deterministic ---------------------------------------------------------------


def test_miner_is_deterministic_and_needs_two_invocations():
    def ev(tool):
        return {"event_type": "tool.invocation", "payload": {"tool_name": tool}}

    assert TrajectoryMiner.mine_from_events([ev("inspect_vcf")]) is None
    assert TrajectoryMiner.mine_from_events([{"event_type": "other", "payload": {}}] * 3) is None
    a = TrajectoryMiner.mine_from_events([ev("inspect_vcf"), ev("run_validation")])
    b = TrajectoryMiner.mine_from_events([ev("inspect_vcf"), ev("run_validation")])
    assert a is not None and b is not None
    assert a.model_dump() == b.model_dump()
    assert a.required_primitives == ["inspect_vcf", "run_validation"]
