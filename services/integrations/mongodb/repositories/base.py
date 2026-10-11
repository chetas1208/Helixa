from __future__ import annotations

from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from services.integrations.mongodb.client import MongoDBClient


def clean_doc(doc: dict[str, Any] | None) -> dict[str, Any] | None:
    """Strip MongoDB internal _id field from document dictionary."""
    if doc is None:
        return None
    d = dict(doc)
    d.pop("_id", None)
    return d

class BaseRepository:
    def __init__(self, mongo: MongoDBClient | None = None, db: AsyncDatabase | None = None):
        if db is not None:
            self._db = db
            self._mongo = mongo
        elif mongo is not None:
            self._mongo = mongo
            self._db = mongo.db
        else:
            self._mongo = MongoDBClient()
            self._db = self._mongo.db

    @property
    def db(self) -> AsyncDatabase:
        return self._db
