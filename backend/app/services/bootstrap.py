"""Make an empty instance useful without anyone running a script.

A host without a persistent disk starts every restart with nothing: no corpus,
no providers, no index. The site would come up looking deployed and answer
nothing. This indexes the bundled corpora and registers the seed providers when
— and only when — the registry is empty.

It runs on a background thread. Embedding the corpora takes the better part of
a minute against a cold Gemini connection, and a platform health check that
waits that long declares the deploy failed. The API is serving immediately;
the network fills in behind it.

Seeding is idempotent: `ingest_file` skips documents it has already indexed and
`register_provider` upserts, so a restart with a real disk is a no-op.
"""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.db import repository as repo
from app.services import registry, vector_store
from app.services.loaders import SUPPORTED_EXTENSIONS
from app.services.rag_service import rag_service

logger = logging.getLogger(__name__)

BACKEND_ROOT = Path(__file__).resolve().parents[2]
DEMO_CORPUS = BACKEND_ROOT / "data" / "demo_corpus"
MARKETPLACE_CORPUS = BACKEND_ROOT / "data" / "marketplace_corpus"

#: Progress, readable through /health so a cold instance can explain itself.
_status: dict[str, Any] = {"state": "idle", "detail": "", "started_at": None}
_lock = threading.Lock()


def status() -> dict[str, Any]:
    with _lock:
        return dict(_status)


def _set(state: str, detail: str = "") -> None:
    with _lock:
        _status["state"] = state
        _status["detail"] = detail


def needs_seeding() -> bool:
    """An instance is 'empty' when nothing can be routed to."""
    try:
        return not registry.list_providers()
    except Exception:  # a table that does not exist yet counts as empty
        logger.debug("Registry unreadable during bootstrap check", exc_info=True)
        return True


def _index_core_corpus() -> None:
    if not DEMO_CORPUS.exists():
        logger.warning("Demo corpus missing at %s", DEMO_CORPUS)
        return
    files = sorted(
        path for path in DEMO_CORPUS.rglob("*")
        if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
    )
    for index, path in enumerate(files, start=1):
        _set("seeding", f"core corpus {index}/{len(files)}")
        try:
            rag_service.ingest_file(path)
        except Exception:  # one bad file must not abort the whole boot
            logger.exception("Bootstrap failed to index %s", path.name)


def _provider_scopes() -> dict[str, list[str]]:
    """Index each provider's corpus and map slug -> document ids."""
    scopes: dict[str, list[str]] = {}
    seeds = registry.SEED_PROVIDERS

    for index, seed in enumerate(seeds, start=1):
        _set("seeding", f"provider corpus {index}/{len(seeds)}")

        if not seed.corpus:
            # The payments provider answers from the core demo corpus.
            scopes[seed.slug] = [
                document["document_id"]
                for document in repo.list_documents(limit=500)
                if document["filename"].endswith(".md")
                and (DEMO_CORPUS / document["filename"]).exists()
            ]
            continue

        path = MARKETPLACE_CORPUS / seed.corpus
        if not path.exists():
            logger.warning("Missing corpus %s for %s", seed.corpus, seed.slug)
            scopes[seed.slug] = []
            continue

        try:
            result = rag_service.ingest_file(path)
            scopes[seed.slug] = [result.document["document_id"]]
        except Exception:
            logger.exception("Bootstrap failed to index corpus for %s", seed.slug)
            scopes[seed.slug] = []

    return scopes


def _register(scopes: dict[str, list[str]]) -> None:
    for seed in registry.SEED_PROVIDERS:
        try:
            registry.register_provider(
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
                registered_by="boot-seed",
            )
            registry.set_scope(seed.slug, scopes.get(seed.slug, []))
        except Exception:
            logger.exception("Bootstrap failed to register %s", seed.slug)


def _run() -> None:
    started = time.time()
    try:
        _set("seeding", "starting")
        _index_core_corpus()
        _register(_provider_scopes())

        providers = len(registry.list_providers())
        passages = vector_store.count()
        elapsed = round(time.time() - started, 1)

        # Providers register even when their corpus is missing, so a provider
        # count alone would report success for an instance that can retrieve
        # nothing. An empty index after a seed run means the corpora never made
        # it into the image — say so rather than looking healthy and answering
        # nothing.
        if passages == 0:
            _set("failed", "seeded 0 passages — corpora missing from the image")
            logger.error(
                "Bootstrap registered %d providers but indexed no passages. "
                "Check that data/demo_corpus and data/marketplace_corpus are "
                "present in the container.", providers,
            )
            return

        _set("ready", f"{providers} providers, {passages} passages")
        logger.info(
            "Bootstrap seeding complete in %ss — %d providers, %d passages",
            elapsed, providers, passages,
        )
    except Exception:
        logger.exception("Bootstrap seeding failed")
        _set("failed", "see logs")


def seed_if_empty() -> None:
    """Kick off seeding on a background thread if this instance has nothing."""
    if not settings.auto_seed:
        return
    if not settings.gemini_enabled:
        logger.warning("AUTO_SEED is on but GEMINI_API_KEY is unset — cannot embed")
        _set("failed", "GEMINI_API_KEY not configured")
        return
    if not needs_seeding():
        _set("ready", "already populated")
        return

    with _lock:
        _status["started_at"] = time.time()
    logger.info("Empty instance detected — seeding the network in the background")
    threading.Thread(target=_run, name="bootstrap-seed", daemon=True).start()
