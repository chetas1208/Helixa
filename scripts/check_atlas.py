#!/usr/bin/env python3
"""
DIAMOND Genome V5 - Atlas Foundation Probe
Checks MongoDB Atlas connectivity, authentication, and canary write permissions.
Reports honest status: never claims Atlas is active when running on local MongoDB.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

# Ensure project root is in sys.path
root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

from services.integrations.mongodb import MongoDBClient  # noqa: E402


async def main():
    print("=" * 65)
    print("DIAMOND Genome V5: MongoDB Atlas Foundation Probe")
    print("=" * 65)

    client = MongoDBClient()
    diag = await client.check_status()

    output_dir = root_dir / "artifacts" / "milestones" / "m01"
    output_dir.mkdir(parents=True, exist_ok=True)
    report_file = output_dir / "atlas_status.json"

    print("\nConfiguration:")
    print(f"  Target URI:           {diag['sanitized_uri']}")
    print(f"  Deployment Mode:      {diag['mode']}")
    print(f"  Atlas Detected:       {diag['is_atlas']}")
    print(f"  Database Name:        {diag['database']}")
    print(f"  Require Atlas:        {client.require_atlas}")

    print("\nConnectivity Probes:")
    is_reachable = await client.ping()
    print(f"  1. Database Ping:     {'[PASS] Reachable' if is_reachable else '[FAIL] Inaccessible'}")

    is_write_verified = False
    if is_reachable:
        is_write_verified = await client.verify_write()
        print(f"  2. Write Verification:{'[PASS] Canary Verified' if is_write_verified else '[FAIL] Write Denied'}")
    else:
        print("  2. Write Verification:[SKIPPED] Connection Inaccessible")

    print("\nOverall Atlas Status:")
    if diag["is_atlas"] and is_write_verified:
        status_banner = "ATLAS_LIVE_WRITE_VERIFIED"
        print("  Status: [LIVE] Connected to MongoDB Atlas Sandbox.")
        print("  All agent persistence and write operations verified.")
    elif diag["is_atlas"] and is_reachable:
        status_banner = "ATLAS_AUTHENTICATED_READONLY"
        print("  Status: [WARNING] Atlas reachable but canary write failed.")
    elif diag["mode"] == "local" and is_write_verified:
        status_banner = "LOCAL_DEVELOPMENT_HEALTHY"
        print("  Status: [LOCAL] Operating on local MongoDB daemon.")
        print("  Atlas integration is credential-ready. Provide MONGODB_URI in .env to connect sandbox.")
    else:
        status_banner = "DEGRADED"
        print(f"  Status: [ERROR] Database inaccessible. Error: {diag.get('error')}")

    report = {
        "timestamp": diag.get("timestamp"),
        "status_banner": status_banner,
        "diagnostics": diag,
        "is_reachable": is_reachable,
        "is_write_verified": is_write_verified,
        "require_atlas": client.require_atlas,
    }

    with open(report_file, "w") as f:
        json.dump(report, f, indent=2)

    print(f"\nReport saved to: {report_file.relative_to(root_dir)}")
    print("=" * 65)

    await client.close()
    # Exit with code 0 if local healthy or atlas live; exit 1 only if DB down or require_atlas violated
    if client.require_atlas and not diag["is_atlas"]:
        sys.exit(1)
    if not is_reachable:
        sys.exit(1)
    sys.exit(0)

if __name__ == "__main__":
    asyncio.run(main())
