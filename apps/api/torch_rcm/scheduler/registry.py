"""Job handler registry. World handlers register here at import of torch_rcm.scheduler.handlers; the agents package
registers `run.start`, `run.execute`, `era.arrived`, … the same way:

    from torch_rcm.scheduler.registry import registry

    @registry.handler("run.start")
    async def start_run(ctx: JobContext) -> JobOutcome | None: ...

A handler may be sync or async. It returns an optional JobOutcome (events to report in `events_fired`, runs it
started) and may enqueue follow-up jobs through `ctx.enqueue`, which stamps them with the current advance.
"""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from torch_rcm.clock import ClockLike
from torch_rcm.db.store import Store
from torch_rcm.domain.entities import Job


@dataclass
class JobOutcome:
    events: list[dict[str, Any]] = field(default_factory=list)
    runs_started: int = 0
    live_runs: int = 0

    def add(self, kind: str, summary: str, **data: Any) -> None:
        self.events.append({"kind": kind, "summary": summary, "data": data})


@dataclass
class JobContext:
    job: Job
    store: Store
    clock: ClockLike
    world: Any  # torch_rcm.world.sim.World (Any to keep this module import-light for the agents package)
    enqueue_fn: Callable[..., Job]
    advance_id: str | None = None

    def enqueue(
        self, kind: str, due_at: datetime, payload: dict[str, Any], key: str, priority: int | None = None
    ) -> Job:
        return self.enqueue_fn(kind, due_at, payload, key, priority=priority, advance_id=self.advance_id)

    @property
    def now(self) -> datetime:
        return self.clock.now()


Handler = Callable[[JobContext], "JobOutcome | Awaitable[JobOutcome | None] | None"]


class Registry:
    def __init__(self) -> None:
        self._handlers: dict[str, Handler] = {}

    def register(self, kind: str, handler: Handler, *, replace: bool = False) -> None:
        if kind in self._handlers and not replace:
            raise ValueError(f"a handler for {kind} is already registered")
        self._handlers[kind] = handler

    def handler(self, kind: str, *, replace: bool = False) -> Callable[[Handler], Handler]:
        def decorate(fn: Handler) -> Handler:
            self.register(kind, fn, replace=replace)
            return fn

        return decorate

    def unregister(self, kind: str) -> None:
        self._handlers.pop(kind, None)

    def kinds(self) -> frozenset[str]:
        return frozenset(self._handlers)

    def get(self, kind: str) -> Handler | None:
        return self._handlers.get(kind)

    async def call(self, ctx: JobContext) -> JobOutcome | None:
        handler = self._handlers[ctx.job.kind]
        result = handler(ctx)
        if inspect.isawaitable(result):
            result = await result
        return result


registry = Registry()
