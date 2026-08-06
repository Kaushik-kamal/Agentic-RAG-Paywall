"""Index the bundled demo corpus so the platform is useful on first run.

    python scripts/seed_demo.py
    python scripts/seed_demo.py --reset      # wipe the index first
    python scripts/seed_demo.py --path ./my_docs
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
from app.db.database import init_db
from app.services import vector_store
from app.services.loaders import SUPPORTED_EXTENSIONS
from app.services.rag_service import rag_service

DEFAULT_CORPUS = BACKEND_ROOT / "data" / "demo_corpus"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", default=str(DEFAULT_CORPUS), help="Directory to index")
    parser.add_argument(
        "--reset", action="store_true", help="Delete all indexed documents first"
    )
    args = parser.parse_args()

    configure_logging(settings.log_level, settings.log_json)
    init_db()

    if not settings.gemini_enabled:
        print("GEMINI_API_KEY is not set in backend/.env — embeddings cannot run.")
        return 1

    if args.reset:
        print("Resetting knowledge base…")
        vector_store.reset_collection()
        for document in repo.list_documents(limit=1000):
            repo.delete_document(document["document_id"])

    corpus = Path(args.path)
    if not corpus.exists():
        print(f"Corpus directory not found: {corpus}")
        return 1

    files = sorted(
        path
        for path in corpus.rglob("*")
        if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
    )
    if not files:
        print(f"No supported documents found in {corpus}")
        return 1

    total_chunks = 0
    for path in files:
        try:
            result = rag_service.ingest_file(path)
        except Exception as exc:
            print(f"  ✗ {path.name}: {exc}")
            continue
        marker = "·" if result.duplicate else "✓"
        state = "already indexed" if result.duplicate else f"{result.chunks_indexed} chunks"
        print(f"  {marker} {path.name} — {state} ({result.elapsed_ms} ms)")
        total_chunks += 0 if result.duplicate else result.chunks_indexed

    totals = repo.document_totals()
    print(
        f"\nKnowledge base: {totals['total_documents']} documents · "
        f"{vector_store.count()} vectors (+{total_chunks} new)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
