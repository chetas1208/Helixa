"""Deterministic V14 command grammar. Never creates a proposal or revision."""

from __future__ import annotations

import re
from typing import Any

from services.runtime.genome_edit.llm import suggest_intent
from services.runtime.genome_edit.references import (
    GRCH38_ASSET_ID,
    SYNTHETIC_ASSET_ID,
    lookup_gene,
    lookup_locus,
    resolve_anatomy_mentions,
    resolve_reference,
    try_base_at,
)
from services.runtime.genome_workspace.reference import ASSEMBLY as SYNTHETIC_ASSEMBLY
from services.runtime.genome_workspace.reference import CONTIG as SYNTHETIC_CONTIG

PARSER_ID = "deterministic-v14"
_BASE = "ACGT"
_TRAIT_WHY = (
    "This is a polygenic or environmentally influenced goal. "
    "No single substitution is a validated edit for that outcome, "
    "and the parser will not invent one."
)

_RESEARCH_FIXED = {
    "evidence": "Research retrieval required",
    "candidate_edit": "Pending evidence-based identification",
    "dna_rendering": "Available after validated edit",
    "body_rendering": "Hypothetical unless supported",
    "approval": "Required before applying",
}
_RESEARCH_AREAS: dict[str, tuple[str, str]] = {
    "ultraviolet resistance": ("Explore increased UV tolerance", "Pigmentation and DNA repair"),
    "eye colour": ("Explore eye colour", "Iris pigmentation"),
    "stronger legs": ("Explore greater leg strength", "Skeletal muscle"),
    "stronger arms": ("Explore greater arm strength", "Skeletal muscle"),
    "smarter brain": ("Explore cognition", "Nervous system"),
    "bigger hands": ("Explore hand size", "Limb development"),
    "bigger muscles": ("Explore muscle size", "Skeletal muscle"),
    "survive extreme cold": ("Explore cold tolerance", "Thermoregulation and metabolism"),
    "taller stature": ("Explore stature", "Skeletal growth"),
    "better eyesight": ("Explore eyesight", "Visual system"),
    "intelligence": ("Explore cognition", "Nervous system"),
    "super strength": ("Explore greater strength", "Skeletal muscle"),
    "unspecified trait goal": ("Explore a described biological change", "Not yet classified"),
    "trait wish": ("Explore a described biological change", "Not yet classified"),
}
_UV_ANATOMY = "UBERON:0002097"
_PHENOTYPE_WISH = re.compile(
    r"\b(?:make|help|increase|decrease|improve)\b.*\b(?:organism|resistant|resistance|tolerate|tolerance|pigment\w*|ultraviolet|radiation)\b",
    re.I,
)
_SEQUENCE_TALK = re.compile(r"\b(?:base|position|nucleotide|allele|locus|grch38)\b", re.I)

_TRAIT_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b(?:ultraviolet|uv\s+radiation|uv\s+resist\w*)\b", re.I), "ultraviolet resistance"),
    (re.compile(r"\beye\s+colou?rs?\b", re.I), "eye colour"),
    (re.compile(r"\bstronger\s+legs\b", re.I), "stronger legs"),
    (re.compile(r"\bstronger\s+arms\b", re.I), "stronger arms"),
    (re.compile(r"\bsmarter\s+brain\b", re.I), "smarter brain"),
    (re.compile(r"\b(?:bigger\s+hands|hands\s+bigger)\b", re.I), "bigger hands"),
    (re.compile(r"\bbigger\s+(?:muscles|arms|legs)\b", re.I), "bigger muscles"),
    (re.compile(r"\bsurvive(?:\s+\w+){0,3}\s+cold\b", re.I), "survive extreme cold"),
    (re.compile(r"\bextreme\s+cold\b", re.I), "survive extreme cold"),
    (re.compile(r"\bmake\s+me\s+taller\b", re.I), "taller stature"),
    (re.compile(r"\bbetter\s+eyesight\b", re.I), "better eyesight"),
    (re.compile(r"\benhance\s+intelligence\b", re.I), "intelligence"),
    (re.compile(r"\bsuper\s+strength\b", re.I), "super strength"),
    (re.compile(r"\b(cure|fix|improve|enhance)\s+my\b", re.I), "unspecified trait goal"),
]

