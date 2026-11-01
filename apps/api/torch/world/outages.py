"""Seeded outage schedule (~2% of business hours per payer portal) plus injected outages (`/_world/inject`)."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

from torch.clock import PRACTICE_TZ
from torch.db.store import Store
from torch.domain.entities import Meta
from torch.world.calendar import is_business_day
from torch.world.rng import keyed_chance

OUTAGE_KEY = "outages"
BUSINESS_HOURS = range(7, 19)


class Outages:
    def __init__(self, store: Store, seed: int) -> None:
        self.store = store
        self.seed = seed

    def _injected(self) -> dict[str, dict[str, str]]:
        row = self.store.get(Meta, OUTAGE_KEY)
        return dict(row.value) if row else {}

    def inject(self, system: str, since: datetime, until: datetime | None = None) -> None:
        current = self._injected()
        current[system] = {"since": since.isoformat(), "until": until.isoformat() if until else ""}
        self.store.upsert(Meta(id=OUTAGE_KEY, value=current))

    def restore(self, system: str) -> None:
        current = self._injected()
        current.pop(system, None)
        self.store.upsert(Meta(id=OUTAGE_KEY, value=current))

    def window(self, system: str, at: datetime) -> tuple[datetime, datetime] | None:
        """(since, retry_after) if `system` is down at `at`, else None."""
        injected = self._injected().get(system)
        if injected:
            since = datetime.fromisoformat(injected["since"])
            until = datetime.fromisoformat(injected["until"]) if injected["until"] else None
            if since <= at and (until is None or at < until):
                return since, until or at + timedelta(hours=2)
        local = at.astimezone(PRACTICE_TZ)
        if (
            is_business_day(local.date())
            and local.hour in BUSINESS_HOURS
            and self._seeded(system, local.date(), local.hour)
        ):
            start = datetime.combine(local.date(), time(local.hour), tzinfo=PRACTICE_TZ)
            return start, start + timedelta(hours=1)
        return None

    def _seeded(self, system: str, day: date, hour: int) -> bool:
        return keyed_chance(self.seed, 0.02, "outage", system, day.isoformat(), hour)

    def snapshot(self, at: datetime, systems: list[str]) -> dict[str, dict[str, str] | None]:
        out: dict[str, dict[str, str] | None] = {}
        for system in systems:
            w = self.window(system, at)
            out[system] = {"since": w[0].isoformat(), "retry_after": w[1].isoformat()} if w else None
        return out
