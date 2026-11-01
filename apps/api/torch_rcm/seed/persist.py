"""Write a SeedWorld into the store: drop, create, insert, set the clock, persist plan schedules and the job queue."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from torch_rcm.clock import CLOCK_KEY
from torch_rcm.db.store import Store
from torch_rcm.domain.entities import Meta
from torch_rcm.seed.builder import SeedWorld
from torch_rcm.seed.schedule import initial_jobs
from torch_rcm.world.fees import Category, PlanSchedule, ScheduleBook

SCHEDULES_KEY = "schedules"
SEED_KEY = "seed"


def persist(store: Store, world: SeedWorld) -> None:
    store.drop_all()
    store.create_schema()
    with store.tx():
        for rows in world.entities.values():
            store.insert_many(rows)
        store.insert_many(initial_jobs(world))
        store.upsert(Meta(id=CLOCK_KEY, value={"now": world.now.isoformat(), "frozen": True}))
        store.upsert(Meta(id=SCHEDULES_KEY, value=dump_schedules(world.schedules)))
        store.upsert(
            Meta(
                id=SEED_KEY,
                value={"seed": world.seed, "scenario": world.scenario, "now": world.now.isoformat()},
            )
        )


def dump_schedules(book: ScheduleBook) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in book.keys():  # noqa: SIM118 - ScheduleBook.keys() is a method, not a dict
        s = book.get(key)
        out[key] = {
            "payer": s.payer,
            "factors": {k.value: v for k, v in s.factors.items()},
            "explicit": dict(s.explicit),
        }
    return out


def load_schedules(store: Store) -> ScheduleBook:
    book = ScheduleBook()
    row = store.get(Meta, SCHEDULES_KEY)
    if row is None:
        return book
    for key, spec in row.value.items():
        book.register(
            PlanSchedule(
                key,
                spec["payer"],
                {Category(k): float(v) for k, v in spec["factors"].items()},
                {k: int(v) for k, v in spec["explicit"].items()},
            )
        )
    return book


def seed_info(store: Store) -> dict[str, Any] | None:
    row = store.get(Meta, SEED_KEY)
    return dict(row.value) if row else None


def seeded_now(store: Store) -> datetime | None:
    info = seed_info(store)
    return datetime.fromisoformat(info["now"]) if info else None
