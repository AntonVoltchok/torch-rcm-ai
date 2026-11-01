"""Structured JSON logging (structlog). One line per event; ids only, never world content or PHI.

Falls back to a stdlib JSON formatter when structlog is not importable, so pure modules and their tests run
anywhere; the dependency is declared in pyproject.toml and used whenever installed.
"""

from __future__ import annotations

import json
import logging
import sys
from typing import Any

try:  # pragma: no cover - exercised where structlog is installed
    import structlog
except ImportError:  # pragma: no cover
    structlog = None  # type: ignore[assignment]

_state = {"configured": False}


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "event": record.getMessage(),
            "level": record.levelname.lower(),
            "logger": record.name,
        }
        payload.update(getattr(record, "fields", {}))
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


class _StdlibLogger:
    def __init__(self, name: str) -> None:
        self._log = logging.getLogger(name)

    def _emit(self, level: int, event: str, **fields: Any) -> None:
        exc = fields.pop("exc_info", None)
        self._log.log(level, event, extra={"fields": fields}, exc_info=exc)

    def info(self, event: str, **fields: Any) -> None:
        self._emit(logging.INFO, event, **fields)

    def warning(self, event: str, **fields: Any) -> None:
        self._emit(logging.WARNING, event, **fields)

    def error(self, event: str, **fields: Any) -> None:
        self._emit(logging.ERROR, event, **fields)

    def exception(self, event: str, **fields: Any) -> None:
        self._emit(logging.ERROR, event, exc_info=True, **fields)


def configure(level: str = "INFO") -> None:
    if _state["configured"]:
        return
    _state["configured"] = True
    logging.basicConfig(stream=sys.stdout, level=level.upper(), format="%(message)s")
    if structlog is not None:
        structlog.configure(
            processors=[
                structlog.contextvars.merge_contextvars,
                structlog.processors.add_log_level,
                structlog.processors.TimeStamper(fmt="iso", utc=True),
                structlog.processors.format_exc_info,
                structlog.processors.JSONRenderer(),
            ],
            wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(level.upper())),
            cache_logger_on_first_use=True,
        )
    else:
        for handler in logging.getLogger().handlers:
            handler.setFormatter(_JsonFormatter())


def get_logger(name: str) -> Any:
    if structlog is not None:
        return structlog.get_logger(name)
    return _StdlibLogger(name)
