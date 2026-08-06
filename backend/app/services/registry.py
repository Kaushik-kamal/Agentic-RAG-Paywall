"""The provider registry — the discovery layer of the network.

A provider is an independently priced, independently scored service with its own
knowledge scope. In this deployment they share infrastructure, but their scopes
are **disjoint**: routing a contract-law question to the Medical provider really
does return "not in my sources". That is what makes discovery a genuine problem
rather than a decoration.

The registry is extensible — ``register_provider`` accepts any service that can
declare capabilities, a price, and a scope, so a third party could list here.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from app.core.config import settings
from app.core.security import new_id
from app.db.database import execute, query_all, query_one
from app.db.repository import utcnow

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class ProviderSeed:
    slug: str
    name: str
    tagline: str
    description: str
    category: str
    capabilities: list[str]
    keywords: list[str]
    corpus: str  # filename in data/marketplace_corpus, or "" for the core corpus
    price_xlm: float
    credits_per_call: int
    target_latency_ms: int
    top_k: int = 6
    temperature: float = 0.15
    accent: str = "accent"
    model: str = field(default_factory=lambda: settings.gemini_model)


#: The launch cohort. Prices and latencies differ deliberately so ranking has
#: something real to trade off.
SEED_PROVIDERS: list[ProviderSeed] = [
    ProviderSeed(
        slug="lexis-counsel",
        name="Lexis Counsel AI",
        tagline="Contract law, formation to remedy",
        description=(
            "Answers questions on contract formation, terms, exclusion clauses, "
            "discharge and remedies. Grounded in black-letter contract law."
        ),
        category="Legal",
        capabilities=["contract-law", "remedies", "legal-analysis", "citation"],
        keywords=[
            "contract", "offer", "acceptance", "consideration", "breach", "damages",
            "warranty", "condition", "frustration", "exclusion", "clause", "legal",
            "law", "remedy", "termination", "liability", "specific performance",
        ],
        corpus="legal.md",
        price_xlm=0.02,
        credits_per_call=2,
        target_latency_ms=2100,
        top_k=6,
        accent="accent",
    ),
    ProviderSeed(
        slug="clausewise",
        name="ClauseWise Review AI",
        tagline="Commercial agreements, clause by clause",
        description=(
            "Reviews commercial terms: liability caps, indemnities, IP and data "
            "rights, termination, service levels and change control."
        ),
        category="Legal",
        capabilities=["contract-review", "risk-analysis", "negotiation", "citation"],
        keywords=[
            "liability", "cap", "indemnity", "indemnities", "sla", "service level",
            "termination", "renewal", "exit", "intellectual property", "background ip",
            "foreground", "change control", "service credit", "commercial", "agreement",
            "supplier", "customer", "negotiate", "clause",
        ],
        corpus="contracts.md",
        price_xlm=0.025,
        credits_per_call=3,
        target_latency_ms=2400,
        top_k=7,
        accent="accent",
    ),
    ProviderSeed(
        slug="vitalis",
        name="Vitalis Clinical AI",
        tagline="Clinical evidence and trial design",
        description=(
            "Interprets clinical evidence: trial design, randomisation, effect "
            "measures, diagnostic test characteristics and systematic bias."
        ),
        category="Medical",
        capabilities=["clinical-evidence", "trial-design", "biostatistics", "citation"],
        keywords=[
            "clinical", "trial", "randomised", "randomized", "rct", "blinding",
            "intention to treat", "sensitivity", "specificity", "predictive value",
            "number needed to treat", "absolute risk", "relative risk", "medical",
            "patient", "diagnosis", "diagnostic", "evidence", "cohort", "placebo",
        ],
        corpus="medical.md",
        price_xlm=0.03,
        credits_per_call=3,
        target_latency_ms=2600,
        top_k=6,
        accent="positive",
    ),
    ProviderSeed(
        slug="atlas-capital",
        name="Atlas Capital AI",
        tagline="Valuation and corporate finance",
        description=(
            "Covers discounting, WACC, DCF and terminal value, relative multiples, "
            "capital structure and payout policy."
        ),
        category="Finance",
        capabilities=["valuation", "corporate-finance", "modelling", "citation"],
        keywords=[
            "valuation", "wacc", "dcf", "discount", "cash flow", "terminal value",
            "capm", "beta", "cost of capital", "ebitda", "multiple", "leverage",
            "capital structure", "dividend", "buyback", "finance", "financial",
            "npv", "equity", "debt", "tax shield",
        ],
        corpus="finance.md",
        price_xlm=0.02,
        credits_per_call=2,
        target_latency_ms=1900,
        top_k=6,
        accent="value",
    ),
    ProviderSeed(
        slug="coreloop",
        name="CoreLoop Systems AI",
        tagline="Distributed systems engineering",
        description=(
            "Consistency models, consensus, idempotency and exactly-once "
            "processing, backpressure and failure handling."
        ),
        category="Engineering",
        capabilities=["distributed-systems", "architecture", "debugging", "citation"],
        keywords=[
            "distributed", "cap theorem", "consistency", "linearizable",
            "linearizability", "consensus", "raft", "paxos", "quorum", "partition",
            "idempotent", "idempotency", "exactly once", "retry", "backpressure",
            "timeout", "circuit breaker", "replication", "leader", "outbox",
            "database", "latency", "system",
        ],
        corpus="programming.md",
        price_xlm=0.01,
        credits_per_call=1,
        target_latency_ms=1200,
        top_k=6,
        accent="data",
    ),
    ProviderSeed(
        slug="priorart",
        name="PriorArt Search AI",
        tagline="Patentability and prior art",
        description=(
            "Novelty, inventive step, priority dates, claim construction, prior "
            "art strategy, and freedom to operate versus patentability."
        ),
        category="Legal",
        capabilities=["prior-art", "patent-analysis", "claim-construction", "citation"],
        keywords=[
            "patent", "prior art", "novelty", "inventive step", "obvious",
            "priority date", "claim", "independent claim", "dependent claim",
            "infringement", "freedom to operate", "cpc", "ipc", "filing",
            "invention", "patentable", "monopoly", "paris convention",
        ],
        corpus="patents.md",
        price_xlm=0.035,
        credits_per_call=4,
        target_latency_ms=3100,
        top_k=8,
        accent="accent",
    ),
    ProviderSeed(
        slug="sentinel",
        name="Sentinel Compliance AI",
        tagline="Data protection and regulatory duty",
        description=(
            "Lawful basis, data subject rights, breach notification timelines, "
            "accountability, international transfers and retention."
        ),
        category="Compliance",
        capabilities=["data-protection", "regulatory", "risk-analysis", "citation"],
        keywords=[
            "gdpr", "data protection", "privacy", "consent", "lawful basis",
            "legitimate interest", "data subject", "erasure", "breach",
            "notification", "72 hours", "dpo", "dpia", "transfer", "adequacy",
            "standard contractual clauses", "retention", "compliance", "regulator",
            "personal data",
        ],
        corpus="compliance.md",
        price_xlm=0.025,
        credits_per_call=3,
        target_latency_ms=2300,
        top_k=6,
        accent="danger",
    ),
    ProviderSeed(
        slug="pedagogue",
        name="Pedagogue Learning AI",
        tagline="Learning science and instruction",
        description=(
            "Retrieval practice, spacing and interleaving, cognitive load, "
            "feedback design and assessment validity."
        ),
        category="Education",
        capabilities=["learning-science", "curriculum", "assessment", "citation"],
        keywords=[
            "learning", "teaching", "retrieval practice", "spacing", "interleaving",
            "cognitive load", "worked example", "feedback", "assessment",
            "formative", "summative", "validity", "reliability", "student",
            "curriculum", "instruction", "memory", "study",
        ],
        corpus="education.md",
        price_xlm=0.005,
        credits_per_call=1,
        target_latency_ms=1000,
        top_k=5,
        temperature=0.2,
        accent="value",
    ),
    ProviderSeed(
        slug="scholiast",
        name="Scholiast Papers AI",
        tagline="Statistical inference and method",
        description=(
            "p-values, power, multiple comparisons, reproducibility and causal "
            "inference from observational data."
        ),
        category="Research",
        capabilities=["statistics", "methodology", "peer-review", "citation"],
        keywords=[
            "p-value", "p value", "significance", "statistical power", "sample size",
            "confidence interval", "multiple comparisons", "bonferroni",
            "false discovery", "pre-registration", "reproducibility", "replication",
            "confounding", "collider", "causal", "observational", "hypothesis",
            "null", "effect size", "bias",
        ],
        corpus="scientific-papers.md",
        price_xlm=0.015,
        credits_per_call=2,
        target_latency_ms=1700,
        top_k=6,
        accent="data",
    ),
    ProviderSeed(
        slug="northstar",
        name="NorthStar Research AI",
        tagline="Machine learning in production",
        description=(
            "Training–serving skew, data leakage, evaluation under imbalance, "
            "drift detection and evaluating retrieval-augmented systems."
        ),
        category="Research",
        capabilities=["ml-systems", "evaluation", "mlops", "citation"],
        keywords=[
            "machine learning", "model", "training", "serving", "skew", "leakage",
            "feature store", "drift", "covariate", "concept drift", "precision",
            "recall", "roc", "auc", "imbalance", "rag", "faithfulness", "recall@k",
            "mlops", "production", "evaluation", "embedding",
        ],
        corpus="research.md",
        price_xlm=0.015,
        credits_per_call=2,
        target_latency_ms=1600,
        top_k=7,
        accent="positive",
    ),
    ProviderSeed(
        slug="tollgate",
        name="Tollgate Payments AI",
        tagline="Agent payments and the x402 protocol",
        description=(
            "The Stellar network, the x402 handshake, retrieval architecture and "
            "the economics of machine-to-machine commerce."
        ),
        category="Web3",
        capabilities=["payments", "stellar", "x402", "protocol", "citation"],
        keywords=[
            "stellar", "xlm", "lumen", "x402", "402", "micropayment", "memo",
            "horizon", "consensus", "ledger", "settlement", "replay", "credit",
            "agent economy", "chunking", "retrieval", "reciprocal rank fusion",
            "bm25", "embedding", "paywall", "wallet", "blockchain",
        ],
        corpus="",  # the original demo corpus
        price_xlm=0.01,
        credits_per_call=1,
        target_latency_ms=1400,
        top_k=6,
        accent="accent",
    ),
]


# ── Serialisation ─────────────────────────────────────────────────────────────


def _row_to_provider(row: dict[str, Any]) -> dict[str, Any]:
    total = int(row["total_requests"])
    successful = int(row["successful"])
    failed = int(row["failed"])
    latency_sum = int(row["latency_sum_ms"])
    confidence_count = int(row["confidence_count"])

    return {
        "provider_id": row["provider_id"],
        "slug": row["slug"],
        "name": row["name"],
        "tagline": row["tagline"],
        "description": row["description"],
        "category": row["category"],
        "endpoint": row["endpoint"],
        "capabilities": json.loads(row["capabilities"]),
        "keywords": json.loads(row["keywords"]),
        "scope_documents": json.loads(row["scope_documents"]),
        "model": row["model"],
        "price_xlm": float(row["price_xlm"]),
        "price_usd": round(float(row["price_xlm"]) * settings.xlm_usd_rate, 6),
        "credits_per_call": int(row["credits_per_call"]),
        "target_latency_ms": int(row["target_latency_ms"]),
        "top_k": int(row["top_k"]),
        "temperature": float(row["temperature"]),
        "accent": row["accent"],
        "status": row["status"],
        "registered_by": row["registered_by"],
        "created_at": row["created_at"],
        "stats": {
            "total_requests": total,
            "successful": successful,
            "failed": failed,
            "reliability": round(successful / total, 4) if total else None,
            "avg_latency_ms": int(latency_sum / successful) if successful else None,
            "revenue_xlm": round(float(row["revenue_xlm"]), 7),
            "avg_confidence": round(float(row["confidence_sum"]) / confidence_count, 4)
            if confidence_count
            else None,
        },
    }


# ── Reads ─────────────────────────────────────────────────────────────────────


def list_providers(include_offline: bool = True) -> list[dict[str, Any]]:
    sql = "SELECT * FROM providers"
    if not include_offline:
        sql += " WHERE status = 'online'"
    sql += " ORDER BY name"
    return [_row_to_provider(row) for row in query_all(sql)]


def get_provider(identifier: str) -> dict[str, Any] | None:
    row = query_one(
        "SELECT * FROM providers WHERE provider_id = ? OR slug = ?",
        (identifier, identifier),
    )
    return _row_to_provider(row) if row else None


def provider_count() -> int:
    row = query_one(
        "SELECT COUNT(*) AS total, "
        "SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) AS online FROM providers"
    ) or {"total": 0, "online": 0}
    return int(row["total"] or 0)


# ── Writes ────────────────────────────────────────────────────────────────────


def register_provider(
    *,
    slug: str,
    name: str,
    tagline: str,
    description: str,
    category: str,
    capabilities: list[str],
    keywords: list[str],
    scope_documents: list[str],
    price_xlm: float,
    credits_per_call: int,
    target_latency_ms: int,
    model: str | None = None,
    top_k: int = 6,
    temperature: float = 0.15,
    accent: str = "accent",
    endpoint: str | None = None,
    registered_by: str | None = None,
) -> dict[str, Any]:
    """Add a service to the network. Idempotent on ``slug``."""
    existing = get_provider(slug)
    if existing:
        return existing

    provider_id = new_id("prov")
    execute(
        """INSERT INTO providers
           (provider_id, slug, name, tagline, description, category, endpoint,
            capabilities, keywords, scope_documents, model, price_xlm,
            credits_per_call, target_latency_ms, top_k, temperature, accent,
            status, registered_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'online', ?, ?)""",
        (
            provider_id,
            slug,
            name,
            tagline,
            description,
            category,
            endpoint or f"{settings.api_prefix}/marketplace/providers/{slug}/invoke",
            json.dumps(capabilities),
            json.dumps(keywords),
            json.dumps(scope_documents),
            model or settings.gemini_model,
            price_xlm,
            credits_per_call,
            target_latency_ms,
            top_k,
            temperature,
            accent,
            registered_by,
            utcnow(),
        ),
    )
    logger.info("Registered provider %s (%s)", slug, name)
    return get_provider(provider_id)  # type: ignore[return-value]


def set_scope(slug: str, document_ids: list[str]) -> None:
    execute(
        "UPDATE providers SET scope_documents = ? WHERE slug = ?",
        (json.dumps(document_ids), slug),
    )


def set_status(slug: str, status: str) -> None:
    execute("UPDATE providers SET status = ? WHERE slug = ?", (status, slug))


def record_outcome(
    provider_id: str,
    *,
    agent_id: str,
    query: str,
    status: str,
    latency_ms: int | None,
    cost_xlm: float,
    confidence: float | None,
    cited_chunks: int | None = None,
) -> None:
    """Append to the reputation ledger and update the running counters."""
    from app.db.database import transaction

    with transaction() as conn:
        conn.execute(
            """INSERT INTO provider_events
               (provider_id, agent_id, query, status, latency_ms, cost_xlm,
                confidence, cited_chunks, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                provider_id,
                agent_id,
                query[:400],
                status,
                latency_ms,
                cost_xlm,
                confidence,
                cited_chunks,
                utcnow(),
            ),
        )
        if status == "success":
            conn.execute(
                """UPDATE providers
                   SET total_requests = total_requests + 1,
                       successful = successful + 1,
                       latency_sum_ms = latency_sum_ms + ?,
                       revenue_xlm = revenue_xlm + ?,
                       confidence_sum = confidence_sum + ?,
                       confidence_count = confidence_count + ?
                   WHERE provider_id = ?""",
                (
                    latency_ms or 0,
                    cost_xlm,
                    confidence or 0.0,
                    1 if confidence is not None else 0,
                    provider_id,
                ),
            )
        else:
            conn.execute(
                """UPDATE providers
                   SET total_requests = total_requests + 1, failed = failed + 1
                   WHERE provider_id = ?""",
                (provider_id,),
            )


def recent_events(provider_id: str, limit: int = 40) -> list[dict[str, Any]]:
    return query_all(
        """SELECT * FROM provider_events WHERE provider_id = ?
           ORDER BY event_id DESC LIMIT ?""",
        (provider_id, limit),
    )


def network_events(limit: int = 30) -> list[dict[str, Any]]:
    return query_all(
        """SELECT e.*, p.name AS provider_name, p.slug AS provider_slug,
                  p.accent AS provider_accent
           FROM provider_events e
           JOIN providers p ON p.provider_id = e.provider_id
           ORDER BY e.event_id DESC LIMIT ?""",
        (limit,),
    )
