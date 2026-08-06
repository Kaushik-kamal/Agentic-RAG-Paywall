"""The intelligent routing agent.

Given a request and no prior knowledge of who can serve it, the agent:

1. **Understands intent** — embeds the request and compares it against every
   provider's own capability statement, reinforced by keyword evidence.
2. **Discovers and filters** — drops offline providers and those whose
   capability match falls below a floor. A provider that cannot help should not
   be ranked at all, however cheap it is.
3. **Ranks** on four weighted factors under a stated objective (balanced,
   cheapest, fastest, or best quality).
4. **Explains** — the rationale is derived from the score components, so it can
   never disagree with the decision. No language model narrates it.

Routing is deliberately LLM-free: it costs one embedding, runs in milliseconds,
and is fully deterministic, which is what a real router has to be.
"""

from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass, field
from typing import Any, Literal

from app.core.security import new_id
from app.db.database import execute, query_all
from app.db.repository import utcnow
from app.services import registry, reputation
from app.services.embeddings import embed_documents, embed_query
from app.services.retrieval import tokenize

logger = logging.getLogger(__name__)

Objective = Literal["balanced", "cheapest", "fastest", "quality"]

#: How each objective weights the four ranking factors. They sum to 1.
OBJECTIVE_WEIGHTS: dict[Objective, dict[str, float]] = {
    "balanced": {"capability": 0.50, "trust": 0.22, "price": 0.14, "latency": 0.14},
    "cheapest": {"capability": 0.40, "trust": 0.13, "price": 0.37, "latency": 0.10},
    "fastest": {"capability": 0.40, "trust": 0.13, "price": 0.10, "latency": 0.37},
    "quality": {"capability": 0.45, "trust": 0.40, "price": 0.05, "latency": 0.10},
}

OBJECTIVE_LABEL: dict[Objective, str] = {
    "balanced": "balanced value",
    "cheapest": "lowest cost",
    "fastest": "lowest latency",
    "quality": "highest expected quality",
}

#: A provider below this capability match is not a candidate at any price.
CAPABILITY_FLOOR = 0.18

#: A provider must reach this fraction of the best match to compete at all.
#: Without it, a cheap generalist beats the domain expert on price — which is
#: exactly the failure mode that makes automated routing untrustworthy.
RELATIVE_CAPABILITY_FLOOR = 0.55

#: How much price, speed and trust may move a score *within* a capability tier.
#: At 0.45 a perfectly-priced provider is worth ~1.8x a badly-priced one of the
#: same competence, but never enough to overturn a real capability gap.
COMMERCIAL_INFLUENCE = 0.45

_intent_vectors: dict[str, list[float]] = {}


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    return dot / (norm_a * norm_b) if norm_a and norm_b else 0.0


def _profile_text(provider: dict[str, Any]) -> str:
    return (
        f"{provider['name']}. {provider['tagline']}. {provider['description']} "
        f"Capabilities: {', '.join(provider['capabilities'])}. "
        f"Topics: {', '.join(provider['keywords'][:18])}."
    )


def _cache_key(provider: dict[str, Any]) -> str:
    return f"{provider['provider_id']}:{provider['created_at']}"


def warm_provider_vectors(providers: list[dict[str, Any]]) -> None:
    """Embed every unseen provider profile in one batched request.

    Done serially this is one API round-trip per provider and dominates the
    first routing decision; batched it is a single call.
    """
    missing = [p for p in providers if _cache_key(p) not in _intent_vectors]
    if not missing:
        return
    try:
        vectors = embed_documents([_profile_text(p) for p in missing])
    except Exception:
        logger.warning("Could not embed provider profiles; routing on keywords alone")
        return
    for provider, vector in zip(missing, vectors, strict=False):
        _intent_vectors[_cache_key(provider)] = vector


def _provider_vector(provider: dict[str, Any]) -> list[float] | None:
    return _intent_vectors.get(_cache_key(provider))


