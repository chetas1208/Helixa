"""Small JSON loaders for V14 anatomy fixtures."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any


def load_json(path: Path) -> Any:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=64)
def load_json_cached(path: str) -> Any:
    return load_json(Path(path))


def reset_caches() -> None:
    load_json_cached.cache_clear()
