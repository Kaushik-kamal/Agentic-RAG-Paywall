"""Print the Gemini models this API key can actually use.

Model availability varies by key, tier and region. Run this before changing
``GEMINI_MODEL`` or ``GEMINI_EMBEDDING_MODEL`` in ``backend/.env``.

    python scripts/list_models.py
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

import httpx

from app.core.config import settings

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models"


def main() -> int:
    if not settings.gemini_enabled:
        print("GEMINI_API_KEY is not set in backend/.env")
        return 1

    models: list[dict] = []
    page_token: str | None = None
    with httpx.Client(timeout=30.0) as client:
        while True:
            params = {"key": settings.gemini_api_key, "pageSize": 200}
            if page_token:
                params["pageToken"] = page_token
            response = client.get(ENDPOINT, params=params)
            if response.status_code != 200:
                print(f"ListModels failed ({response.status_code}): {response.text[:400]}")
                return 1
            payload = response.json()
            models.extend(payload.get("models", []))
            page_token = payload.get("nextPageToken")
            if not page_token:
                break

    generation = sorted(
        m["name"] for m in models if "generateContent" in m.get("supportedGenerationMethods", [])
    )
    embedding = sorted(
        m["name"]
        for m in models
        if {"embedContent", "batchEmbedContents"} & set(m.get("supportedGenerationMethods", []))
    )

    print(f"GENERATION MODELS ({len(generation)}) — set GEMINI_MODEL to one of these:")
    for name in generation:
        print(f"  {name.removeprefix('models/')}")

    print(f"\nEMBEDDING MODELS ({len(embedding)}) — set GEMINI_EMBEDDING_MODEL:")
    for name in embedding:
        print(f"  {name}")

    print(f"\nCurrently configured: {settings.gemini_model} / {settings.gemini_embedding_model}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
