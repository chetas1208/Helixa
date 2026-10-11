"""Deterministic intent. A trait wish is not an allele."""

from __future__ import annotations

import re
from typing import Any

_GENE = re.compile(r"\b([A-Z][A-Z0-9]{1,9})\b")
_STOP = {
    "DNA", "RNA", "UV", "PMID", "DOI", "AND", "THE", "SHOW", "HELP", "GRCH38", "GRCH37",
}
_REFUSE = re.compile(
    r"\b(diagnos\w*|treat(?:ment)?\s+plan|design\s+a\s+virus|crispr\s+guide|off-target\s+guide|"
    r"make\s+(?:me|a)\s+(?:baby|embryo)|clinical\s+suitability)\b",
    re.I,
)
_ALLELE = re.compile(
    r"\b(?P<contig>(?:chr)?[0-9XY]{1,2})\s*:\s*(?P<pos>\d+)\s+(?P<ref>[ACGT])\s*>\s*(?P<alt>[ACGT])\b",
    re.I,
)
_EXPLORE = re.compile(r"\b(show|research|whether|known variants|evidence|literature)\b", re.I)


def parse_intent(text: str) -> dict[str, Any]:
    clean = " ".join(text.split())
    if _REFUSE.search(clean):
        return {
            "operation": "refuse",
            "reason": "outside research-use exploration",
            "genes": [],
            "prompt_excerpt_redacted": clean[:240],
        }
    allele = _ALLELE.search(clean)
    genes = [token for token in _GENE.findall(clean) if token not in _STOP]
    # One symbol is a request to resolve it. Several symbols stay ambiguous.
    operation = "propose_edit" if allele else "explore"
    return {
        "operation": operation,
        "organism": "Homo sapiens",
        "assembly": "GRCh38",
        "genes": genes[:4],
        "ambiguous": len(genes) > 1,
        "allele": None
        if not allele
        else {
            "contig": allele.group("contig"),
            "position": int(allele.group("pos")),
            "ref": allele.group("ref").upper(),
            "alt": allele.group("alt").upper(),
        },
        "explore": bool(_EXPLORE.search(clean)) or not allele,
        "prompt_excerpt_redacted": clean[:240],
        "anatomy_hint": "skin" if re.search(r"pigment|skin|uv|ultraviolet", clean, re.I) else None,
    }
