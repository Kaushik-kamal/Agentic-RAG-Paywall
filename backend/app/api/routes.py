from fastapi import APIRouter
from app.api.endpoints import rag, payments, agents

router = APIRouter()

router.include_router(rag.router, prefix="/rag", tags=["RAG"])
router.include_router(payments.router, prefix="/payments", tags=["Payments"])
router.include_router(agents.router, prefix="/agents", tags=["Agents"])
