"""What a process does at the edges: boot refuses without agents, boot clears a dead advance, and the CLI's
`advance` runs the same agents as the API. The CLI goes through a subprocess so handlers registered by other
tests in this process cannot hide a missing registration."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from conftest import THURSDAY_0710
from torch_rcm.api.app import API_PREFIX, create_app
from torch_rcm.api.services.context import Ctx
from torch_rcm.config import Settings
from torch_rcm.domain.entities import Advance
from torch_rcm.domain.enums import AdvanceState
from torch_rcm.runtime import Runtime

MORGAN = {"X-Torch-User": "usr_morgan"}


@pytest.fixture
def db(tmp_path: Path, template_db: Path) -> Path:
    path = tmp_path / "boot.db"
    shutil.copy(template_db, path)
    return path


@pytest.fixture
def agents_unimportable(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setitem(sys.modules, "torch_rcm.agents.handlers", None)
    yield


def settings(db: Path, **overrides: bool) -> Settings:
    return Settings(db_url=f"sqlite:///{db}", worker=False, **overrides)


@pytest.mark.usefixtures("agents_unimportable")
def test_lifespan_refuses_to_boot_without_agents(db: Path) -> None:
    app = create_app(settings(db), start_worker=False)
    with pytest.raises(ImportError), TestClient(app):
        pass


@pytest.mark.usefixtures("agents_unimportable")
def test_world_only_boot_is_an_explicit_opt_in(db: Path) -> None:
    app = create_app(settings(db, allow_world_only=True), start_worker=False)
    with TestClient(app) as client:
        assert client.get(f"{API_PREFIX}/clock", headers=MORGAN).status_code == 200


def test_boot_fails_an_advance_the_last_process_left_running(db: Path) -> None:
    rt = Runtime.open(settings(db))
    now = rt.clock.now()
    stale = Advance(id="adv_stale", from_at=now, to_at=THURSDAY_0710, now=now, state=AdvanceState.RUNNING)
    rt.store.insert(stale)
    with TestClient(create_app(settings(db), start_worker=False)) as client:
        out = client.get(f"{API_PREFIX}/clock/advance/adv_stale", headers=MORGAN).json()
        assert (out["state"], out["done"], out["error"]) == ("failed", True, "interrupted by a restart")
        assert client.post(f"{API_PREFIX}/clock/advance", json={"minutes": 5}, headers=MORGAN).status_code == 202
        client.portal.call(client.app.state.runtime.scheduler.wait)  # type: ignore[attr-defined]


def test_cli_advance_runs_the_agents_like_the_api(db: Path) -> None:
    env = {**os.environ, "TORCH_DB_URL": f"sqlite:///{db}", "TORCH_AGENT_MODE": "deterministic"}
    done = subprocess.run(
        [sys.executable, "-m", "torch_rcm.cli", "advance", "--to", THURSDAY_0710.isoformat()],
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )
    unhandled = done.stdout.rsplit("unhandled", 1)[1]
    assert "era.arrived" not in unhandled and "claim.status_check_due" not in unhandled
    assert (
        Ctx.for_user(Runtime.open(settings(db)), "usr_dana").meta().counts.inbox_open == 16
    )  # 19 in the queue; 3 wait on Dr. Morgan
