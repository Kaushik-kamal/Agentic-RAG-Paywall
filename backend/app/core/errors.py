"""Typed application errors and the handlers that render them.

Every error leaving the API has the same JSON shape so clients (and agents)
can branch on ``code`` instead of parsing prose:

    {"error": {"code": "payment_required", "message": "...", "details": {...}},
     "request_id": "..."}
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import request_id_ctx

logger = logging.getLogger(__name__)


class AppError(Exception):
    """Base class for all errors we raise deliberately."""

    status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR
    code: str = "internal_error"
    message: str = "Something went wrong."

    def __init__(
        self,
        message: str | None = None,
        *,
        details: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message or self.message)
        self.message = message or self.message
        self.details = details or {}
        self.headers = headers or {}


class PaymentRequiredError(AppError):
    status_code = status.HTTP_402_PAYMENT_REQUIRED
    code = "payment_required"
    message = "Payment required to access this resource."


class InsufficientCreditsError(AppError):
    status_code = status.HTTP_402_PAYMENT_REQUIRED
    code = "insufficient_credits"
    message = "Query credits exhausted. Purchase more to continue."


class UnauthorizedError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "unauthorized"
    message = "Invalid or expired access token."


class ForbiddenError(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "forbidden"
    message = "You are not allowed to perform this action."


class NotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "not_found"
    message = "Resource not found."


class ValidationError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = "validation_error"
    message = "The request payload is invalid."


class PayloadTooLargeError(AppError):
    status_code = status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
    code = "payload_too_large"
    message = "Uploaded file exceeds the size limit."


class RateLimitedError(AppError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "rate_limited"
    message = "Too many requests. Slow down."


class PaymentVerificationError(AppError):
    status_code = status.HTTP_400_BAD_REQUEST
    code = "payment_verification_failed"
    message = "The Stellar transaction could not be verified."


class ServiceUnavailableError(AppError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "service_unavailable"
    message = "A required upstream service is unavailable."


class KnowledgeBaseEmptyError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "knowledge_base_empty"
    message = (
        "The knowledge base has no documents yet. "
        "Upload a document or seed the demo corpus first."
    )


def _envelope(
    code: str, message: str, details: dict[str, Any] | None = None
) -> dict[str, Any]:
    return {
        "error": {"code": code, "message": message, "details": details or {}},
        "request_id": request_id_ctx.get(),
    }


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        if exc.status_code >= 500:
            logger.error("%s: %s", exc.code, exc.message, exc_info=exc)
        else:
            logger.info("%s: %s", exc.code, exc.message)
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(exc.code, exc.message, exc.details),
            headers=exc.headers or None,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, str) else "Request failed."
        code = {
            401: "unauthorized",
            403: "forbidden",
            404: "not_found",
            405: "method_not_allowed",
            429: "rate_limited",
        }.get(exc.status_code, "http_error")
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(code, detail),
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(
        _: Request, exc: RequestValidationError
    ) -> JSONResponse:
        fields = [
            {
                "field": ".".join(str(p) for p in err.get("loc", ())[1:]) or "body",
                "issue": err.get("msg", "invalid"),
            }
            for err in exc.errors()
        ]
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=_envelope(
                "validation_error",
                "The request payload is invalid.",
                {"fields": fields},
            ),
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled exception: %s", exc)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=_envelope(
                "internal_error",
                "An unexpected error occurred. The incident has been logged.",
            ),
        )
