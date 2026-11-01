"""Process wiring: one Store, Clock, World and Scheduler per process (API, CLI, tests)."""

from __future__ import annotations

from dataclasses import dataclass

from torch_rcm.clock import Clock
from torch_rcm.config import Settings, get_settings
from torch_rcm.db.store import Store
from torch_rcm.domain.entities import Practice
from torch_rcm.scheduler.registry import Registry, registry
from torch_rcm.scheduler.runner import Scheduler
from torch_rcm.seed.persist import load_schedules, seed_info
from torch_rcm.world.sim import World


@dataclass
class Runtime:
    settings: Settings
    store: Store
    clock: Clock
    world: World
    scheduler: Scheduler

    @classmethod
    def open(cls, settings: Settings | None = None, store: Store | None = None, reg: Registry = registry) -> Runtime:
        settings = settings or get_settings()
        store = store or Store(settings.db_path)
        store.create_schema()
        clock = Clock(store, settings.clock_start)
        info = seed_info(store) or {}
        world = World(store, clock, load_schedules(store), int(info.get("seed", settings.seed)))
        return cls(settings, store, clock, world, Scheduler(store, clock, world, reg))

    def reload_world(self) -> None:
        """After a reseed: plan schedules and the seed may have changed."""
        info = seed_info(self.store) or {}
        self.world = World(
            self.store, self.clock, load_schedules(self.store), int(info.get("seed", self.settings.seed))
        )
        self.scheduler.world = self.world

    def is_seeded(self) -> bool:
        return self.store.count(Practice) > 0