_UNSUPPORTED = re.compile(
    r"\b(crispr\s+the\s+whole|download\s+patient|predict\s+(?:if|whether)|"
    r"will\s+i\s+get\s+cancer|design\s+a\s+virus|off[\s-]?target\s+guide)\b",
    re.I,
)

_CHANGE_VERB = re.compile(r"\b(change|edit|mutate|replace|substitute|set)\b", re.I)

_EDIT_POSITION_FROM_TO = re.compile(
    r"(?:change|set|edit|mutate|replace|substitute)\s+"
    r"(?:(?:the\s+)?(?:position|base|pos(?:ition)?\.?|locus)\s+)?"
    r"(?P<pos>\d+)"
    r"(?:\s+from\s+(?P<ref>[ACGT]))?"
    r"\s+(?:to|>|→)\s+(?P<alt>[ACGT])\b",
    re.I,
)
_EDIT_AT = re.compile(
    r"(?:change|set|edit|mutate|replace|substitute)\s+"
    r"(?P<ref>[ACGT])\s+to\s+(?P<alt>[ACGT])\s+at\s+(?:position\s+)?(?P<pos>\d+)\b",
    re.I,
)
_EDIT_GT = re.compile(
    r"\b(?P<ref>[ACGT])\s*>\s*(?P<alt>[ACGT])\s+at\s+(?:position\s+)?(?P<pos>\d+)\b",
    re.I,
)
_EDIT_CHR = re.compile(
    r"\b(?:chr)?(?P<contig>\d+|X|Y|MT)\s*:\s*(?P<pos>\d+)\s+"
    r"(?:from\s+)?(?P<ref>[ACGT])\s*(?:>|to|→|-)\s*(?P<alt>[ACGT])\b",
    re.I,
)
_EDIT_VCF = re.compile(
    r"\b(?:chr)?(?P<contig>\d+|X|Y|MT)-(?P<pos>\d+)-(?P<ref>[ACGT])-(?P<alt>[ACGT])\b",
    re.I,
)

_SHOW_SEQUENCE = re.compile(
    r"\b(?:show|open|display|view)\s+(?:the\s+)?(?:sequence|bases|locus|window)\b",
    re.I,
)
_SHOW_GENE_TISSUES = re.compile(
    r"\b(?:where\s+is|tissues?\s+(?:for|of)|expressed\s+in|expression\s+(?:for|of)|"
    r"show\s+(?:gene\s+)?tissues?)\b",
    re.I,
)
_SHOW_GENES = re.compile(
    r"\b(?:show|list|what|which)\s+genes?\b|\bgenes?\s+(?:in|for|at|expressed)\b",
    re.I,
)
_FOCUS = re.compile(
    r"\b(?:focus|go\s+to|open|select|show)\s+(?:on\s+)?(?:the\s+)?(?P<rest>.+)$",
    re.I,
)
_GENE_TOKEN = re.compile(r"\b(ENSG\d{11}|[A-Z][A-Z0-9]{1,11})\b")
_LOCUS_TOKEN = re.compile(r"\b(grch38:[A-Za-z0-9-]+:[0-9A-Z]+:\d+-\d+)\b", re.I)


def interpret_command(body: dict[str, Any]) -> dict[str, Any]:
    """Pure parse. Does not write workspace state."""
    text = str(body.get("text") or "").strip()
    source = body.get("source") or "text"
    if source not in {"text", "voice"}:
        source = "text"
    selection = body.get("selection") if isinstance(body.get("selection"), dict) else {}
    if not text:
        return _result(
            "NEEDS_CLARIFICATION",
            source,
            reason="Type a body part, a gene, or a precise substitution such as: change position 6 from G to A.",
        )

    trait = _trait_goal(text, selection)
    if trait is not None:
        extra = suggest_intent(text)
        result = _result("TRAIT_GOAL", source, reason=trait["why_not_automatic"], trait_goal=trait)
        if extra:
            result["llm_suggestion"] = extra
        return result

    if _UNSUPPORTED.search(text):
        return _result(
            "UNSUPPORTED",
            source,
            reason="That request is outside this editor. Explore a named body part or propose one substitution on a pinned locus.",
        )

    parsed_edit = _parse_precise_edit(text, selection)
    if parsed_edit is not None:
        return _clarify_or_edit(parsed_edit, source)

    explore = _parse_explore(text, selection)
    if explore is not None:
        return _result(
            "EXPLORE",
            source,
            reason=explore.pop("reason"),
            explore=explore,
        )

    if _CHANGE_VERB.search(text):
        return _result(
            "NEEDS_CLARIFICATION",
            source,
            reason="Say a genomic position and a base, for example: change position 6 from G to A.",
        )

    return _result(
        "UNSUPPORTED",
        source,
        reason="Could not classify that as explore, a precise substitution, or a trait goal.",
    )


