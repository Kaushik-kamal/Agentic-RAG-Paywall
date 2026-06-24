import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import routes

logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="Agentic RAG Paywall API",
    description=(
        "AI agents pay Stellar x402 micropayments to access a "
        "LangChain + ChromaDB + Gemini RAG knowledge API."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(routes.router, prefix="/api/v1")


@app.get("/health", tags=["System"])
async def health_check():
    return {"status": "ok", "service": "agentic-rag-paywall", "version": "1.0.0"}


@app.get("/api/v1/stats", tags=["System"])
async def global_stats():
    """Aggregate stats from RAG + payment services."""
    from app.services.rag_service import rag_service
    from app.services.stellar_service import stellar_service

    rag = rag_service.get_stats()
    pay = stellar_service.get_stats()
    return {
        "total_queries": rag["total_queries"],
        "total_documents": rag["total_documents"],
        "total_payments": pay["total_payments"],
        "revenue_xlm": pay["total_revenue_xlm"],
        "price_xlm": pay["price_per_query_xlm"],
        "network": pay["network"],
        "model": rag["model"],
    }