def _keyword_evidence(query: str, provider: dict[str, Any]) -> tuple[float, list[str]]:
    """Literal overlap between the request and the provider's declared topics.

    A multi-word phrase ("number needed to treat") is far stronger evidence than
    a single token ("treat"), and is weighted accordingly.
    """
    lowered = query.lower()
    tokens = set(tokenize(query))
    matched: list[str] = []
    weight = 0.0

    for keyword in provider["keywords"]:
        if " " in keyword:
            if keyword in lowered:
                matched.append(keyword)
                # A domain phrase like "number needed to treat" is nearly
                # conclusive on its own — no other provider uses that language.
                weight += 2.0
        elif keyword in tokens:
            matched.append(keyword)
            weight += 1.0

    # One domain phrase, or two plain tokens, is already convincing.
    return min(1.0, weight / 2.2), matched[:6]


@dataclass(slots=True)
class Candidate:
    provider: dict[str, Any]
    capability: float
    semantic: float
    keyword: float
    matched_keywords: list[str]
    trust: float
    price_score: float
    latency_score: float
    total: float
    eligible: bool
    reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        provider = self.provider
        return {
            "provider_id": provider["provider_id"],
            "slug": provider["slug"],
            "name": provider["name"],
            "tagline": provider["tagline"],
            "category": provider["category"],
            "accent": provider["accent"],
            "price_xlm": provider["price_xlm"],
            "credits_per_call": provider["credits_per_call"],
            "target_latency_ms": provider["target_latency_ms"],
            "status": provider["status"],
            "stats": provider["stats"],
            "reputation": provider["reputation"],
            "scores": {
                "capability": round(self.capability, 4),
                "semantic": round(self.semantic, 4),
                "keyword": round(self.keyword, 4),
                "trust": round(self.trust, 4),
                "price": round(self.price_score, 4),
                "latency": round(self.latency_score, 4),
                "total": round(self.total, 4),
            },
            "matched_keywords": self.matched_keywords,
            "eligible": self.eligible,
            "reason": self.reason,
        }


@dataclass(slots=True)
class RoutingDecision:
    decision_id: str
    query: str
    objective: Objective
    candidates: list[Candidate]
    chosen: Candidate | None
    runner_up: Candidate | None
    rationale: str
    tradeoffs: list[str]
    considered: int
    shortlisted: int
    decided_in_ms: int
    weights: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "decision_id": self.decision_id,
            "query": self.query,
            "objective": self.objective,
            "objective_label": OBJECTIVE_LABEL[self.objective],
            "weights": self.weights,
            "considered": self.considered,
            "shortlisted": self.shortlisted,
            "decided_in_ms": self.decided_in_ms,
            "chosen": self.chosen.to_dict() if self.chosen else None,
            "runner_up": self.runner_up.to_dict() if self.runner_up else None,
            "rationale": self.rationale,
            "tradeoffs": self.tradeoffs,
            "candidates": [candidate.to_dict() for candidate in self.candidates],
        }