def _result(
    intent: str,
    source: str,
    *,
    reason: str,
    explore: dict[str, Any] | None = None,
    edit: dict[str, Any] | None = None,
    trait_goal: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "intent": intent,
        "explore": explore,
        "edit": edit,
        "trait_goal": trait_goal,
        "reason": reason,
        "parser": PARSER_ID,
        "source": source,
    }


def _research_record(topic: str) -> dict[str, str]:
    user_intent, research_area = _RESEARCH_AREAS.get(
        topic,
        (f"Explore {topic}", "Not yet classified"),
    )
    return {"user_intent": user_intent, "research_area": research_area, **_RESEARCH_FIXED}


def _trait_goal(text: str, selection: dict[str, Any]) -> dict[str, Any] | None:
    topic = None
    for pattern, label in _TRAIT_RULES:
        if pattern.search(text):
            topic = label
            break
    if topic is None and _PHENOTYPE_WISH.search(text) and not _SEQUENCE_TALK.search(text):
        topic = "ultraviolet resistance" if re.search(r"ultraviolet|uv\s+radiation", text, re.I) else "trait wish"
    if topic is None:
        return None
    anatomy_ids = [value for value in [selection.get("anatomy_id")] if value]
    anatomy_ids.extend(aid for aid in resolve_anatomy_mentions(text) if aid not in anatomy_ids)
    if topic == "ultraviolet resistance" and _UV_ANATOMY not in anatomy_ids:
        anatomy_ids.append(_UV_ANATOMY)
    return {
        "topic": topic,
        "why_not_automatic": _TRAIT_WHY,
        "related_anatomy_ids": anatomy_ids,
        "explore_actions": ["show_genes", "focus_anatomy"],
        "complexity_notes": [
            "Many loci and tissues can be involved.",
            "Tissue expression is not evidence that an edit would change this trait.",
            "A candidate edit stays pending until published evidence and a valid reference identify one.",
        ],
        "research": _research_record(topic),
    }


def _parse_precise_edit(text: str, selection: dict[str, Any]) -> dict[str, Any] | None:
    match = _EDIT_CHR.search(text) or _EDIT_VCF.search(text)
    if match:
        return _edit_from_match(match, selection, contig=match.group("contig"))
    match = _EDIT_POSITION_FROM_TO.search(text) or _EDIT_AT.search(text) or _EDIT_GT.search(text)
    if match:
        return _edit_from_match(match, selection, contig=None)
    return None


def _edit_from_match(match: re.Match[str], selection: dict[str, Any], contig: str | None) -> dict[str, Any]:
    position = int(match.group("pos"))
    groups = match.groupdict()
    stated_ref = groups["ref"].upper() if groups.get("ref") else None
    alt = groups["alt"].upper()
    locus_id = selection.get("locus_id")
    token = _LOCUS_TOKEN.search(match.string)
    if token:
        locus_id = token.group(1)
    if not locus_id and contig and not str(contig).lower().startswith("chr"):
        # Chromosome-qualified coordinates default to the GRCh38 asset when Agent 2 can answer.
        reference_asset_id = GRCH38_ASSET_ID
        assembly = "GRCh38"
        contig_id = str(contig)
    elif locus_id and str(locus_id).startswith("grch38:"):
        reference_asset_id = GRCH38_ASSET_ID
        assembly = "GRCh38"
        contig_id = contig or _contig_from_locus(locus_id)
    else:
        reference_asset_id = SYNTHETIC_ASSET_ID
        assembly = SYNTHETIC_ASSEMBLY
        contig_id = contig or SYNTHETIC_CONTIG
        if contig and str(contig).lower().startswith("chr"):
            contig_id = str(contig)
    resolved = resolve_reference(reference_asset_id, locus_id, contig_id)
    return {
        "locus_id": resolved.get("locus_id") or locus_id,
        "reference_asset_id": resolved["reference_asset_id"],
        "assembly": resolved["assembly"] or assembly,
        "contig": resolved["contig"] or contig_id,
        "position": position,
        "stated_ref": stated_ref,
        "alt": alt,
    }


