"""Answer generation: grounded prompting, citations, confidence, follow-ups.

Anti-hallucination measures, in order of importance:

1. The context is numbered and the model is required to attach ``[n]`` markers
   to every factual claim. Uncited claims are visible to the reader.
2. The model is told, explicitly and with an example, to refuse when the
   context does not support an answer.
3. Temperature is low and the context window is capped so nothing silently
   falls off the end.
4. Confidence is computed from *retrieval* evidence and *citation coverage* —
   not from asking the model how sure it is, which models are bad at.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

from app.core.config import settings
from app.core.errors import ServiceUnavailableError
from app.services.vector_store import ScoredChunk

logger = logging.getLogger(__name__)

FOLLOW_UP_SENTINEL = "<<<FOLLOW_UP>>>"
MAX_CONTEXT_CHARS = 24_000

_CITATION = re.compile(r"\[(\d{1,2})\]")
_REFUSAL_MARKERS = (
    "does not contain",
    "doesn't contain",
    "not covered in",
    "no information",
    "cannot answer",
    "can't answer",
    "not enough information",
    "insufficient information",
    "the provided context does not",
    "i don't have enough",
)

SYSTEM_PROMPT = """You are the retrieval analyst for {app_name}, a paid knowledge API. \
Agents pay per answer, so accuracy matters more than fluency.

RULES — follow all of them:
1. Answer using ONLY the numbered CONTEXT blocks below. Never use outside knowledge, \
never guess, never fill gaps with plausible-sounding detail.
2. Attach a citation marker to every factual sentence, using the block number: \
"Stellar settles in 3-5 seconds [2]." Cite multiple blocks as [1][3] when a claim \
draws on several.
3. If the context does not answer the question, say so plainly in one sentence, \
state what IS available, and stop. Do not apologise at length. Example: \
"The context doesn't cover pricing tiers. It does describe the per-query x402 \
payment flow [1]."
4. Prefer specific numbers, names and terms from the context over paraphrase.
5. Format for reading: short paragraphs, bullet lists for enumerations, \
Markdown for structure. Do not repeat the question back.
6. Keep the answer under 280 words unless the question demands a list.

