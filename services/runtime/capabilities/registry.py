from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from services.runtime.capabilities.macro_schema import (
    CapabilityKind,
    CapabilityRecord,
    CapabilityStatus,
    DeclarativeMacro,
)
from services.runtime.harness.models import PolicyEnvelope


class UnauthorizedPrimitiveError(PermissionError):
    pass


class InvalidMacroError(ValueError):
    pass


class CapabilityRegistry:
    """
    MongoDB-compatible dynamic capability and macro registry.
    Enforces strict policy envelope authorization and declarative safety.
    """

    def __init__(self, envelope: PolicyEnvelope | None = None, mongo_collection: Any | None = None):
        self.envelope = envelope or PolicyEnvelope()
        self.collection = mongo_collection
        self._memory_store: dict[str, CapabilityRecord] = {}

        # Register default immutable primitives
        for primitive_id in self.envelope.immutable_allowed_tools_whitelist:
            self._memory_store[primitive_id] = CapabilityRecord(
                capability_id=primitive_id,
                kind=CapabilityKind.PRIMITIVE,
                name=primitive_id.replace("_", " ").title(),
                description=f"Built-in authorized primitive tool: {primitive_id}",
                status=CapabilityStatus.ACTIVE,
            )

    async def register_macro(self, macro: DeclarativeMacro) -> CapabilityRecord:
        # 1. Check for unsafe code patterns
        safe, reason = macro.validate_no_unsafe_constructs()
        if not safe:
            raise InvalidMacroError(f"Macro validation failed: {reason}")

        # Built-in primitives are immutable: a macro may not replace one by reusing its id
        existing = self._memory_store.get(macro.macro_id)
        if macro.macro_id in self.envelope.immutable_allowed_tools_whitelist or (
            existing is not None and existing.kind == CapabilityKind.PRIMITIVE
        ):
            raise InvalidMacroError(
                f"Macro id '{macro.macro_id}' collides with a built-in primitive and cannot replace it."
            )

        # 2. Check that all required primitives are in the immutable whitelist
        for primitive in macro.required_primitives:
            if primitive not in self.envelope.immutable_allowed_tools_whitelist:
                raise UnauthorizedPrimitiveError(
                    f"Macro references unauthorized primitive tool outside PolicyEnvelope: '{primitive}'"
                )

        for step in macro.steps:
            if step.primitive_tool_id not in self.envelope.immutable_allowed_tools_whitelist:
                raise UnauthorizedPrimitiveError(
                    f"Macro step references unauthorized tool: '{step.primitive_tool_id}'"
                )

        record = CapabilityRecord(
            capability_id=macro.macro_id,
            kind=CapabilityKind.DECLARATIVE_MACRO,
            name=macro.name,
            description=macro.description,
            status=CapabilityStatus.DRAFT,
            macro_spec=macro,
        )

        self._memory_store[macro.macro_id] = record
        if self.collection is not None:
            await self.collection.replace_one(
                {"capability_id": macro.macro_id},
                record.model_dump(),
                upsert=True,
            )
        return record

    async def activate_capability(self, capability_id: str) -> CapabilityRecord:
        rec = await self.get_capability(capability_id)
        if not rec:
            raise KeyError(f"Capability '{capability_id}' not found.")
        rec.status = CapabilityStatus.ACTIVE
        rec.updated_at = datetime.now(timezone.utc).isoformat()
        self._memory_store[capability_id] = rec
        if self.collection is not None:
            await self.collection.update_one(
                {"capability_id": capability_id},
                {"$set": {"status": CapabilityStatus.ACTIVE.value, "updated_at": rec.updated_at}},
            )
        return rec

    async def quarantine_capability(self, capability_id: str, reason: str = "") -> CapabilityRecord:
        rec = await self.get_capability(capability_id)
        if not rec:
            raise KeyError(f"Capability '{capability_id}' not found.")
        rec.status = CapabilityStatus.QUARANTINED
        rec.updated_at = datetime.now(timezone.utc).isoformat()
        self._memory_store[capability_id] = rec
        if self.collection is not None:
            await self.collection.update_one(
                {"capability_id": capability_id},
                {"$set": {"status": CapabilityStatus.QUARANTINED.value, "updated_at": rec.updated_at}},
            )
        return rec

    async def get_capability(self, capability_id: str) -> CapabilityRecord | None:
        if self.collection is not None:
            doc = await self.collection.find_one({"capability_id": capability_id})
            if doc:
                doc.pop("_id", None)
                return CapabilityRecord(**doc)
        return self._memory_store.get(capability_id)

    async def list_capabilities(self, status: CapabilityStatus | None = None) -> list[CapabilityRecord]:
        if self.collection is not None:
            query = {"status": status.value} if status else {}
            cursor = self.collection.find(query)
            docs = await cursor.to_list(length=100)
            return [CapabilityRecord(**{k: v for k, v in d.items() if k != "_id"}) for d in docs]
        if status:
            return [c for c in self._memory_store.values() if c.status == status]
        return list(self._memory_store.values())
