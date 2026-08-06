from fastapi import APIRouter

from app.api.endpoints import (
    agents,
    conversations,
    documents,
    marketplace,
    payments,
    rag,
    system,
)

api_router = APIRouter()

api_router.include_router(system.router, tags=["System"])
api_router.include_router(
    marketplace.router, prefix="/marketplace", tags=["Discovery Network"]
)
api_router.include_router(rag.router, prefix="/rag", tags=["Knowledge API"])
api_router.include_router(documents.router, prefix="/documents", tags=["Documents"])
api_router.include_router(payments.router, prefix="/payments", tags=["Payments · x402"])
api_router.include_router(agents.router, prefix="/agents", tags=["Agents"])
api_router.include_router(
    conversations.router, prefix="/conversations", tags=["Conversations"]
)
