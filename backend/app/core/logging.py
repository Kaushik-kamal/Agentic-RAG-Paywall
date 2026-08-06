"""Structured logging with per-request correlation IDs."""

from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from typing import Any

request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")

_RESERVED = frozenset(
    logging.LogRecord("", 0, "", 0, "", None, None).__dict__.keys()
) | {"message", "asctime", "taskName"}


class ContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_ctx.get()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", "-"),
        }
        for key, value in record.__dict__.items():
            if key not in _RESERVED and key != "request_id":
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


class ConsoleFormatter(logging.Formatter):
    COLORS = {
        "DEBUG": "\033[38;5;245m",
        "INFO": "\033[38;5;39m",
        "WARNING": "\033[38;5;214m",
        "ERROR": "\033[38;5;203m",
        "CRITICAL": "\033[48;5;203;38;5;231m",
    }
    RESET = "\033[0m"
    DIM = "\033[38;5;240m"

    def format(self, record: logging.LogRecord) -> str:
        color = self.COLORS.get(record.levelname, "")
        rid = getattr(record, "request_id", "-")
        rid_part = f"{self.DIM}[{rid}]{self.RESET} " if rid != "-" else ""
        head = f"{color}{record.levelname:<8}{self.RESET}"
        body = record.getMessage()
        line = f"{head} {rid_part}{self.DIM}{record.name}{self.RESET} · {body}"
        if record.exc_info:
            line += "\n" + self.formatException(record.exc_info)
        return line


def configure_logging(level: str = "INFO", as_json: bool = False) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if as_json else ConsoleFormatter())
    handler.addFilter(ContextFilter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    # Third-party libraries are chatty; keep the signal-to-noise ratio high.
    for noisy in (
        "httpx",
        "httpcore",
        "urllib3",
        "chromadb",
        "google_genai",
        "google.auth",
        "langchain_google_genai",
        "asyncio",
        "watchfiles",
    ):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    # Chroma's bundled telemetry client is incompatible with current posthog
    # and logs a stack trace per call. We disable telemetry in the client
    # config; this silences the leftover noise.
    logging.getLogger("chromadb.telemetry").setLevel(logging.CRITICAL)

    logging.getLogger("uvicorn.access").handlers.clear()
    logging.getLogger("uvicorn.access").propagate = False
