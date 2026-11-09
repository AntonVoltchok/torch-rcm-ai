"""Settings from `TORCH_*` environment variables (see /.env.example).

Uses pydantic-settings when installed (declared in pyproject.toml); falls back to reading the environment with
the same field names so pure code and its tests run without it.

The repo-root `.env` is loaded into the process environment by `load_env_file()` (from `get_settings()` and
`AgentConfig.from_env()`), so `make api` (run from apps/api) and the `torch` CLI read the same file. Variables
already set win. `TORCH_DOTENV=0` skips it; the test suite sets it so a developer's key never reaches a test.
"""

from __future__ import annotations

import os
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

try:  # pragma: no cover - exercised where pydantic-settings is installed
    from pydantic_settings import BaseSettings, SettingsConfigDict

    _HAVE_SETTINGS = True
except ImportError:  # pragma: no cover
    BaseSettings = BaseModel  # type: ignore[misc,assignment]
    SettingsConfigDict = dict  # type: ignore[misc,assignment]
    _HAVE_SETTINGS = False


class Settings(BaseSettings):  # type: ignore[misc,valid-type]
    if _HAVE_SETTINGS:
        model_config = SettingsConfigDict(env_prefix="TORCH_", extra="ignore")

    agent_mode: Literal["deterministic", "live"] = "deterministic"
    clock_start: datetime = datetime.fromisoformat("2026-10-28T10:40:00-04:00")
    db_url: str = "sqlite:///./torch.db"
    scenario: str = "canonical"
    seed: int = 20261028
    log_level: str = "INFO"
    worker: bool = True
    # TORCH_ALLOW_WORLD_ONLY=1: boot without torch_rcm.agents if it fails to import (debugging the world only).
    allow_world_only: bool = False
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"])

    @property
    def db_path(self) -> str:
        """`sqlite:///./torch.db` → `./torch.db`; `sqlite://` or `:memory:` → in-memory."""
        url = self.db_url
        if url in ("sqlite://", ":memory:", "sqlite:///:memory:"):
            return ":memory:"
        return url.removeprefix("sqlite:///") if url.startswith("sqlite:///") else url


def _from_env() -> Settings:
    if _HAVE_SETTINGS:
        settings: Settings = Settings()
        return settings
    values: dict[str, object] = {}
    for name in Settings.model_fields:
        raw = os.environ.get(f"TORCH_{name.upper()}")
        if raw is not None and raw != "":
            values[name] = raw.split("#", 1)[0].strip()
    return Settings.model_validate(values)


def _repo_env_file() -> Path | None:
    """`<repo>/.env` from `<repo>/apps/api/torch_rcm/config.py`; None where the tree is flatter (the image)."""
    parents = Path(__file__).resolve().parents
    return parents[3] / ".env" if len(parents) > 3 else None


def load_env_file(path: Path | None = None) -> bool:
    """Load `.env` into `os.environ` without overriding what is set. True when a file was read."""
    if os.environ.get("TORCH_DOTENV") == "0":
        return False
    path = path or _repo_env_file()
    if path is None or not path.is_file():
        return False
    from dotenv import load_dotenv

    load_dotenv(path, override=False)
    return True


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    load_env_file()
    return _from_env()
