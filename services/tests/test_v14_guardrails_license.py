"""V14 license guardrail: no Z-Anatomy / BodyParts3D assets in the tree."""

from __future__ import annotations

from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
BANNED_MARKERS = (
    "z-anatomy",
    "zanatomy",
    "z_anatomy",
    "bodyparts3d",
    "body parts 3d",
    "bodypart3d",
)
SKIP_DIR_NAMES = {
    ".git",
    "node_modules",
    ".venv",
    "dist",
    "__pycache__",
    ".pytest_cache",
    "playwright-output",
    "artifacts",
}
# Mentions of the ban in our own docs are allowed; product/data/assets are not.
ALLOWED_PREFIXES = (
    "docs/milestones/",
    "services/tests/test_v14_guardrails",
    "apps/web/tests/v14/guardrails",
    "apps/web/e2e/v14/",
    "scripts/verify_v14",
    "scripts/benchmark_v14",
    "artifacts/milestones/v14/",
)
ALLOWED_DOC_PATHS = {
    "DECISIONS.md",
    "PROGRESS.md",
    "AGENT_OWNERSHIP.md",
    "THIRD_PARTY_NOTICES.md",
    "docs/milestones/V14_ANATOMY_EDITOR_AUDIT.md",
    "docs/milestones/V14_UI_CONTRACTS.md",
}
BINARY_SUFFIXES = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".glb",
    ".gltf",
    ".bin",
    ".wasm",
    ".woff",
    ".woff2",
    ".ttf",
    ".mp3",
    ".wav",
    ".ico",
}


def _iter_files():
    for path in REPO.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIR_NAMES for part in path.parts):
            continue
        yield path


def test_no_zanatomy_or_bodyparts3d_in_the_repository():
    hits: list[str] = []
    for path in _iter_files():
        rel = path.relative_to(REPO).as_posix()
        if rel in ALLOWED_DOC_PATHS or rel.startswith(ALLOWED_PREFIXES):
            continue
        name_l = path.name.lower()
        if any(marker in name_l or marker in rel.lower() for marker in BANNED_MARKERS):
            hits.append(f"{rel}: banned name")
            continue
        if path.suffix.lower() in BINARY_SUFFIXES:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        low = text.lower()
        if any(marker in low for marker in BANNED_MARKERS):
            hits.append(rel)
    assert hits == [], (
        "Z-Anatomy / BodyParts3D markers found. V14-ADR-001 forbids those meshes "
        f"(share-alike / mixed provenance): {hits[:20]}"
    )


def test_anatomy_public_assets_are_not_third_party_atlases():
    public = REPO / "apps" / "web" / "public" / "anatomy"
    if not public.exists():
        return
    for path in public.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(REPO).as_posix().lower()
        assert "zanatomy" not in rel and "bodyparts3d" not in rel
        if path.suffix.lower() in {".glb", ".gltf"}:
            raw = path.read_bytes()[:4096].lower()
            assert b"z-anatomy" not in raw
            assert b"bodyparts3d" not in raw
