"""Run the V16 unit gate and write the machine-readable result. Skips are listed, not hidden."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "artifacts" / "milestones" / "v16"
PY = ROOT / ".venv" / "bin" / "python"
RUFF = ROOT / ".venv" / "bin" / "ruff"


def run(cmd: list[str]) -> dict:
    completed = subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True)
    return {
        "cmd": cmd,
        "exit_code": completed.returncode,
        "stdout_tail": completed.stdout[-4000:],
        "stderr_tail": completed.stderr[-4000:],
    }


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    python = str(PY if PY.exists() else sys.executable)
    ruff = str(RUFF if RUFF.exists() else "ruff")
    targets = [
        "services/integrations/voyage",
        "services/runtime/retrieval",
        "services/runtime/research_evidence",
        "services/api/app/routes/v16_research.py",
        "services/api/app/routes/health.py",
        "services/tests/test_v16_voyage.py",
        "services/tests/test_v16_retrieval.py",
        "services/tests/test_v16_privacy.py",
        "services/tests/test_v16_routes.py",
        "scripts/voyage_check.py",
        "scripts/demo_v16.py",
        "scripts/reindex_research.py",
        "scripts/verify_v16.py",
    ]
    steps = [
        run([ruff, "check", *targets]),
        run([python, "-m", "pytest", "-q", "services/tests/test_v16_voyage.py", "services/tests/test_v16_retrieval.py", "services/tests/test_v16_privacy.py", "services/tests/test_v16_routes.py"]),
        run(["pnpm", "--filter", "web", "exec", "vitest", "run", "tests/v16/researchPanel.test.tsx"]),
    ]
    payload = {"steps": steps, "passed": all(step["exit_code"] == 0 for step in steps)}
    (OUT / "verification.json").write_text(json.dumps(payload, indent=2))
    print(json.dumps({"passed": payload["passed"], "wrote": str(OUT / "verification.json")}))
    return 0 if payload["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
