#!/usr/bin/env python3
"""Atlas-only V8 probe. Local MongoDB is reported as NOT_CONFIGURED, not as Atlas success."""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from services.integrations.mongodb import MongoDBClient  # noqa: E402


async def main() -> int:
    uri = os.getenv("MONGODB_URI", "")
    require = os.getenv("MONGODB_REQUIRE_ATLAS", "false").lower() in {"1", "true", "yes"}
    if not require or "mongodb.net" not in uri:
        print("NOT_CONFIGURED: set MONGODB_URI to an Atlas URI and MONGODB_REQUIRE_ATLAS=true")
        print("Local MongoDB checks do not satisfy verify-v8-atlas.")
        return 2
    client = MongoDBClient(uri=uri, require_atlas=True)
    diag = await client.check_status()
    prefix = os.getenv("DIAMOND_V8_ATLAS_PREFIX", "v8_atlas_verify")
    document = {
        "namespace": prefix,
        "kind": "v8_atlas_canary",
        "mode": diag.get("mode"),
    }
    await client.db.v8_atlas_canaries.replace_one({"namespace": prefix, "kind": "v8_atlas_canary"}, document, upsert=True)
    found = await client.db.v8_atlas_canaries.find_one({"namespace": prefix, "kind": "v8_atlas_canary"}, {"_id": 0})
    await client.close()
    if not found or diag.get("mode") != "atlas":
        print("FAILED: Atlas write was not verified")
        return 1
    print("CONNECTED: Atlas canary written under namespace", prefix)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
