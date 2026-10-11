"""Anatomy node registry and typed search (contract §8a)."""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from functools import lru_cache
from typing import Any

from .io import load_json
from .paths import SYSTEMS_PATH, TREE_PATH
from .seed import SEED_NODES, SEED_SYSTEMS

RESULT_TYPES = (
    "anatomy",
    "system",
    "gene",
    "locus",
    "variant",
    "trait",
    "evidence-category",
)

EVIDENCE_CATEGORIES = [
    {"id": "tissue-expression", "label": "Tissue expression", "matched": "expression"},
    {"id": "variant-trait-association", "label": "Variant–trait association", "matched": "association"},
    {"id": "curated-gene-phenotype", "label": "Curated gene–phenotype relationship", "matched": "phenotype"},
    {"id": "regulatory-association", "label": "Regulatory association", "matched": "regulatory"},
]

_LATERAL = {"left": "left", "right": "right", "l ": "left", "r ": "right"}


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


@lru_cache(maxsize=1)
def _bundle() -> dict[str, Any]:
    tree = load_json(TREE_PATH) or {}
    systems = load_json(SYSTEMS_PATH) or {}
    nodes = tree.get("nodes") or [dict(n) for n in SEED_NODES]
    sys_list = systems.get("systems") or [dict(s) for s in SEED_SYSTEMS]
    by_id = {n["id"]: n for n in nodes}
    children: dict[str, list[str]] = {n["id"]: [] for n in nodes}
    for n in nodes:
        for parent in n.get("parent_ids") or []:
            children.setdefault(parent, []).append(n["id"])
    return {
        "root_id": tree.get("root_id") or "UBERON:0013702",
        "nodes": nodes,
        "by_id": by_id,
        "children": children,
        "systems": sys_list,
        "uberon_version": tree.get("uberon_version") or "2026-10-01",
    }


def reset() -> None:
    _bundle.cache_clear()


def list_nodes() -> list[dict]:
    return [dict(n) for n in _bundle()["nodes"]]


def get_node(anatomy_id: str) -> dict | None:
    if not anatomy_id:
        return None
    node = _bundle()["by_id"].get(anatomy_id)
    return dict(node) if node else None


def list_systems() -> list[dict]:
    return [dict(s) for s in _bundle()["systems"]]


def root_id() -> str:
    return _bundle()["root_id"]


def children_of(anatomy_id: str) -> list[dict]:
    ids = _bundle()["children"].get(anatomy_id) or []
    by_id = _bundle()["by_id"]
    return [dict(by_id[i]) for i in ids if i in by_id]


def breadcrumb(anatomy_id: str) -> list[dict]:
    by_id = _bundle()["by_id"]
    chain: list[dict] = []
    seen: set[str] = set()
    current = anatomy_id
    while current and current not in seen:
        seen.add(current)
        node = by_id.get(current)
        if not node:
            break
        chain.append({"id": node["id"], "label": node["label"]})
        parents = node.get("parent_ids") or []
        current = parents[0] if parents else None
    chain.reverse()
    return chain


def descendants(anatomy_id: str) -> set[str]:
    out: set[str] = set()
    stack = list(_bundle()["children"].get(anatomy_id) or [])
    while stack:
        nid = stack.pop()
        if nid in out:
            continue
        out.add(nid)
        stack.extend(_bundle()["children"].get(nid) or [])
    return out


def ancestors(anatomy_id: str) -> set[str]:
    out: set[str] = set()
    by_id = _bundle()["by_id"]
    stack = list((by_id.get(anatomy_id) or {}).get("parent_ids") or [])
    while stack:
        nid = stack.pop()
        if nid in out:
            continue
        out.add(nid)
        stack.extend((by_id.get(nid) or {}).get("parent_ids") or [])
    return out


def depth_from_root(anatomy_id: str) -> int:
    return max(0, len(breadcrumb(anatomy_id)) - 1)


def tree_nodes(system: str | None = None, depth: int | None = None) -> list[dict]:
    root = root_id()
    allowed = {root, *descendants(root)}
    nodes = [n for n in list_nodes() if n["id"] in allowed]
    if system:
        nodes = [n for n in nodes if system in (n.get("system_ids") or [])]
    if depth is not None:
        nodes = [n for n in nodes if depth_from_root(n["id"]) <= depth]
    return nodes


def relationships_for(anatomy_id: str) -> list[dict]:
    node = get_node(anatomy_id)
    if not node:
        return []
    version = _bundle()["uberon_version"]
    rels: list[dict] = []
    for parent in node.get("parent_ids") or []:
        rels.append(
            {
                "kind": "ANATOMICAL_PART_OF",
                "subject_id": anatomy_id,
                "object_id": parent,
                "source_id": "uberon",
                "source_version": version,
                "source_url": (node.get("source") or {}).get("url") or "",
            }
        )
    for sid in node.get("system_ids") or []:
        rels.append(
            {
                "kind": "SYSTEM_MEMBERSHIP",
                "subject_id": anatomy_id,
                "object_id": sid,
                "source_id": "uberon",
                "source_version": version,
                "source_url": (node.get("source") or {}).get("url") or "",
            }
        )
    for asset in node.get("asset_ids") or []:
        rels.append(
            {
                "kind": "VISUAL_ASSET_FOR_ANATOMY",
                "subject_id": asset,
                "object_id": anatomy_id,
                "source_id": "diamond-atlas",
                "source_version": "v14",
                "source_url": "",
            }
        )
    return rels


def _laterality_from_query(query: str) -> tuple[str | None, str]:
    q = _norm(query)
    for token, side in (("left", "left"), ("right", "right")):
        if q.startswith(token + " ") or q.endswith(" " + token) or q == token:
            return side, q.replace(token, " ").strip()
    return None, q


