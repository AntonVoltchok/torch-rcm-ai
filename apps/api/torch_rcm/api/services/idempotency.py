"""`Idempotency-Key` for mutations: a stored-response table keyed `(user_id, key)`.

The web client sends a fresh key per user intent (`client.ts`), so a retried request (network blip, double
click, a re-sent optimistic mutation) returns the first response instead of acting twice. Only successful
responses are stored: a refused mutation changed nothing, so a retry runs again and gets a fresh answer.
The whole mutation runs inside one write transaction, so two concurrent requests with one key serialize and the
second one replays. Run-level dedupe (`approval:{item_id}`) stays as the second line of defence.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from typing import Any

from pydantic import BaseModel

from torch_rcm.api.errors import ApiError
from torch_rcm.api.services.context import Ctx
from torch_rcm.domain.entities import IdempotencyRecord

MAX_KEY_LEN = 200


def record_id(user_id: str, key: str) -> str:
    return "idem_" + hashlib.sha256(f"{user_id}\0{key}".encode()).hexdigest()[:24]


def request_sha(scope: str, request: Any) -> str:
    payload = json.dumps(request, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(f"{scope}\n{payload}".encode()).hexdigest()


def idempotent[M: BaseModel](
    ctx: Ctx,
    key: str | None,
    scope: str,
    request: Any,
    model: type[M],
    run: Callable[[], M],
    *,
    status_code: int = 200,
) -> M:
    """Run `run()` once per `(user, key)`; later calls with the same key return the stored response."""
    if key is None:
        return run()
    if not key or len(key) > MAX_KEY_LEN:
        raise ApiError(422, "invalid_idempotency_key", f"Idempotency-Key must be 1–{MAX_KEY_LEN} characters")
    store = ctx.rt.store
    rid = record_id(ctx.user.id, key)
    sha = request_sha(scope, request)
    with store.tx():
        stored = store.get(IdempotencyRecord, rid)
        if stored is not None:
            if stored.request_sha != sha:
                raise ApiError(
                    422,
                    "idempotency_key_reused",
                    f"Idempotency-Key {key!r} was used for {stored.scope} with a different request",
                )
            return model.model_validate(stored.body)
        out = run()
        store.insert(
            IdempotencyRecord(
                id=rid,
                user_id=ctx.user.id,
                key=key,
                scope=scope,
                request_sha=sha,
                status_code=status_code,
                body=out.model_dump(mode="json"),
                created_at=ctx.now,
            )
        )
        return out
