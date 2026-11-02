"""The scheduler loop: `run_due(until)` for `POST /clock/advance`, and the background worker.

Causality without bookkeeping (docs/plans/api-core.md D3): jobs run one at a time in (due_at, priority, id)
order with the sim clock set to each job's due_at. A handler's follow-ups are enqueued at the current instant (or
later), so they sort before anything that was due later — the 06:00 payer ack lands before the 07:00 status
check, and the agent runs a handler spawns finish before the next world event.
"""

from __future__ import annotations

import asyncio
import contextlib
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from torch_rcm.clock import Clock
from torch_rcm.db.store import Store
from torch_rcm.domain.entities import Advance, Job
from torch_rcm.domain.enums import AdvanceState, JobState
from torch_rcm.events import FIREHOSE, publish
from torch_rcm.log import get_logger
from torch_rcm.scheduler.handlers import register_world_handlers
from torch_rcm.scheduler.kinds import AGENT_KINDS
from torch_rcm.scheduler.queue import JobQueue
from torch_rcm.scheduler.registry import JobContext, Registry, registry

log = get_logger(__name__)
MAX_JOBS_PER_ADVANCE = 50_000


class AdvanceInProgressError(RuntimeError):
    def __init__(self, advance_id: str) -> None:
        super().__init__(f"advance {advance_id} is running")
        self.advance_id = advance_id


@dataclass
class AdvanceResult:
    advance_id: str
    now: datetime
    events_fired: list[dict[str, Any]] = field(default_factory=list)
    runs_started: int = 0
    live_runs: int = 0
    skipped_unhandled: dict[str, int] = field(default_factory=dict)


