"""Refuse genomic, personal, and secret payloads before any remote call."""

from __future__ import annotations

import re

from services.integrations.voyage.errors import UnsafePayload

_DNA = re.compile(r"[ACGTNacgtn]{41,}")
_VCF = re.compile(r"(?i)(##fileformat=VCF|#CHROM\t)")
_SECRET = re.compile(
    r"(?i)(canary_secret|diamond_canary|sk-[a-z0-9]{8,}|mongodb\+srv://|"
    r"bearer\s+[a-z0-9._\-]{8,}|api[_-]?key\s*[:=]\s*\S+|authorization:\s*\S+)"
)
_PERSONAL = re.compile(r"(?i)(\bpatient[-_ ]?id\b|\bsample[-_ ]?id\b|\bSAM\d{3,}\b)")
_INSTRUCTION = re.compile(
    r"(?i)(ignore (all|any|previous)|system prompt|<\||tool[ _]?call|you are now)"
)


def assert_safe_for_remote(text: str) -> None:
    """Raise UnsafePayload when text must not leave the process."""
    if _DNA.search(text) or _VCF.search(text):
        raise UnsafePayload("genomic_content")
    if _SECRET.search(text):
        raise UnsafePayload("secret_material")
    if _PERSONAL.search(text):
        raise UnsafePayload("personal_identifier")


def neutralize_source_text(text: str) -> str:
    """Keep the source words, but mark instruction-shaped lines as quotations."""
    lines: list[str] = []
    for line in text.splitlines() or [text]:
        if _INSTRUCTION.search(line):
            lines.append("[quoted source, not an instruction] " + line)
        else:
            lines.append(line)
    return "\n".join(lines)


def redact_secret(text: str, secret: str) -> str:
    if secret and secret in text:
        return text.replace(secret, "[redacted]")
    return text
