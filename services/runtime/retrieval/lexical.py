"""Lexical overlap used when Voyage or Atlas Vector Search is unavailable."""

from __future__ import annotations

import math
import re

_TOKEN = re.compile(r"[a-z0-9][a-z0-9:+._-]{1,}", re.I)


def tokenize(text: str) -> list[str]:
    return [match.group(0).lower() for match in _TOKEN.finditer(text)]


def score_text(query: str, document: str) -> float:
    q_tokens = tokenize(query)
    if not q_tokens:
        return 0.0
    counts: dict[str, int] = {}
    for token in tokenize(document):
        counts[token] = counts.get(token, 0) + 1
    if not counts:
        return 0.0
    length = sum(counts.values())
    score = 0.0
    for token in set(q_tokens):
        tf = counts.get(token, 0)
        if tf:
            score += (1.0 + math.log(tf)) / math.log(1 + length)
    return score