def _contig_from_locus(locus_id: str) -> str:
    parts = locus_id.split(":")
    return parts[2] if len(parts) >= 4 else ""


def _clarify_or_edit(edit: dict[str, Any], source: str) -> dict[str, Any]:
    stated = edit.get("stated_ref")
    if stated:
        actual, error = try_base_at(edit["reference_asset_id"], edit["position"], edit.get("locus_id"))
        if error and edit["reference_asset_id"] == GRCH38_ASSET_ID:
            return _result(
                "NEEDS_CLARIFICATION",
                source,
                reason=f"Cannot check the stated REF against a pinned GRCh38 slice ({error}).",
                edit=edit,
            )
        if error:
            return _result("NEEDS_CLARIFICATION", source, reason=error, edit=edit)
        if actual is not None and stated != actual:
            return _result(
                "NEEDS_CLARIFICATION",
                source,
                reason=f"baseline at {edit['position']} is {actual}, not {stated}",
                edit={**edit, "actual_ref": actual},
            )
    return _result(
        "PRECISE_EDIT",
        source,
        reason="Parsed a single substitution. This did not create a proposal.",
        edit=edit,
    )


def _parse_explore(text: str, selection: dict[str, Any]) -> dict[str, Any] | None:
    gene_ids = _gene_ids(text, selection)
    locus_id = selection.get("locus_id")
    token = _LOCUS_TOKEN.search(text)
    if token:
        locus_id = token.group(1)
        record = lookup_locus(locus_id)
        if record and record.get("gene_id") and record["gene_id"] not in gene_ids:
            gene_ids.append(record["gene_id"])
    anatomy_ids = [value for value in [selection.get("anatomy_id")] if value]
    anatomy_ids.extend(aid for aid in resolve_anatomy_mentions(text) if aid not in anatomy_ids)

    if _SHOW_GENE_TISSUES.search(text):
        return {
            "action": "show_gene_tissues",
            "anatomy_ids": anatomy_ids,
            "gene_ids": gene_ids,
            "locus_id": locus_id,
            "reason": "Showing tissue evidence for the named gene, when a source can answer.",
        }
    if _SHOW_SEQUENCE.search(text):
        return {
            "action": "show_sequence",
            "anatomy_ids": anatomy_ids,
            "gene_ids": gene_ids,
            "locus_id": locus_id,
            "reason": "Opening the pinned sequence window. This is not an edit.",
        }
    if _SHOW_GENES.search(text):
        return {
            "action": "show_genes",
            "anatomy_ids": anatomy_ids,
            "gene_ids": gene_ids,
            "locus_id": locus_id,
            "reason": "Listing genes with evidence in the selected anatomy, when a source can answer.",
        }
    focus = _FOCUS.search(text)
    if focus and (anatomy_ids or _looks_like_anatomy_request(text)):
        return {
            "action": "focus_anatomy",
            "anatomy_ids": anatomy_ids,
            "gene_ids": gene_ids,
            "locus_id": locus_id,
            "reason": "Focusing the named anatomy. Selection is not a workspace change.",
        }
    return None


def _looks_like_anatomy_request(text: str) -> bool:
    return bool(
        re.search(
            r"\b(heart|hand|lung|liver|brain|eye|kidney|skin|bone|muscle|liver|stomach|"
            r"left|right|arm|leg|head|face|spine)\b",
            text,
            re.I,
        )
    )


def _gene_ids(text: str, selection: dict[str, Any]) -> list[str]:
    found: list[str] = []
    selected = selection.get("gene_id")
    if selected:
        found.append(selected)
    for token in _GENE_TOKEN.findall(text):
        if token in {"DNA", "RNA", "REF", "ALT", "CHR", "TO", "FROM", "AT", "IN"}:
            continue
        record = lookup_gene(token)
        gene_id = (record or {}).get("gene_id") if record else None
        if token.startswith("ENSG") and token not in found:
            found.append(token)
        elif gene_id and gene_id not in found:
            found.append(gene_id)
    return found