def _score(query: str, candidate: str) -> float:
    q = _norm(query)
    c = _norm(candidate)
    if not q or not c:
        return 0.0
    if q == c:
        return 1.0
    if c.startswith(q) or q.startswith(c):
        return 0.92
    if q in c or c in q:
        return 0.86
    return SequenceMatcher(None, q, c).ratio()


def search(query: str, limit: int = 20) -> list[dict]:
    """SearchResult dicts. result_type is always set."""
    from .genes import list_genes
    from .loci import list_loci

    q = (query or "").strip()
    if not q:
        return []
    side, rest = _laterality_from_query(q)
    rest_or_q = rest or _norm(q)
    hits: list[dict] = []

    for node in list_nodes():
        fields = [node["id"], node.get("label") or "", node.get("ontology_label") or "", *(node.get("synonyms") or [])]
        best = max((_score(rest_or_q, f) for f in fields), default=0.0)
        raw_best = max((_score(q, f) for f in fields), default=0.0)
        score = max(best, raw_best)
        if side and node.get("laterality") == side:
            score = min(1.0, score + 0.12)
        elif side and node.get("laterality") in {"left", "right"} and node.get("laterality") != side:
            score -= 0.25
        if score < 0.58:
            continue
        matched = node.get("label") or node["id"]
        corrected = None
        if best < 0.9 and raw_best < 0.9 and score >= 0.72:
            corrected = q
        hits.append(
            {
                "result_type": "anatomy",
                "id": node["id"],
                "label": node["label"],
                "matched": matched,
                "score": round(score, 4),
                "laterality": node.get("laterality"),
                "corrected_from": corrected,
            }
        )

    for sys in list_systems():
        score = max(_score(q, sys["id"]), _score(q, sys.get("label") or ""))
        if score >= 0.58:
            hits.append(
                {
                    "result_type": "system",
                    "id": sys["id"],
                    "label": sys["label"],
                    "matched": sys["label"],
                    "score": round(score, 4),
                    "laterality": None,
                    "corrected_from": q if score < 0.9 else None,
                }
            )

    for gene in list_genes():
        score = max(_score(q, gene["gene_id"]), _score(q, gene["symbol"]), _score(q, gene.get("description") or ""))
        if score >= 0.62:
            hits.append(
                {
                    "result_type": "gene",
                    "id": gene["gene_id"],
                    "label": gene["symbol"],
                    "matched": gene["symbol"],
                    "score": round(score, 4),
                    "laterality": None,
                    "corrected_from": q if score < 0.9 else None,
                }
            )

    for loc in list_loci():
        score = max(_score(q, loc["locus_id"]), _score(q, loc["gene_symbol"]), _score(q, loc.get("label") or ""))
        if score >= 0.62:
            hits.append(
                {
                    "result_type": "locus",
                    "id": loc["locus_id"],
                    "label": loc["label"],
                    "matched": loc["gene_symbol"],
                    "score": round(score, 4),
                    "laterality": None,
                    "corrected_from": None,
                }
            )

    from .evidence import iter_gwas_search_rows

    for row in iter_gwas_search_rows():
        score = max(_score(q, f) for f in row["fields"])
        if score >= 0.7:
            hits.append(
                {
                    "result_type": row["result_type"],
                    "id": row["id"],
                    "label": row["label"],
                    "matched": row["matched"],
                    "score": round(score, 4),
                    "laterality": None,
                    "corrected_from": None,
                }
            )

    for cat in EVIDENCE_CATEGORIES:
        score = max(_score(q, cat["id"]), _score(q, cat["label"]), _score(q, cat["matched"]))
        if score >= 0.62:
            hits.append(
                {
                    "result_type": "evidence-category",
                    "id": cat["id"],
                    "label": cat["label"],
                    "matched": cat["matched"],
                    "score": round(score, 4),
                    "laterality": None,
                    "corrected_from": None,
                }
            )

    hits.sort(key=lambda h: (-h["score"], h["result_type"], h["label"]))
    # Prefer exact laterality resolution for phrases like "left hand".
    if side and rest_or_q:
        preferred = [h for h in hits if h["result_type"] == "anatomy" and h.get("laterality") == side]
        if preferred:
            hits = preferred + [h for h in hits if h not in preferred]
    seen: set[tuple[str, str]] = set()
    out: list[dict] = []
    for hit in hits:
        key = (hit["result_type"], hit["id"])
        if key in seen:
            continue
        seen.add(key)
        out.append(hit)
        if len(out) >= max(1, min(limit, 50)):
            break
    return out


def resolve_text(text: str) -> list[str]:
    """Anatomy ids mentioned in free text. 'left hand' → UBERON:0002398@left."""
    if not (text or "").strip():
        return []
    found: list[str] = []
    # Prefer longer labels so "left hand" wins over "hand".
    candidates: list[tuple[int, str, str]] = []
    for node in list_nodes():
        labels = [node.get("label") or "", *(node.get("synonyms") or [])]
        for label in labels:
            n = _norm(label)
            if n:
                candidates.append((len(n), n, node["id"]))
    candidates.sort(reverse=True)
    blob = _norm(text)
    used_spans: list[tuple[int, int]] = []
    for _length, label, nid in candidates:
        idx = blob.find(label)
        if idx < 0:
            continue
        span = (idx, idx + len(label))
        if any(not (span[1] <= a or span[0] >= b) for a, b in used_spans):
            continue
        used_spans.append(span)
        if nid not in found:
            found.append(nid)
    return found