class Scheduler:
    def __init__(
        self, store: Store, clock: Clock, world: Any, reg: Registry = registry, owner: str | None = None
    ) -> None:
        self.store = store
        self.clock = clock
        self.world = world
        self.registry = reg
        self.owner = owner or f"boot_{uuid.uuid4().hex[:8]}"
        self.queue = JobQueue(store, clock, self.owner)
        self.advance_lock = asyncio.Lock()
        self._task: asyncio.Task[Advance] | None = None
        register_world_handlers(reg)

    # ── enqueue ────────────────────────────────────────────────────────────────────────────────────────────

    def enqueue(
        self,
        kind: str,
        due_at: datetime,
        payload: dict[str, Any],
        key: str,
        priority: int | None = None,
        advance_id: str | None = None,
    ) -> Job:
        return self.queue.enqueue(kind, due_at, payload, key, priority=priority, advance_id=advance_id)

    def handled_kinds(self) -> frozenset[str]:
        kinds = self.registry.kinds()
        if self.agents_paused():
            kinds = kinds - AGENT_KINDS
        return kinds

    def agents_paused(self) -> bool:
        from torch_rcm.domain.entities import Practice

        practices = self.store.all(Practice)
        return bool(practices and practices[0].agents_paused)

    # ── one job ────────────────────────────────────────────────────────────────────────────────────────────

    async def run_one(self, job: Job, advance_id: str | None, result: AdvanceResult | None) -> bool:
        claimed = self.queue.claim(job)
        if claimed is None:
            return False
        ctx = JobContext(
            job=claimed,
            store=self.store,
            clock=self.clock,
            world=self.world,
            enqueue_fn=self.enqueue,
            advance_id=advance_id,
        )
        try:
            outcome = await self.registry.call(ctx)
        except Exception as exc:
            log.exception("job.failed", job_id=claimed.id, kind=claimed.kind)
            self.queue.fail(claimed, f"{type(exc).__name__}: {exc}")
            if result is not None:
                result.events_fired.append(
                    {
                        "at": self.clock.now().isoformat(),
                        "kind": "job_failed",
                        "summary": f"{claimed.kind} failed: {exc}",
                        "job_id": claimed.id,
                        "data": {},
                    }
                )
            return True
        self.queue.complete(claimed, {"events": len(outcome.events) if outcome else 0})
        if outcome and result is not None:
            at = self.clock.now().isoformat()
            for ev in outcome.events:
                result.events_fired.append({"at": at, "job_id": claimed.id, **ev})
            result.runs_started += outcome.runs_started
            result.live_runs += outcome.live_runs
        log.info("job.done", job_id=claimed.id, kind=claimed.kind, sim_time=self.clock.now().isoformat())
        return True

    # ── advance ────────────────────────────────────────────────────────────────────────────────────────────

    async def run_due(self, until: datetime, advance: Advance | None = None) -> AdvanceResult:
        """Run every handled job with due_at ≤ until, in order, then set the clock to `until`."""
        result = AdvanceResult(advance_id=advance.id if advance else "inline", now=self.clock.now())
        for _ in range(MAX_JOBS_PER_ADVANCE):
            job = self.queue.next_due(until, self.handled_kinds())
            if job is None:
                break
            if job.due_at > self.clock.now():
                self.clock.set(job.due_at)
            await self.run_one(job, advance.id if advance else None, result)
            if advance is not None:
                self._progress(advance, result, done=False)
        if until > self.clock.now():
            self.clock.set(until)
        result.now = self.clock.now()
        result.skipped_unhandled = self._unhandled(until)
        return result

    def _unhandled(self, until: datetime) -> dict[str, int]:
        handled = self.handled_kinds()
        rows = self.store.find(Job, {"state": JobState.QUEUED}, sql="due_at <= ?", params=[until])
        out: dict[str, int] = {}
        for job in rows:
            if job.kind not in handled:
                out[job.kind] = out.get(job.kind, 0) + 1
        return out

    def _progress(self, advance: Advance, result: AdvanceResult, *, done: bool) -> None:
        advance.now = self.clock.now()
        advance.events_fired = result.events_fired
        advance.runs_started = result.runs_started
        advance.live_runs = result.live_runs
        advance.skipped_unhandled = result.skipped_unhandled
        if done:
            advance.state = AdvanceState.DONE
        self.store.update(advance)
        self._publish_advance(advance, done=done)

    def _fail(self, advance: Advance, error: str) -> None:
        """Failure is terminal too: a client following the firehose stops only on `done`."""
        advance.now = self.clock.now()
        advance.state = AdvanceState.FAILED
        advance.error = error
        self.store.update(advance)
        self._publish_advance(advance, done=True, state=advance.state.value, error=error)

    def _publish_advance(self, advance: Advance, *, done: bool, **failure: str) -> None:
        publish(
            self.store,
            FIREHOSE,
            "advance",
            {
                "advance_id": advance.id,
                "now": advance.now.isoformat(),
                "events_fired": advance.events_fired if done else len(advance.events_fired),
                "runs_started": advance.runs_started,
                "live_runs": advance.live_runs,
                "done": done,
                **failure,
            },
            self.clock.now(),
        )

    def current_advance(self) -> Advance | None:
        rows = self.store.find(Advance, {"state": AdvanceState.RUNNING}, limit=1)
        return rows[0] if rows else None

    def begin_advance(self, to: datetime, requested_by: str | None) -> Advance:
        running = self.current_advance()
        if running is not None or self.advance_lock.locked():
            raise AdvanceInProgressError(running.id if running else "unknown")
        now = self.clock.now()
        if to <= now:
            raise ValueError("advance target must be after the current sim time")
        advance = Advance(
            id=f"adv_{uuid.uuid4().hex[:10]}",
            from_at=now,
            to_at=to,
            now=now,
            state=AdvanceState.RUNNING,
            requested_by=requested_by,
        )
        self.store.insert(advance)
        return advance

    async def execute_advance(self, advance: Advance) -> Advance:
        async with self.advance_lock:
            try:
                result = await self.run_due(advance.to_at, advance)
                self._progress(advance, result, done=True)
            except asyncio.CancelledError:
                self._fail(advance, "interrupted by shutdown")
                raise
            except Exception as exc:
                log.exception("advance.failed", advance_id=advance.id)
                self._fail(advance, f"{type(exc).__name__}: {exc}")
        return advance

    def start_advance(self, to: datetime, requested_by: str | None = None) -> Advance:
        """Begin an advance and run it as a background task (202 semantics). Raises AdvanceInProgressError."""
        advance = self.begin_advance(to, requested_by)
        self._task = asyncio.get_running_loop().create_task(self.execute_advance(advance))
        return advance

    async def wait(self) -> None:
        if self._task is not None:
            await self._task

    def recover(self) -> None:
        """Boot: reclaim job leases and fail advances the last process left `running`. That row is the lock
        `begin_advance` reads, so one left behind would answer 409 to every advance until a reset."""
        self.queue.recover()
        for advance in self.store.find(Advance, {"state": AdvanceState.RUNNING}):
            self._fail(advance, "interrupted by a restart")

    # ── background worker ──────────────────────────────────────────────────────────────────────────────────

    async def worker_loop(self, stop: asyncio.Event, poll_seconds: float = 0.25) -> None:
        """Take jobs due at the current (frozen) instant — approval runs, mostly. Pauses during an advance."""
        self.queue.recover()
        while not stop.is_set():
            ran = False
            if not self.advance_lock.locked():
                job = self.queue.next_due(self.clock.now(), self.handled_kinds())
                if job is not None:
                    ran = await self.run_one(job, None, None)
            if not ran:
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(stop.wait(), timeout=poll_seconds)
