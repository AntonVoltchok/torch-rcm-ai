"""The durable job queue (`jobs` table): at-least-once delivery, idempotency keys, leases, retries, parking.

Due times are sim time; leases are wall time (torch/scheduler/leases.py). Handlers must be idempotent: a job can
run twice if a process dies after the handler but before `complete`.
"""

from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Any

from torch.clock import ClockLike
from torch.db.store import Store
from torch.domain.entities import Job
from torch.domain.enums import JobState
from torch.scheduler import leases
from torch.scheduler.kinds import PRIORITY


def job_id(idempotency_key: str) -> str:
    return "job_" + hashlib.sha256(idempotency_key.encode()).hexdigest()[:20]


class JobQueue:
    def __init__(self, store: Store, clock: ClockLike, owner: str = "boot") -> None:
        self.store = store
        self.clock = clock
        self.owner = owner

    def enqueue(
        self,
        kind: str,
        due_at: datetime,
        payload: dict[str, Any],
        idempotency_key: str,
        priority: int | None = None,
        advance_id: str | None = None,
    ) -> Job:
        """Idempotent: a second enqueue with the same key returns the existing job unchanged."""
        existing = self.store.get(Job, job_id(idempotency_key))
        if existing is not None:
            return existing
        job = Job(
            id=job_id(idempotency_key),
            kind=kind,
            due_at=due_at,
            priority=PRIORITY.get(kind, 50) if priority is None else priority,
            payload=payload,
            idempotency_key=idempotency_key,
            advance_id=advance_id,
            created_at=self.clock.now(),
        )
        self.store.insert(job)
        return job

    def next_due(self, until: datetime, kinds: frozenset[str] | set[str]) -> Job | None:
        """The next queued job (due_at, priority, id) with due_at ≤ until among handled kinds."""
        if not kinds:
            return None
        rows = self.store.find(
            Job,
            {"state": JobState.QUEUED, "kind": sorted(kinds)},
            sql="due_at <= ?",
            params=[until],
            order_by=["due_at", "priority"],
            limit=1,
        )
        return rows[0] if rows else None

    def claim(self, job: Job) -> Job | None:
        """Lease a queued job. Returns None if someone else got it first."""
        with self.store.tx():
            current = self.store.get(Job, job.id)
            if current is None or current.state is not JobState.QUEUED:
                return None
            current.state = JobState.LEASED
            current.lease_owner = self.owner
            current.lease_until = leases.lease_until()
            current.attempts += 1
            self.store.update(current)
            return current

    def complete(self, job: Job, result: dict[str, Any] | None = None) -> None:
        job.state = JobState.DONE
        job.finished_at = self.clock.now()
        job.result = result or {}
        job.lease_owner = None
        job.lease_until = None
        self.store.update(job)

    def fail(self, job: Job, error: str) -> None:
        job.last_error = error[:2000]
        job.lease_owner = None
        job.lease_until = None
        job.state = JobState.DEAD if job.attempts >= job.max_attempts else JobState.QUEUED
        if job.state is JobState.DEAD:
            job.finished_at = self.clock.now()
        self.store.update(job)

    def park_kinds(self, kinds: set[str]) -> int:
        """Kill switch: queued agent jobs are parked (not re-polled) until resume."""
        rows = self.store.find(Job, {"state": JobState.QUEUED, "kind": sorted(kinds)})
        with self.store.tx():
            for job in rows:
                job.state = JobState.PARKED
                self.store.update(job)
        return len(rows)

    def unpark(self) -> int:
        rows = self.store.find(Job, {"state": JobState.PARKED})
        with self.store.tx():
            for job in rows:
                job.state = JobState.QUEUED
                self.store.update(job)
        return len(rows)

    def recover(self) -> int:
        """On boot: leased jobs whose lease expired or belongs to another boot go back to queued."""
        rows = self.store.find(Job, {"state": JobState.LEASED})
        n = 0
        with self.store.tx():
            for job in rows:
                if job.lease_owner != self.owner or leases.expired(job.lease_until):
                    job.state = JobState.QUEUED
                    job.lease_owner = None
                    job.lease_until = None
                    self.store.update(job)
                    n += 1
        return n

    def counts(self) -> dict[str, int]:
        return {state.value: self.store.count(Job, {"state": state}) for state in JobState}
