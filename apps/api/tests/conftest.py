"""Shared fixtures.

- `canonical_world` / `canonical`: the seed built once per session, as entities and as a Snapshot (pure).
- `rt`: a Runtime over a fresh SQLite file per test, copied from a template seeded once per session.
- `world_only_registry`: a job registry with only the world handlers (agent kinds stay queued), so tests can
  register recording stand-ins for torch.agents without touching the global registry.
"""

from __future__ import annotations

import shutil
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path

import pytest

from torch.config import Settings
from torch.db.store import Store
from torch.readmodels.snapshot import Snapshot
from torch.runtime import Runtime
from torch.scheduler.registry import Registry
from torch.seed.builder import SeedWorld
from torch.seed.canonical import build
from torch.seed.persist import persist

THURSDAY_0710 = datetime.fromisoformat("2026-10-29T07:10:00-04:00")
FRIDAY_0710 = datetime.fromisoformat("2026-10-30T07:10:00-04:00")


@pytest.fixture(scope="session")
def canonical_world() -> SeedWorld:
    return build()


@pytest.fixture(scope="session")
def canonical(canonical_world: SeedWorld) -> Snapshot:
    return Snapshot.from_entities(canonical_world.now, canonical_world.entities)


@pytest.fixture(scope="session")
def template_db(tmp_path_factory: pytest.TempPathFactory, canonical_world: SeedWorld) -> Path:
    path = tmp_path_factory.mktemp("template") / "canonical.db"
    store = Store(path)
    persist(store, canonical_world)
    store.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    store.close()
    return path


@pytest.fixture
def world_only_registry() -> Registry:
    return Registry()


@pytest.fixture
def rt(tmp_path: Path, template_db: Path, world_only_registry: Registry) -> Iterator[Runtime]:
    db = tmp_path / "torch.db"
    shutil.copy(template_db, db)
    settings = Settings(db_url=f"sqlite:///{db}")
    runtime = Runtime.open(settings, reg=world_only_registry)
    yield runtime
    runtime.store.close()


def snap(rt: Runtime) -> Snapshot:
    return Snapshot.from_store(rt.store, rt.clock.now())
