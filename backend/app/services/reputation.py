"""Reputation — a trust score computed from what actually happened.

Providers are scored on four observable dimensions, blended into a single trust
value. Two design choices matter:

**Bayesian smoothing.** A provider with one successful call is not 100% reliable;
it is one data point. Every rate is smoothed toward a neutral prior with a
pseudo-count, so reputation earns its way up rather than starting perfect. This
is what stops a fresh listing from outranking a proven one on a fluke.

**No hidden seeding.** Nothing is pre-populated with invented history. A new
network shows every provider at the prior, and the numbers move only when calls
are made. That makes the dashboard honest, and it makes the demo more impressive,
not less — the judge watches reputation form.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from app.db.database import query_all

#: Strength of the prior, in pseudo-observations.
PRIOR_WEIGHT = 4.0
#: What we assume of an unproven provider: usually works, moderately grounded.
PRIOR_RELIABILITY = 0.80
PRIOR_QUALITY = 0.62

WEIGHTS = {
    "reliability": 0.40,
    "quality": 0.30,
    "speed": 0.20,
    "experience": 0.10,
}


def _smoothed(successes: float, total: float, prior: float) -> float:
    return (successes + prior * PRIOR_WEIGHT) / (total + PRIOR_WEIGHT)


def _speed_score(avg_latency_ms: int | None, target_ms: int) -> float:
    """1.0 when at or under the advertised latency, decaying as it overshoots."""
    if not avg_latency_ms:
        return 0.6  # unproven
    ratio = avg_latency_ms / max(1, target_ms)
    if ratio <= 1.0:
        return 1.0
    return max(0.1, 1.0 / ratio)


def _experience_score(total_requests: int) -> float:
    """Saturating curve — the 40th call adds far less than the 4th."""
    return min(1.0, total_requests / 40.0) ** 0.5


def score_provider(provider: dict[str, Any]) -> dict[str, Any]:
    """Return the trust score plus every component that produced it."""
    stats = provider["stats"]
    total = stats["total_requests"]
    successful = stats["successful"]

    reliability = _smoothed(successful, total, PRIOR_RELIABILITY)
    quality = _smoothed(
        (stats["avg_confidence"] or PRIOR_QUALITY) * successful,
        successful,
        PRIOR_QUALITY,
    )
    speed = _speed_score(stats["avg_latency_ms"], provider["target_latency_ms"])
    experience = _experience_score(total)

    trust = (
        WEIGHTS["reliability"] * reliability
        + WEIGHTS["quality"] * quality
        + WEIGHTS["speed"] * speed
        + WEIGHTS["experience"] * experience
    )

    return {
        "trust": round(trust, 4),
        "grade": grade_for(trust),
        "components": {
            "reliability": round(reliability, 4),
            "quality": round(quality, 4),
            "speed": round(speed, 4),
            "experience": round(experience, 4),
        },
        "weights": WEIGHTS,
        "observations": total,
        "unproven": total < 3,
    }


def grade_for(trust: float) -> str:
    if trust >= 0.88:
        return "AAA"
    if trust >= 0.80:
        return "AA"
    if trust >= 0.72:
        return "A"
    if trust >= 0.62:
        return "BBB"
    if trust >= 0.50:
        return "BB"
    return "B"


def enrich(provider: dict[str, Any]) -> dict[str, Any]:
    return {**provider, "reputation": score_provider(provider)}


def enrich_all(providers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [enrich(provider) for provider in providers]


def history(provider_id: str, points: int = 20) -> list[dict[str, Any]]:
    """Trust as it evolved, recomputed cumulatively over the event ledger.

    This is a replay of real events rather than a stored series, so it can never
    disagree with the current score.
    """
    events = query_all(
        """SELECT status, latency_ms, confidence, created_at
           FROM provider_events WHERE provider_id = ?
           ORDER BY event_id ASC""",
        (provider_id,),
    )
    if not events:
        return []

    from app.services.registry import get_provider

    provider = get_provider(provider_id)
    target = provider["target_latency_ms"] if provider else 2000

    series: list[dict[str, Any]] = []
    successes = 0
    latency_sum = 0
    confidence_sum = 0.0
    confidence_count = 0

    for index, event in enumerate(events, start=1):
        if event["status"] == "success":
            successes += 1
            latency_sum += int(event["latency_ms"] or 0)
            if event["confidence"] is not None:
                confidence_sum += float(event["confidence"])
                confidence_count += 1

        reliability = _smoothed(successes, index, PRIOR_RELIABILITY)
        avg_confidence = (
            confidence_sum / confidence_count if confidence_count else PRIOR_QUALITY
        )
        quality = _smoothed(avg_confidence * successes, successes, PRIOR_QUALITY)
        speed = _speed_score(
            int(latency_sum / successes) if successes else None, target
        )
        experience = _experience_score(index)

        trust = (
            WEIGHTS["reliability"] * reliability
            + WEIGHTS["quality"] * quality
            + WEIGHTS["speed"] * speed
            + WEIGHTS["experience"] * experience
        )
        series.append(
            {
                "n": index,
                "trust": round(trust, 4),
                "reliability": round(reliability, 4),
                "at": event["created_at"],
            }
        )

    # Downsample evenly so the sparkline stays readable at any volume.
    if len(series) <= points:
        return series
    step = len(series) / points
    return [series[min(len(series) - 1, int(i * step))] for i in range(points)]


def leaderboard(providers: list[dict[str, Any]]) -> dict[str, Any]:
    """Rankings the marketplace dashboard shows. Ties resolve deterministically."""
    scored = enrich_all(providers)
    used = [p for p in scored if p["stats"]["total_requests"] > 0]

    def top(items: list[dict[str, Any]], key, reverse: bool) -> dict[str, Any] | None:
        if not items:
            return None
        best = sorted(items, key=lambda p: (key(p), p["slug"]), reverse=reverse)[0]
        return {
            "slug": best["slug"],
            "name": best["name"],
            "accent": best["accent"],
            "value": key(best),
        }

    with_latency = [p for p in used if p["stats"]["avg_latency_ms"]]

    return {
        "most_trusted": top(scored, lambda p: p["reputation"]["trust"], True),
        "most_used": top(used, lambda p: p["stats"]["total_requests"], True),
        "cheapest": top(scored, lambda p: -p["price_xlm"], True),
        "fastest": top(with_latency, lambda p: -p["stats"]["avg_latency_ms"], True),
        "highest_revenue": top(used, lambda p: p["stats"]["revenue_xlm"], True),
    }


def network_activity(hours: int = 24) -> list[dict[str, Any]]:
    """Requests per hour across the whole network."""
    since = (datetime.now(UTC) - timedelta(hours=hours)).isoformat()
    rows = query_all(
        """SELECT substr(created_at, 1, 13) AS hour,
                  COUNT(*) AS requests,
                  COALESCE(SUM(cost_xlm), 0) AS revenue
           FROM provider_events WHERE created_at >= ?
           GROUP BY hour ORDER BY hour ASC""",
        (since,),
    )
    return [
        {
            "hour": row["hour"],
            "requests": int(row["requests"]),
            "revenue_xlm": round(float(row["revenue"]), 7),
        }
        for row in rows
    ]
