"""Knowledge-base document management."""

from __future__ import annotations

import logging
import os
import re
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, UploadFile
from starlette.concurrency import run_in_threadpool

from app.api.deps import AdminOnly, UploadLimit
from app.core.config import settings
from app.core.errors import NotFoundError, PayloadTooLargeError, ValidationError
from app.db import repository as repo
from app.schemas import DocumentModel, IngestResponse
from app.services.loaders import SUPPORTED_EXTENSIONS
from app.services.rag_service import rag_service

logger = logging.getLogger(__name__)
router = APIRouter()

_UNSAFE = re.compile(r"[^A-Za-z0-9._ \-]")


def _safe_filename(raw: str | None) -> str:
    name = Path(raw or "upload").name  # strip any directory components
    name = _UNSAFE.sub("_", name).strip(". ") or "upload"
    return name[:120]


async def _persist_upload(upload: UploadFile) -> tuple[Path, str]:
    """Stream to disk with a hard size ceiling — never buffer a whole file."""
    filename = _safe_filename(upload.filename)
    suffix = Path(filename).suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise ValidationError(
            f"Unsupported file type '{suffix or filename}'.",
            details={"supported_extensions": sorted(SUPPORTED_EXTENSIONS)},
        )

    upload_dir = settings.upload_path
    upload_dir.mkdir(parents=True, exist_ok=True)

    # Reserve a unique name, then own the handle explicitly so the file is
    # always removed on any failure path.
    descriptor, raw_path = tempfile.mkstemp(dir=upload_dir, suffix=suffix)
    temp_path = Path(raw_path)
    written = 0

    try:
        with os.fdopen(descriptor, "wb") as handle:
            while chunk := await upload.read(1 << 20):
                written += len(chunk)
                if written > settings.max_upload_bytes:
                    raise PayloadTooLargeError(
                        f"File exceeds the {settings.max_upload_mb} MB limit.",
                        details={"max_bytes": settings.max_upload_bytes},
                    )
                handle.write(chunk)

        if written == 0:
            raise ValidationError("The uploaded file is empty.")
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()

    return temp_path, filename


@router.post(
    "",
    response_model=IngestResponse,
    summary="Upload and index a document",
    description=(
        "Accepts PDF, DOCX, TXT, Markdown, CSV and JSON. The file is parsed, "
        "chunked with heading awareness, embedded, summarised, and indexed."
    ),
)
async def upload_document(
    _admin: AdminOnly,
    _limit: UploadLimit,
    file: UploadFile = File(..., description="Document to index"),
) -> IngestResponse:
    temp_path, filename = await _persist_upload(file)
    try:
        result = await run_in_threadpool(
            rag_service.ingest_file, temp_path, original_filename=filename
        )
    finally:
        temp_path.unlink(missing_ok=True)

    document = repo.get_document(result.document["document_id"])
    message = (
        f"'{filename}' is already indexed — reusing the existing entry."
        if result.duplicate
        else f"Indexed {result.chunks_indexed} chunks from '{filename}'."
    )
    return IngestResponse(
        document=DocumentModel(**_document_payload(document)),
        chunks_indexed=result.chunks_indexed,
        duplicate=result.duplicate,
        elapsed_ms=result.elapsed_ms,
        message=message,
    )


def _document_payload(row: dict[str, Any] | None) -> dict[str, Any]:
    if row is None:
        raise NotFoundError("Document not found.")
    return {
        "document_id": row["document_id"],
        "filename": row["filename"],
        "title": row["title"],
        "media_type": row["media_type"],
        "size_bytes": row["size_bytes"],
        "chunk_count": row["chunk_count"],
        "char_count": row["char_count"],
        "page_count": row["page_count"],
        "summary": row["summary"],
        "topics": row.get("topics") or [],
        "status": row["status"],
        "created_at": row["created_at"],
    }


@router.get("", summary="List indexed documents")
async def list_documents() -> dict[str, Any]:
    rows = await run_in_threadpool(repo.list_documents)
    totals = await run_in_threadpool(repo.document_totals)
    return {
        "documents": [_document_payload(row) for row in rows],
        **totals,
        "supported_extensions": sorted(SUPPORTED_EXTENSIONS),
        "max_upload_mb": settings.max_upload_mb,
    }


@router.get("/{document_id}", response_model=DocumentModel, summary="Get one document")
async def get_document(document_id: str) -> DocumentModel:
    row = await run_in_threadpool(repo.get_document, document_id)
    return DocumentModel(**_document_payload(row))


@router.delete("/{document_id}", summary="Delete a document and its vectors")
async def delete_document(document_id: str, _admin: AdminOnly) -> dict[str, Any]:
    await run_in_threadpool(rag_service.delete_document, document_id)
    return {"deleted": True, "document_id": document_id}
