"""Structure-aware chunking.

A naive character splitter cuts mid-sentence and throws away the heading that
gave the text its meaning. This splitter:

1. Segments on Markdown/heading structure first, tracking a breadcrumb.
2. Packs whole paragraphs — and, when a paragraph is oversized, whole
   sentences — up to the target size.
3. Overlaps by trailing *sentences* rather than raw characters.
4. Prefixes every chunk with its breadcrumb so the embedding carries context
   ("Stellar Protocol › Consensus › ..." embeds very differently from a bare
   paragraph about "validators").

The breadcrumb also becomes the citation label in the UI.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.core.config import settings
from app.services.loaders import LoadedDocument

_HEADING = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
_UNDERLINE_H1 = re.compile(r"^={3,}\s*$")
_UNDERLINE_H2 = re.compile(r"^-{3,}\s*$")
_SENTENCE_END = re.compile(r"(?<=[.!?…])\s+(?=[A-Z0-9\"'(\[])|\n(?=[-*•]\s)")


@dataclass(slots=True)
class Chunk:
    text: str
    index: int
    page: int | None
    section: str
    char_start: int
    char_end: int
    metadata: dict[str, object] = field(default_factory=dict)

    @property
    def token_estimate(self) -> int:
        return max(1, len(self.text) // 4)


def split_sentences(text: str) -> list[str]:
    parts = [s.strip() for s in _SENTENCE_END.split(text) if s and s.strip()]
    return parts or ([text.strip()] if text.strip() else [])


def _breadcrumb(stack: list[tuple[int, str]]) -> str:
    return " › ".join(title for _, title in stack)


def _segment_by_heading(text: str) -> list[tuple[str, str]]:
    """Split into ``(breadcrumb, body)`` segments following heading structure."""
    lines = text.split("\n")
    stack: list[tuple[int, str]] = []
    segments: list[tuple[str, str]] = []
    buffer: list[str] = []

    def flush() -> None:
        body = "\n".join(buffer).strip()
        if body:
            segments.append((_breadcrumb(stack), body))
        buffer.clear()

    index = 0
    while index < len(lines):
        line = lines[index]
        heading_match = _HEADING.match(line)

        # Setext-style headings: "Title" followed by "===" or "---".
        underline_level = 0
        if not heading_match and index + 1 < len(lines) and line.strip():
            if _UNDERLINE_H1.match(lines[index + 1]):
                underline_level = 1
            elif _UNDERLINE_H2.match(lines[index + 1]):
                underline_level = 2

        if heading_match or underline_level:
            flush()
            if heading_match:
                level, title = len(heading_match.group(1)), heading_match.group(2)
            else:
                level, title = underline_level, line.strip()
                index += 1  # consume the underline
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, title.strip()))
        else:
            buffer.append(line)
        index += 1

    flush()
    return segments or [("", text.strip())]


def _pack(
    units: list[str], target: int, overlap: int, joiner: str
) -> list[tuple[str, int]]:
    """Greedily pack units into ~target-sized windows with trailing overlap.

    Returns ``(text, start_unit_index)`` so callers can map back to offsets.
    """
    windows: list[tuple[str, int]] = []
    current: list[str] = []
    current_start = 0
    length = 0

    for position, unit in enumerate(units):
        unit_length = len(unit) + len(joiner)
        if current and length + unit_length > target:
            windows.append((joiner.join(current), current_start))

            # Carry back whole trailing units until the overlap budget is met.
            carried: list[str] = []
            carried_length = 0
            back = 0
            while back < len(current) and carried_length < overlap:
                candidate = current[-1 - back]
                carried_length += len(candidate) + len(joiner)
                carried.insert(0, candidate)
                back += 1

            current = carried
            current_start = position - len(carried)
            length = carried_length

        current.append(unit)
        length += unit_length

    if current:
        windows.append((joiner.join(current), current_start))
    return windows


def chunk_document(
    document: LoadedDocument,
    *,
    chunk_size: int | None = None,
    chunk_overlap: int | None = None,
) -> list[Chunk]:
    size = chunk_size or settings.chunk_size
    overlap = chunk_overlap or settings.chunk_overlap
    chunks: list[Chunk] = []
    running_offset = 0

    for page in document.pages:
        for section, body in _segment_by_heading(page.text):
            paragraphs = [p.strip() for p in body.split("\n\n") if p.strip()]
            if not paragraphs:
                continue

            # Explode any paragraph that alone exceeds the window.
            units: list[str] = []
            for paragraph in paragraphs:
                if len(paragraph) <= size:
                    units.append(paragraph)
                else:
                    units.extend(
                        w for w, _ in _pack(split_sentences(paragraph), size, overlap, " ")
                    )

            for text, _ in _pack(units, size, overlap, "\n\n"):
                prefixed = f"{section}\n\n{text}" if section else text
                chunks.append(
                    Chunk(
                        text=prefixed,
                        index=len(chunks),
                        page=page.page,
                        section=section,
                        char_start=running_offset,
                        char_end=running_offset + len(text),
                        metadata={
                            "raw_length": len(text),
                            "has_section": bool(section),
                        },
                    )
                )
                running_offset += len(text)

    return chunks
