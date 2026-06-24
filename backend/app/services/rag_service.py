"""
RAG Service — LangChain + ChromaDB + Gemini 2.0 Flash
Full implementation with document ingestion and retrieval.
"""
import os
import time
import logging
from pathlib import Path
from typing import Optional

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# ---------------------------------------------------------------------------
# Lazy imports so the app starts even if packages aren't installed yet
# ---------------------------------------------------------------------------
_chroma_client = None
_embeddings = None
_vectorstore = None


def _get_chroma():
    """Lazily initialise ChromaDB persistent client."""
    global _chroma_client
    if _chroma_client is None:
        import chromadb
        persist_dir = Path(settings.chroma_persist_dir)
        persist_dir.mkdir(parents=True, exist_ok=True)
        _chroma_client = chromadb.PersistentClient(path=str(persist_dir))
        logger.info("ChromaDB initialised at %s", persist_dir)
    return _chroma_client


def _get_embeddings():
    """Lazily initialise Gemini embeddings via LangChain."""
    global _embeddings
    if _embeddings is None:
        from langchain_google_genai import GoogleGenerativeAIEmbeddings
        _embeddings = GoogleGenerativeAIEmbeddings(
             model="models/embedding-001",
            google_api_key=settings.gemini_api_key,
        )
        logger.info("Gemini embeddings initialised")
    return _embeddings


def _get_vectorstore():
    """Lazily initialise LangChain-Chroma vectorstore."""
    global _vectorstore
    if _vectorstore is None:
        from langchain_chroma import Chroma
        persist_dir = Path(settings.chroma_persist_dir)
        persist_dir.mkdir(parents=True, exist_ok=True)
        _vectorstore = Chroma(
            collection_name=settings.chroma_collection,
            embedding_function=_get_embeddings(),
            persist_directory=str(persist_dir),
        )
        logger.info("Vectorstore ready (collection=%s)", settings.chroma_collection)
    return _vectorstore


# ---------------------------------------------------------------------------
# RAGService
# ---------------------------------------------------------------------------

class RAGService:
    """Full LangChain + ChromaDB + Gemini RAG pipeline."""

    def __init__(self):
        self.collection_name = settings.chroma_collection
        self._total_queries = 0
        self._total_docs = 0

    # ── Query ────────────────────────────────────────────────────────────────

    async def query(self, question: str) -> dict:
        """
        1. Embed the question with Gemini text-embedding-004.
        2. Retrieve top-5 chunks from ChromaDB via similarity search.
        3. Build a grounded prompt and call Gemini 2.0 Flash.
        Returns answer, sources, tokens_used, cost_xlm.
        """
        import asyncio
        from langchain_google_genai import ChatGoogleGenerativeAI
        from langchain.prompts import ChatPromptTemplate
        from langchain_core.output_parsers import StrOutputParser

        t0 = time.time()

        # ── Retrieval
        vs = _get_vectorstore()
        docs = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: vs.similarity_search(question, k=5),
        )

        context = "\n\n---\n\n".join(d.page_content for d in docs)
        sources = list({
            d.metadata.get("source", "unknown") for d in docs
        })

        # ── Generation
        llm = ChatGoogleGenerativeAI(
            model=settings.gemini_model,
            google_api_key=settings.gemini_api_key,
            temperature=0.2,
        )

        prompt = ChatPromptTemplate.from_messages([
            (
                "system",
                "You are a helpful assistant. Use ONLY the provided context to answer "
                "the question. If the context doesn't contain enough information, say so. "
                "Be concise and factual.\n\nContext:\n{context}",
            ),
            ("human", "{question}"),
        ])

        chain = prompt | llm | StrOutputParser()
        answer = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: chain.invoke({"context": context, "question": question}),
        )

        elapsed = time.time() - t0
        # Rough token estimate (4 chars ≈ 1 token)
        tokens_used = (len(context) + len(question) + len(answer)) // 4

        self._total_queries += 1

        return {
            "answer": answer,
            "sources": sources,
            "tokens_used": tokens_used,
            "cost_xlm": settings.x402_price_xlm,
            "latency_s": round(elapsed, 3),
        }

    # ── Ingest ───────────────────────────────────────────────────────────────

    async def ingest_documents(self, file_path: str, source_name: Optional[str] = None) -> int:
        """
        Load a file (PDF or text), chunk it, embed with Gemini,
        and store in ChromaDB. Returns number of chunks stored.
        """
        import asyncio
        from langchain_community.document_loaders import PyPDFLoader, TextLoader
        from langchain.text_splitter import RecursiveCharacterTextSplitter

        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        # Load
        if path.suffix.lower() == ".pdf":
            loader = PyPDFLoader(str(path))
        else:
            loader = TextLoader(str(path), encoding="utf-8")

        docs = await asyncio.get_event_loop().run_in_executor(None, loader.load)

        # Tag source
        src = source_name or path.name
        for doc in docs:
            doc.metadata["source"] = src

        # Chunk
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
            separators=["\n\n", "\n", ". ", " ", ""],
        )
        chunks = splitter.split_documents(docs)

        # Embed + store
        vs = _get_vectorstore()
        await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: vs.add_documents(chunks),
        )

        self._total_docs += len(chunks)
        logger.info("Ingested %d chunks from %s", len(chunks), src)
        return len(chunks)

    # ── Stats ────────────────────────────────────────────────────────────────

    def get_stats(self) -> dict:
        try:
            client = _get_chroma()
            col = client.get_or_create_collection(self.collection_name)
            doc_count = col.count()
        except Exception:
            doc_count = self._total_docs
        return {
            "total_queries": self._total_queries,
            "total_documents": doc_count,
            "collection": self.collection_name,
            "model": settings.gemini_model,
        }


rag_service = RAGService()
