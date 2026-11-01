"""API errors: `{error: {code, message, details?}}` with the codes listed per endpoint in docs/spec/02-api.md."""

from __future__ import annotations

from typing import Any


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details

    def body(self) -> dict[str, Any]:
        error: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details is not None:
            error["details"] = self.details
        return {"error": error}


def not_found(kind: str, ident: str) -> ApiError:
    return ApiError(404, "not_found", f"{kind} {ident} not found")


def forbidden(code: str, message: str, **details: Any) -> ApiError:
    return ApiError(403, code, message, details or None)


def conflict(code: str, message: str, **details: Any) -> ApiError:
    return ApiError(409, code, message, details or None)


def unprocessable(code: str, message: str, **details: Any) -> ApiError:
    return ApiError(422, code, message, details or None)
