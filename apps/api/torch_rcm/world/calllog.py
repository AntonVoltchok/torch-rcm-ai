"""WorldCallLog: every call into a simulated system is recorded (the provenance behind Evidence and root cause).

Mutating calls are idempotent by key: a repeat with the same `idempotency_key` returns the stored response and
does nothing in the world (07-agents §5.4). Reads are recorded too, with a unique key per call.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import Any

from torch_rcm.clock import ClockLike
from torch_rcm.db.store import Store
from torch_rcm.domain.entities import WorldCallLog


class WorldUnavailableError(RuntimeError):
    """A simulated system is down (portal outage). `retry_after` is sim time."""

    def __init__(self, system: str, since: datetime, retry_after: datetime) -> None:
        super().__init__(f"{system} unavailable since {since:%H:%M}; retry after {retry_after:%H:%M}")
        self.system = system
        self.since = since
        self.retry_after = retry_after


class CallLog:
    def __init__(self, store: Store, clock: ClockLike) -> None:
        self.store = store
        self.clock = clock
        self._issued: set[str] = set()  # ids taken by calls still in flight

    def _id(self, at: datetime) -> str:
        """Unique against the rows, not this process: the clock is frozen and survives a restart."""
        n = self.store.count(WorldCallLog)
        while True:
            n += 1
            call_id = f"wc_{at:%m%d%H%M%S}_{n:06d}"
            if call_id not in self._issued and self.store.get(WorldCallLog, call_id) is None:
                self._issued.add(call_id)
                return call_id

    def record(
        self,
        system: str,
        operation: str,
        fn: Callable[[], dict[str, Any]],
        *,
        key: str | None = None,
        run_id: str | None = None,
        claim_id: str | None = None,
        mutation: bool = False,
        request: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        at = self.clock.now()
        if key is not None:
            existing = self.store.find(WorldCallLog, {"idempotency_key": key}, limit=1)
            if existing:
                return existing[0].response
        call_id = self._id(at)
        try:
            response = fn()
        except WorldUnavailableError as exc:
            self.store.insert(
                WorldCallLog(
                    id=call_id,
                    system=system,
                    operation=operation,
                    at=at,
                    idempotency_key=f"{key or call_id}:failed:{at.isoformat()}",
                    run_id=run_id,
                    claim_id=claim_id,
                    mutation=mutation,
                    request=request or {},
                    ok=False,
                    error=str(exc),
                )
            )
            raise
        self.store.insert(
            WorldCallLog(
                id=call_id,
                system=system,
                operation=operation,
                at=at,
                idempotency_key=key or call_id,
                run_id=run_id,
                claim_id=claim_id,
                mutation=mutation,
                request=request or {},
                response=response,
            )
        )
        return {**response, "world_call_id": call_id}
