#!/usr/bin/env python3
"""
DIAMOND Genome V5 - Milestone 01 Full Verification Suite
Executes end-to-end durability tests, frontend tests, Atlas probe, chaos worker recovery,
and code linting. Emits structured verification artifact.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

root_dir = Path(__file__).resolve().parent.parent

def run_step(step_name: str, cmd: list[str]) -> tuple[bool, str, float]:
    print(f"\n---> [STEP] {step_name}")
    start = time.perf_counter()
    res = subprocess.run(cmd, cwd=root_dir, capture_output=True, text=True)
    duration = time.perf_counter() - start
    output = (res.stdout + "\n" + res.stderr).strip()

    if res.returncode == 0:
        print(f"     Status: [PASS] ({duration:.2f}s)")
        return True, output, duration
    else:
        print(f"     Status: [FAIL] ({duration:.2f}s) Exited with code {res.returncode}")
        print(f"     Output:\n{output[:1000]}")
        return False, output, duration

def main():
    print("=" * 70)
    print("DIAMOND Genome V5: Milestone 01/10 Verification Suite")
    print("Atlas Foundation, Codebase Audit & Durable Execution")
    print("=" * 70)

    results = {}
    overall_success = True

    # 1. Backend Durability & Regression Tests
    ok, out, dur = run_step(
        "Backend Pytest Suite (Genomics, Durability, Fencing, Concurrency)",
        [".venv/bin/pytest", "-v", "services/tests"],
    )
    results["backend_pytest"] = {"success": ok, "duration_sec": round(dur, 2), "summary": out.splitlines()[-1] if out else ""}
    overall_success = overall_success and ok

    # 2. Frontend Vitest Suite
    ok, out, dur = run_step(
        "Frontend Vitest Suite (React Three Fiber, Helix Scene, Controls)",
        ["pnpm", "--filter", "web", "test", "--", "--run"],
    )
    results["frontend_vitest"] = {"success": ok, "duration_sec": round(dur, 2)}
    overall_success = overall_success and ok

    # 3. Atlas Connectivity & Write Probe
    ok, out, dur = run_step(
        "MongoDB Atlas Foundation & Write Verification Probe",
        [".venv/bin/python", "scripts/check_atlas.py"],
    )
    results["atlas_probe"] = {"success": ok, "duration_sec": round(dur, 2)}
    overall_success = overall_success and ok

    # 4. Chaos Worker Recovery & Fencing Demo
    ok, out, dur = run_step(
        "Worker Chaos Recovery & Lease Fencing Demo",
        [".venv/bin/python", "scripts/demo_chaos.py"],
    )
    results["chaos_recovery"] = {"success": ok, "duration_sec": round(dur, 2)}
    overall_success = overall_success and ok

    # 5. Ruff Linter
    ok, out, dur = run_step(
        "Ruff Static Code Quality Check",
        [".venv/bin/ruff", "check", "services/"],
    )
    results["ruff_lint"] = {"success": ok, "duration_sec": round(dur, 2)}
    overall_success = overall_success and ok

    # Output report
    output_dir = root_dir / "artifacts" / "milestones" / "m01"
    output_dir.mkdir(parents=True, exist_ok=True)
    report_file = output_dir / "verification_report.json"

    verification_data = {
        "milestone": "01/10: Atlas Foundation, Codebase Audit & Durable Execution",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "overall_status": "VERIFIED" if overall_success else "FAILED",
        "steps": results,
    }

    with open(report_file, "w") as f:
        json.dump(verification_data, f, indent=2)

    print("\n" + "=" * 70)
    print(f"VERIFICATION STATUS: {'[ALL CHECKS PASSED - VERIFIED]' if overall_success else '[VERIFICATION FAILED]'}")
    print(f"Artifact report saved to: {report_file.relative_to(root_dir)}")
    print("=" * 70)

    sys.exit(0 if overall_success else 1)

if __name__ == "__main__":
    main()
