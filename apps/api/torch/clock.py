"""The frozen, advanceable simulation clock.

Nothing in Torch reads wall-clock time for business logic. "Now" is a value persisted in the database (`meta`
row `clock`), so a restarted API keeps the demo's time, and every process (API, CLI) sees the same instant.
It only moves forward, through `advance()`/`set()` (the scheduler) or `reset()` (reseed).
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Protocol
from zoneinfo import ZoneInfo

from torch.db.store import Store
from torch.domain.entities import Meta

PRACTICE_TZ = ZoneInfo("America/New_York")
CLOCK_KEY = "clock"


class ClockError(ValueError):
    pass


class ClockLike(Protocol):
    def now(self) -> datetime: ...


def to_practice_tz(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ClockError("naive datetimes are not allowed; attach the practice timezone")
    return value.astimezone(PRACTICE_TZ)


class FixedClock:
    """An in-memory clock for pure code and tests."""

    def __init__(self, at: datetime) -> None:
        self._now = to_practice_tz(at)

    def now(self) -> datetime:
        return self._now

    def set(self, at: datetime) -> datetime:
        at = to_practice_tz(at)
        if at < self._now:
            raise ClockError(f"clock cannot move backwards ({at} < {self._now})")
        self._now = at
        return self._now

    def advance(self, delta: timedelta) -> datetime:
        return self.set(self._now + delta)


class Clock:
    """The persisted sim clock. Reads go to SQLite each time so separate processes agree."""

    def __init__(self, store: Store, start: datetime) -> None:
        self.store = store
        self.start = to_practice_tz(start)

    def now(self) -> datetime:
        row = self.store.get(Meta, CLOCK_KEY)
        if row is None:
            return self.start
        return to_practice_tz(datetime.fromisoformat(row.value["now"]))

    def set(self, at: datetime) -> datetime:
        at = to_practice_tz(at)
        current = self.now()
        if at < current:
            raise ClockError(f"clock cannot move backwards ({at.isoformat()} < {current.isoformat()})")
        self._write(at)
        return at

    def advance(self, delta: timedelta) -> datetime:
        if delta < timedelta(0):
            raise ClockError("advance takes a non-negative delta")
        return self.set(self.now() + delta)

    def reset(self, at: datetime | None = None) -> datetime:
        target = to_practice_tz(at) if at else self.start
        self._write(target)
        return target

    def _write(self, at: datetime) -> None:
        self.store.upsert(Meta(id=CLOCK_KEY, value={"now": at.isoformat(), "frozen": True}))