After the answer, output the line {sentinel} on its own, then exactly three \
follow-up questions the reader could ask next, one per line, each prefixed with \
"- ". They must be answerable from the same context and must not repeat the \
original question."""


@dataclass(slots=True)
class Citation:
    marker: int
    chunk_id: str
    document_id: str
    document_title: str
    locator: str
    section: str
    page: int | None
    score: float
    #: Full chunk text — what the model reads.
    text: str
    #: Trimmed preview — what the UI renders in the citation rail.
    snippet: str
    used: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "marker": self.marker,
            "chunk_id": self.chunk_id,
            "document_id": self.document_id,
            "document_title": self.document_title,
            "locator": self.locator,
            "section": self.section,
            "page": self.page,
            "score": round(self.score, 4),
            "snippet": self.snippet,
            "used": self.used,
        }


@dataclass(slots=True)
class Confidence:
    score: float
    label: str
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "score": round(self.score, 3),
            "percent": round(self.score * 100),
            "label": self.label,
            "reasons": self.reasons,
        }


def build_citations(chunks: list[ScoredChunk]) -> list[Citation]:
    return [
        Citation(
            marker=index,
            chunk_id=chunk.chunk_id,
            document_id=chunk.document_id,
            document_title=chunk.document_title,
            locator=chunk.locator,
            section=chunk.section,
            page=chunk.page,
            score=chunk.score,
            text=chunk.text,
            snippet=chunk.body[:700],
        )
        for index, chunk in enumerate(chunks, start=1)
    ]


def build_context(citations: list[Citation]) -> str:
    """Numbered context blocks, packed whole so no passage is cut mid-sentence."""
    blocks: list[str] = []
    budget = MAX_CONTEXT_CHARS
    for citation in citations:
        block = f"[{citation.marker}] SOURCE: {citation.locator}\n{citation.text}"
        if len(block) > budget:
            break  # dropping a whole block beats truncating one
        blocks.append(block)
        budget -= len(block)
    return "\n\n---\n\n".join(blocks)


def _format_history(history: list[dict[str, str]]) -> str:
    if not history:
        return ""
    lines = [
        f"{'User' if turn['role'] == 'user' else 'Assistant'}: {turn['content'][:400]}"
        for turn in history[-6:]
    ]
    return "CONVERSATION SO FAR (for pronoun resolution only):\n" + "\n".join(lines)


def build_prompt(
    question: str, citations: list[Citation], history: list[dict[str, str]] | None = None
) -> tuple[str, str]:
    system = SYSTEM_PROMPT.format(
        app_name=settings.app_name, sentinel=FOLLOW_UP_SENTINEL
    )
    parts = [f"CONTEXT:\n\n{build_context(citations)}"]
    conversation = _format_history(history or [])
    if conversation:
        parts.append(conversation)
    parts.append(f"QUESTION: {question}")
    return system, "\n\n".join(parts)


def _get_llm(
    streaming: bool = False,
    *,
    model: str | None = None,
    temperature: float | None = None,
):
    """Build a client. Marketplace providers override model and temperature."""
    if not settings.gemini_enabled:
        raise ServiceUnavailableError(
            "GEMINI_API_KEY is not configured. Add it to backend/.env to enable "
            "answer generation.",
            details={"missing_env": "GEMINI_API_KEY"},
        )
    from langchain_google_genai import ChatGoogleGenerativeAI

    return ChatGoogleGenerativeAI(
        model=model or settings.gemini_model,
        google_api_key=settings.gemini_api_key,
        temperature=settings.gemini_temperature if temperature is None else temperature,
        max_output_tokens=settings.gemini_max_output_tokens,
        disable_streaming=not streaming,
    )


def stream_completion(
    system: str,
    user: str,
    *,
    model: str | None = None,
    temperature: float | None = None,
) -> Iterator[str]:
    """Yield raw text deltas from Gemini."""
    from langchain_core.messages import HumanMessage, SystemMessage

    messages = [SystemMessage(content=system), HumanMessage(content=user)]
    try:
        stream = _get_llm(
            streaming=True, model=model, temperature=temperature
        ).stream(messages)
        for part in stream:
            text = part.content
            if isinstance(text, list):  # multimodal parts
                text = "".join(p for p in text if isinstance(p, str))
            if text:
                yield str(text)
    except ServiceUnavailableError:
        raise
    except Exception as exc:
        logger.exception("Gemini streaming failed")
        raise ServiceUnavailableError(
            "The language model is temporarily unavailable. Your credit was not spent."
        ) from exc


def complete(
    system: str,
    user: str,
    *,
    model: str | None = None,
    temperature: float | None = None,
) -> str:
    from langchain_core.messages import HumanMessage, SystemMessage

    messages = [SystemMessage(content=system), HumanMessage(content=user)]
    try:
        response = _get_llm(model=model, temperature=temperature).invoke(messages)
    except ServiceUnavailableError:
        raise
    except Exception as exc:
        logger.exception("Gemini completion failed")
        raise ServiceUnavailableError(
            "The language model is temporarily unavailable. Your credit was not spent."
        ) from exc

    content = response.content
    if isinstance(content, list):
        content = "".join(p for p in content if isinstance(p, str))
    return str(content).strip()


class FollowUpSplitter:
    """Splits a stream into answer text and trailing follow-up questions.

    The model emits the sentinel between the two. Because the sentinel can
    arrive split across chunk boundaries, we hold back a small tail until we
    know it is not the start of one.
    """

    def __init__(self, sentinel: str = FOLLOW_UP_SENTINEL) -> None:
        self.sentinel = sentinel
        self._buffer = ""
        self._tail = ""
        self._done = False

    def push(self, delta: str) -> str:
        if self._done:
            self._buffer += delta
            return ""

        pending = self._tail + delta
        index = pending.find(self.sentinel)
        if index != -1:
            self._done = True
            emit = pending[:index]
            self._buffer = pending[index + len(self.sentinel) :]
            self._tail = ""
            return emit

        # Hold back anything that could be a partial sentinel.
        hold = 0
        for size in range(min(len(self.sentinel) - 1, len(pending)), 0, -1):
            if self.sentinel.startswith(pending[-size:]):
                hold = size
                break
        self._tail = pending[len(pending) - hold :] if hold else ""
        return pending[: len(pending) - hold] if hold else pending

    def finish(self) -> str:
        if self._done or not self._tail:
            return ""
        remaining, self._tail = self._tail, ""
        return remaining

    @property
    def follow_ups(self) -> list[str]:
        return parse_follow_ups(self._buffer)


def parse_follow_ups(raw: str) -> list[str]:
    questions: list[str] = []
    for line in raw.splitlines():
        cleaned = line.strip().lstrip("-*•").strip()
        cleaned = re.sub(r"^\d+[.)]\s*", "", cleaned)
        if len(cleaned) > 10 and cleaned.endswith("?"):
            questions.append(cleaned)
    return questions[:3]


def split_answer(raw: str) -> tuple[str, list[str]]:
    if FOLLOW_UP_SENTINEL in raw:
        answer, _, tail = raw.partition(FOLLOW_UP_SENTINEL)
        return answer.strip(), parse_follow_ups(tail)
    return raw.strip(), []


def mark_used_citations(answer: str, citations: list[Citation]) -> list[int]:
    used = {int(m) for m in _CITATION.findall(answer)}
    for citation in citations:
        citation.used = citation.marker in used
    return sorted(used)


def score_confidence(
    answer: str,
    citations: list[Citation],
    *,
    top_score: float,
    mean_score: float,
) -> Confidence:
    """Blend retrieval evidence with how well the answer is anchored to it."""
    lowered = answer.lower()
    reasons: list[str] = []

    if any(marker in lowered for marker in _REFUSAL_MARKERS):
        return Confidence(
            score=0.12,
            label="No answer in sources",
            reasons=["The model reported that the knowledge base does not cover this."],
        )

    used = [c for c in citations if c.used]
    coverage = len(used) / max(1, min(len(citations), 4))
    coverage = min(1.0, coverage)

    sentences = [s for s in re.split(r"(?<=[.!?])\s+", answer) if len(s.strip()) > 25]
    cited_sentences = sum(1 for s in sentences if _CITATION.search(s))
    density = cited_sentences / len(sentences) if sentences else 0.0

    score = 0.42 * top_score + 0.18 * mean_score + 0.22 * coverage + 0.18 * density

    if top_score >= 0.75:
        reasons.append(f"Strong top match ({top_score:.0%} similarity).")
    elif top_score >= 0.5:
        reasons.append(f"Moderate top match ({top_score:.0%} similarity).")
    else:
        reasons.append(f"Weak top match ({top_score:.0%} similarity).")

    if used:
        reasons.append(f"Answer cites {len(used)} of {len(citations)} retrieved passages.")
    else:
        reasons.append("Answer contains no citation markers.")
        score *= 0.6

    if density >= 0.7:
        reasons.append("Nearly every claim is anchored to a source.")
    elif density < 0.34 and sentences:
        reasons.append("Several claims are not individually cited.")

    if len(citations) == 1:
        reasons.append("Only one passage was relevant enough to use.")
        score *= 0.9

    score = max(0.03, min(0.99, score))
    if score >= 0.78:
        label = "High confidence"
    elif score >= 0.55:
        label = "Moderate confidence"
    elif score >= 0.3:
        label = "Low confidence"
    else:
        label = "Very low confidence"

    return Confidence(score=score, label=label, reasons=reasons)


def estimate_tokens(*texts: str) -> int:
    """~4 characters per token — good enough for cost display, and free."""
    return max(1, sum(len(t) for t in texts) // 4)


# ── Document intelligence ────────────────────────────────────────────────────

_SUMMARY_PROMPT = """Summarise the document below for a knowledge-base catalogue.

Return exactly this shape and nothing else:
SUMMARY: <two sentences, max 45 words, describing what a reader can learn here>
TOPICS: <4 to 6 comma-separated topic keywords, lowercase>

DOCUMENT (truncated):
{excerpt}"""


def summarise_document(title: str, excerpt: str) -> tuple[str | None, list[str]]:
    """Best-effort catalogue entry. Never fails an upload."""
    if not settings.gemini_enabled:
        return None, []
    try:
        raw = complete(
            "You write terse, factual catalogue entries. No preamble, no markdown.",
            _SUMMARY_PROMPT.format(excerpt=excerpt[:6000]),
        )
    except Exception:
        logger.warning("Document summarisation failed for %s", title, exc_info=True)
        return None, []

    summary: str | None = None
    topics: list[str] = []
    for line in raw.splitlines():
        if line.upper().startswith("SUMMARY:"):
            summary = line.split(":", 1)[1].strip() or None
        elif line.upper().startswith("TOPICS:"):
            topics = [
                t.strip().lower()
                for t in line.split(":", 1)[1].split(",")
                if 1 < len(t.strip()) < 40
            ][:6]
    if summary is None and raw:
        summary = raw.strip().split("\n")[0][:220]
    return summary, topics