def discover(
    query: str,
    *,
    objective: Objective = "balanced",
    limit: int | None = None,
) -> RoutingDecision:
    """Rank every provider in the network against a request."""
    started = time.perf_counter()
    decision_id = new_id("route")

    providers = reputation.enrich_all(registry.list_providers())
    weights = OBJECTIVE_WEIGHTS[objective]

    warm_provider_vectors(providers)

    try:
        query_vector: list[float] | None = embed_query(query)
    except Exception:
        query_vector = None
        logger.warning("Intent embedding unavailable; routing on keywords alone")

    prices = [p["price_xlm"] for p in providers] or [1.0]
    latencies = [p["target_latency_ms"] for p in providers] or [1]
    cheapest, dearest = min(prices), max(prices)
    quickest, slowest = min(latencies), max(latencies)

    def normalise(value: float, low: float, high: float) -> float:
        """1.0 for the best (lowest) value in the field, 0.0 for the worst."""
        if high <= low:
            return 1.0
        return 1.0 - (value - low) / (high - low)

    # ── Pass one: score capability for every provider ────────────────────────
    measured: list[tuple[dict[str, Any], float, float, float, list[str]]] = []
    for provider in providers:
        semantic = 0.0
        if query_vector is not None:
            vector = _provider_vector(provider)
            if vector is not None:
                # Cosine over text embeddings rarely drops below ~0.3 even for
                # unrelated text, so rescale the useful band to 0–1.
                semantic = max(0.0, min(1.0, (_cosine(query_vector, vector) - 0.30) / 0.45))

        keyword, matched = _keyword_evidence(query, provider)
        # Keyword hits are strong, precise evidence; semantic covers paraphrase.
        capability = max(semantic, keyword) * 0.75 + min(semantic, keyword) * 0.25
        measured.append((provider, capability, semantic, keyword, matched))

    # ── Pass two: rank, but only among the genuinely capable ─────────────────
    # A provider far below the best match is not a cheaper option, it is the
    # wrong option. Gating here is what stops price from buying the decision.
    best_capability = max((m[1] for m in measured), default=0.0)
    relative_floor = best_capability * RELATIVE_CAPABILITY_FLOOR

    candidates: list[Candidate] = []
    for provider, capability, semantic, keyword, matched in measured:
        trust = provider["reputation"]["trust"]
        price_score = normalise(provider["price_xlm"], cheapest, dearest)
        latency_score = normalise(
            provider["target_latency_ms"], quickest, slowest
        )

        eligible = True
        reason: str | None = None
        if provider["status"] != "online":
            eligible, reason = False, "offline"
        elif capability < CAPABILITY_FLOOR:
            eligible, reason = False, "outside declared capability"
        elif capability < relative_floor:
            eligible, reason = (
                False,
                f"outmatched — {capability:.0%} intent match against "
                f"{best_capability:.0%} for the leader",
            )

        # Capability is a *multiplier*, not a summand. A provider that cannot
        # answer well is not a cheaper option — it is the wrong one, and no
        # amount of price or speed advantage should be able to buy the
        # decision. Commercial factors then compete only within that ceiling.
        commercial_weight = (
            weights["trust"] + weights["price"] + weights["latency"]
        ) or 1.0
        utility = (
            weights["trust"] * trust
            + weights["price"] * price_score
            + weights["latency"] * latency_score
        ) / commercial_weight

        total = capability * (
            (1 - COMMERCIAL_INFLUENCE) + COMMERCIAL_INFLUENCE * utility
        )

        candidates.append(
            Candidate(
                provider=provider,
                capability=capability,
                semantic=semantic,
                keyword=keyword,
                matched_keywords=matched,
                trust=trust,
                price_score=price_score,
                latency_score=latency_score,
                total=total if eligible else 0.0,
                eligible=eligible,
                reason=reason,
            )
        )

    candidates.sort(key=lambda c: (c.eligible, c.total, c.capability), reverse=True)
    shortlist = [c for c in candidates if c.eligible]
    chosen = shortlist[0] if shortlist else None
    runner_up = shortlist[1] if len(shortlist) > 1 else None

    rationale, tradeoffs = _explain(chosen, runner_up, candidates, objective)
    decided_in_ms = int((time.perf_counter() - started) * 1000)

    decision = RoutingDecision(
        decision_id=decision_id,
        query=query,
        objective=objective,
        candidates=candidates[: limit or len(candidates)],
        chosen=chosen,
        runner_up=runner_up,
        rationale=rationale,
        tradeoffs=tradeoffs,
        considered=len(candidates),
        shortlisted=len(shortlist),
        decided_in_ms=decided_in_ms,
        weights=weights,
    )
    _persist(decision)
    return decision


