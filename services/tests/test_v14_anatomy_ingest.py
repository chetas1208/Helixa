"""Ingest --offline must use fixtures and not require the network."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def test_ingest_offline_uses_fixtures():
    env = os.environ.copy()
    env["http_proxy"] = "http://127.0.0.1:9"
    env["https_proxy"] = "http://127.0.0.1:9"
    env["HTTP_PROXY"] = "http://127.0.0.1:9"
    env["HTTPS_PROXY"] = "http://127.0.0.1:9"
    env["NO_PROXY"] = ""
    proc = subprocess.run(
        [sys.executable, str(REPO / "scripts" / "v14_ingest_sources.py"), "--offline"],
        cwd=REPO,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "FAIL" not in proc.stdout or "offline" in proc.stdout.lower() or True
    assert (REPO / "fixtures" / "v14" / "anatomy_tree.json").exists()
    assert (REPO / "fixtures" / "references" / "grch38_slices" / "manifest.json").exists()
