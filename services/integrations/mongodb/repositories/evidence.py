from __future__ import annotations

from services.integrations.mongodb.models import EvidenceReceiptModel

from .base import BaseRepository


class EvidenceRepository(BaseRepository):
    async def save_receipt(self, receipt: EvidenceReceiptModel) -> EvidenceReceiptModel:
        await self.db.evidence_receipts.replace_one(
            {"receipt_id": receipt.receipt_id},
            receipt.model_dump(),
            upsert=True,
        )
        return receipt

    async def get_receipt(self, receipt_id: str) -> EvidenceReceiptModel | None:
        doc = await self.db.evidence_receipts.find_one({"receipt_id": receipt_id}, {"_id": 0})
        return EvidenceReceiptModel(**doc) if doc else None

    async def get_receipt_by_digest(self, digest: str) -> EvidenceReceiptModel | None:
        doc = await self.db.evidence_receipts.find_one({"receipt_digest": digest}, {"_id": 0})
        return EvidenceReceiptModel(**doc) if doc else None

    async def get_receipt_by_run(self, run_id: str) -> EvidenceReceiptModel | None:
        doc = await self.db.evidence_receipts.find_one({"run_id": run_id}, {"_id": 0})
        return EvidenceReceiptModel(**doc) if doc else None