def _explain(
    chosen: Candidate | None,
    runner_up: Candidate | None,
    candidates: list[Candidate],
    objective: Objective,
) -> tuple[str, list[str]]:
    """Derive the explanation from the scores, so the two can never diverge."""
    if chosen is None:
        return (
            "No provider in the network declares capability for this request. "
            "Rather than route it to the closest guess, the agent declined.",
            [],
        )

    provider = chosen.provider
    parts: list[str] = [
        f"{provider['name']} matched the request's intent at "
        f"{chosen.capability:.0%}"
    ]
    if chosen.matched_keywords:
        parts.append(
            "on " + ", ".join(f"'{k}'" for k in chosen.matched_keywords[:3])
        )
    if runner_up:
        margin = chosen.total - runner_up.total
        parts.append(
            f"— ahead of {runner_up.provider['name']} by {margin:.0%} "
            f"under the {OBJECTIVE_LABEL[objective]} objective"
        )

    observations = provider["reputation"]["observations"]
    grade = provider["reputation"]["grade"]
    if observations >= 3:
        reliability = provider["stats"]["reliability"]
        reputation_note = (
            f"Reputation {grade} — {reliability:.0%} reliable over "
            f"{observations} calls."
        )
    elif observations:
        reputation_note = (
            f"Reputation {grade}, still unproven at {observations} prior "
            f"call{'s' if observations != 1 else ''}."
        )
    else:
        reputation_note = (
            f"Reputation {grade}, provisional — this is its first request."
        )

    rationale = " ".join(parts) + ". " + reputation_note

    # Trade-offs: what the agent gave up by not choosing an alternative.
    tradeoffs: list[str] = []
    eligible = [c for c in candidates if c.eligible and c is not chosen]

    cheaper = [c for c in eligible if c.provider["price_xlm"] < provider["price_xlm"]]
    if cheaper:
        best = min(cheaper, key=lambda c: c.provider["price_xlm"])
        saving = provider["price_xlm"] - best.provider["price_xlm"]
        tradeoffs.append(
            f"{best.provider['name']} is {saving:.3f} XLM cheaper but matched "
            f"intent at only {best.capability:.0%}."
        )

    faster = [
        c
        for c in eligible
        if c.provider["target_latency_ms"] < provider["target_latency_ms"]
    ]
    if faster:
        best = min(faster, key=lambda c: c.provider["target_latency_ms"])
        delta = provider["target_latency_ms"] - best.provider["target_latency_ms"]
        tradeoffs.append(
            f"{best.provider['name']} advertises {delta} ms lower latency, "
            f"at {best.capability:.0%} intent match."
        )

    stronger = [c for c in eligible if c.trust > chosen.trust + 0.02]
    if stronger:
        best = max(stronger, key=lambda c: c.trust)
        tradeoffs.append(
            f"{best.provider['name']} carries a higher trust score "
            f"({best.trust:.0%} vs {chosen.trust:.0%}) but is less well matched."
        )

    if not tradeoffs:
        tradeoffs.append(
            "No eligible alternative was cheaper, faster, or more trusted — "
            "this was a dominant choice."
        )

    return rationale, tradeoffs


def _persist(decision: RoutingDecision) -> None:
    import json

    execute(
        """INSERT INTO routing_decisions
           (decision_id, agent_id, query, objective, considered, shortlisted,
            chosen_id, runner_up_id, rationale, scoreboard, decided_in_ms, created_at)
           VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            decision.decision_id,
            decision.query[:400],
            decision.objective,
            decision.considered,
            decision.shortlisted,
            decision.chosen.provider["provider_id"] if decision.chosen else None,
            decision.runner_up.provider["provider_id"] if decision.runner_up else None,
            decision.rationale,
            json.dumps(
                [
                    {
                        "slug": c.provider["slug"],
                        "total": round(c.total, 4),
                        "capability": round(c.capability, 4),
                    }
                    for c in decision.candidates[:12]
                ]
            ),
            decision.decided_in_ms,
            utcnow(),
        ),
    )


def recent_decisions(limit: int = 20) -> list[dict[str, Any]]:
    return query_all(
        """SELECT d.*, p.name AS chosen_name, p.slug AS chosen_slug,
                  p.accent AS chosen_accent
           FROM routing_decisions d
           LEFT JOIN providers p ON p.provider_id = d.chosen_id
           ORDER BY d.created_at DESC LIMIT ?""",
        (limit,),
    )
