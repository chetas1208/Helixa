"""Detect Atlas Vector Search. Local MongoDB is reported as unsupported."""

from __future__ import annotations

import asyncio
from typing import Any


async def probe_vector_search(db: Any | None) -> dict[str, Any]:
    if db is None:
        return {"supported": False, "active": False, "reason": "no_database"}
    try:
        await db.command("ping")
    except Exception as exc:
        return {"supported": False, "active": False, "reason": type(exc).__name__}
    list_indexes = getattr(db.research_chunks, "list_search_indexes", None)
    if list_indexes is None:
        return {
            "supported": False,
            "active": False,
            "reason": "driver_has_no_list_search_indexes",
        }
    try:
        cursor = list_indexes()
        if asyncio.iscoroutine(cursor):
            cursor = await cursor
        if hasattr(cursor, "to_list"):
            rows = await cursor.to_list(length=20)
        else:
            rows = list(cursor)
    except Exception as exc:
        return {
            "supported": False,
            "active": False,
            "reason": f"{type(exc).__name__}: Atlas Vector Search is not available on this cluster",
        }
    names = [row.get("name") for row in rows if isinstance(row, dict)]
    return {
        "supported": True,
        "active": "research_chunks_vector" in names,
        "index_names": names,
        "reason": None if names else "no_search_index",
    }
