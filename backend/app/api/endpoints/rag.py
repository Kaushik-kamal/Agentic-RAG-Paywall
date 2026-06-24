"""RAG endpoints — wired to the full RAGService."""
import os
import shutil
import logging
from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, HTTPException, UploadFile, File, Header, Depends
from pydantic import BaseModel

from app.services.rag_service import rag_service
from app.services.stellar_service import stellar_service

logger = logging.getLogger(__name__)
router = APIRouter()

UPLOAD_DIR = Path("./data/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# ── Models ────────────────────────────────────────────────────────────────────

class QueryRequest(BaseModel):
    query: str
    agent_id: str
    payment_token: Optional[str] = None


class QueryResponse(BaseModel):
    answer: str
    sources: List[str]
    tokens_used: int
    cost_xlm: float
    latency_s: Optional[float] = None


class IngestResponse(BaseModel):
    filename: str
    chunks_stored: int
    status: str


# ── Auth helper ───────────────────────────────────────────────────────────────

def _require_token(authorization: Optional[str] = Header(None)) -> str:
    """Validate x402 access token from Authorization: Bearer <token> header."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=402,
            detail="Payment required. POST /api/v1/payments/initiate first.",
            headers={
                "X-Payment-Address": stellar_service.public_key or "GCEX...",
                "X-Payment-Amount": str(stellar_service.price_xlm),
                "X-Payment-Asset": "XLM",
                "X-Payment-Network": stellar_service.network,
            },
        )
    token = authorization.removeprefix("Bearer ")
    agent_id = stellar_service.validate_access_token(token)
    if agent_id is None:
        raise HTTPException(status_code=401, detail="Invalid or expired access token.")
    return agent_id


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/query", response_model=QueryResponse)
async def query_knowledge_base(
    request: QueryRequest,
    agent_id: str = Depends(_require_token),
):
    """
    Query the RAG knowledge base.
    Requires a valid Stellar x402 access token in Authorization header.
    """
    if not request.query.strip():
        raise HTTPException(status_code=422, detail="Query must not be empty.")
    try:
        result = await rag_service.query(request.query)
        return QueryResponse(**result)
    except Exception as e:
        logger.exception("RAG query failed")
        raise HTTPException(status_code=500, detail=f"RAG error: {str(e)}")


@router.post("/ingest", response_model=IngestResponse)
async def ingest_document(file: UploadFile = File(...)):
    """
    Upload and ingest a document (PDF or .txt) into ChromaDB.
    Admin endpoint — add your own auth here in production.
    """
    allowed = {".pdf", ".txt", ".md"}
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in allowed:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file type '{suffix}'. Allowed: {allowed}",
        )

    dest = UPLOAD_DIR / (file.filename or "upload")
    try:
        with dest.open("wb") as f:
            shutil.copyfileobj(file.file, f)

        chunks = await rag_service.ingest_documents(str(dest), source_name=file.filename)
        return IngestResponse(
            filename=file.filename or "",
            chunks_stored=chunks,
            status="success",
        )
    except Exception as e:
        logger.exception("Ingestion failed")
        raise HTTPException(status_code=500, detail=f"Ingestion error: {str(e)}")
    finally:
        file.file.close()


@router.get("/collections")
async def list_collections():
    """List available knowledge base collections and doc count."""
    stats = rag_service.get_stats()
    return {
        "collections": [stats["collection"]],
        "total_documents": stats["total_documents"],
        "total_queries": stats["total_queries"],
        "model": stats["model"],
    }


@router.get("/stats")
async def get_rag_stats():
    """Return RAG pipeline stats."""
    return rag_service.get_stats()
