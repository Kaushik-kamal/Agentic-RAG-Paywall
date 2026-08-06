"""Populate the Agent Discovery Network.

Indexes one knowledge corpus per provider, registers each provider against its
own scope, and leaves reputation empty — providers earn their scores from real
traffic rather than starting with invented history.

    python scripts/seed_marketplace.py
    python scripts/seed_marketplace.py --reset
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import settings
from app.core.logging import configure_logging
from app.db import repository as repo
from app.db.database import execute, init_db
from app.services import registry, vector_store
from app.services.rag_service import rag_service

CORPUS_DIR = BACKEND_ROOT / "data" / "marketplace_corpus"
CORE_CORPUS = BACKEND_ROOT / "data" / "demo_corpus"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--reset", action="store_true", help="Delete providers and their history first"
    )
    args = parser.parse_args()

    configure_logging(settings.log_level, settings.log_json)
    init_db()

    if not settings.gemini_enabled:
        print("GEMINI_API_KEY is not set in backend/.env — embeddings cannot run.")
        return 1

    if args.reset:
        print("Clearing the network…")
        execute("DELETE FROM routing_decisions")
        execute("DELETE FROM provider_events")
        execute("DELETE FROM providers")

    # ── Index each provider's knowledge scope ────────────────────────────────
    scopes: dict[str, list[str]] = {}
    existing = {doc["filename"]: doc for doc in repo.list_documents(limit=500)}

    print("\nIndexing provider knowledge scopes…")
    for seed in registry.SEED_PROVIDERS:
        if not seed.corpus:
            # The core demo corpus backs the payments provider.
            core = [
                document["document_id"]
                for document in existing.values()
                if document["filename"].endswith(".md")
                and (CORE_CORPUS / document["filename"]).exists()
            ]
            scopes[seed.slug] = core
            print(f"  · {seed.name:<26} core corpus ({len(core)} documents)")
            continue

        path = CORPUS_DIR / seed.corpus
        if not path.exists():
            print(f"  ✗ {seed.name:<26} missing corpus {seed.corpus}")
            scopes[seed.slug] = []
            continue

        try:
            result = rag_service.ingest_file(path)
        except Exception as exc:  # keep seeding the rest of the network
            print(f"  ✗ {seed.name:<26} {exc}")
            scopes[seed.slug] = []
            continue

        document_id = result.document["document_id"]
        scopes[seed.slug] = [document_id]
        state = "already indexed" if result.duplicate else f"{result.chunks_indexed} chunks"
        print(f"  {'·' if result.duplicate else '✓'} {seed.name:<26} {state}")

    # ── Register providers ───────────────────────────────────────────────────
    print("\nRegistering providers…")
    for seed in registry.SEED_PROVIDERS:
        provider = registry.register_provider(
            slug=seed.slug,
            name=seed.name,
            tagline=seed.tagline,
            description=seed.description,
            category=seed.category,
            capabilities=seed.capabilities,
            keywords=seed.keywords,
            scope_documents=scopes.get(seed.slug, []),
            price_xlm=seed.price_xlm,
            credits_per_call=seed.credits_per_call,
            target_latency_ms=seed.target_latency_ms,
            model=seed.model,
            top_k=seed.top_k,
            temperature=seed.temperature,
            accent=seed.accent,
            registered_by="network-genesis",
        )
        # Refresh the scope in case the provider already existed.
        registry.set_scope(seed.slug, scopes.get(seed.slug, []))
        print(
            f"  ✓ {provider['name']:<26} {seed.price_xlm:>6.3f} XLM · "
            f"{seed.credits_per_call} credit(s) · ~{seed.target_latency_ms} ms · "
            f"{seed.category}"
        )

    providers = registry.list_providers()
    print(
        f"\nNetwork online: {len(providers)} providers · "
        f"{vector_store.count()} indexed passages across "
        f"{repo.document_totals()['total_documents']} documents."
    )
    print("Reputation starts empty — scores form from real traffic.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
