"""Live-mode wiring (07 §10): the environment reaches the API's shared runtime, a reseed keeps its model client,
and the repo-root `.env` loads without overriding the shell."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from torch_rcm.agents.config import ConfigError
from torch_rcm.agents.llm.cassette import CassetteClient
from torch_rcm.agents.llm.client import LlmClient
from torch_rcm.agents.runtime import AgentRuntime
from torch_rcm.api.app import wire_agent_runtime
from torch_rcm.config import load_env_file
from torch_rcm.runtime import Runtime

ENV_KEYS = ("TORCH_AGENT_MODE", "ANTHROPIC_API_KEY", "TORCH_CASSETTE_MODE", "TORCH_SCENARIO")


def clear(monkeypatch: pytest.MonkeyPatch) -> None:
    """Unset ENV_KEYS so teardown deletes whatever a test (or load_dotenv) sets under them."""
    for key in ENV_KEYS:
        monkeypatch.setenv(key, "")
        monkeypatch.delenv(key)


def shared(rt: Runtime) -> AgentRuntime:
    return AgentRuntime.shared(rt.store, rt.clock, rt.world)  # what the job handlers and HTTP hooks call


def test_live_mode_reaches_the_api_runtime(rt: Runtime, monkeypatch: pytest.MonkeyPatch) -> None:
    clear(monkeypatch)
    monkeypatch.setenv("TORCH_AGENT_MODE", "live")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    wire_agent_runtime(rt)
    art = shared(rt)
    assert art.cfg.agent_mode == "live"
    assert isinstance(art.llm_client, LlmClient)


def test_a_reseed_keeps_the_model_client(rt: Runtime, monkeypatch: pytest.MonkeyPatch) -> None:
    clear(monkeypatch)
    monkeypatch.setenv("TORCH_AGENT_MODE", "live")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    wire_agent_runtime(rt)
    before = shared(rt)
    rt.reload_world()  # POST /clock/reset
    after = shared(rt)
    assert after is not before
    assert isinstance(after.llm_client, LlmClient)


def test_replay_needs_no_key(rt: Runtime, monkeypatch: pytest.MonkeyPatch) -> None:
    clear(monkeypatch)
    monkeypatch.setenv("TORCH_AGENT_MODE", "live")
    monkeypatch.setenv("TORCH_CASSETTE_MODE", "replay")
    wire_agent_runtime(rt)
    assert isinstance(shared(rt).llm_client, CassetteClient)


def test_deterministic_has_no_model_client(rt: Runtime, monkeypatch: pytest.MonkeyPatch) -> None:
    clear(monkeypatch)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    wire_agent_runtime(rt)
    assert shared(rt).llm_client is None


def test_live_without_a_key_refuses_to_boot(rt: Runtime, monkeypatch: pytest.MonkeyPatch) -> None:
    clear(monkeypatch)
    monkeypatch.setenv("TORCH_AGENT_MODE", "live")
    with pytest.raises(ConfigError):
        wire_agent_runtime(rt)


def test_env_file_loads_without_overriding_the_shell(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    clear(monkeypatch)
    monkeypatch.delenv("TORCH_DOTENV", raising=False)
    monkeypatch.setenv("TORCH_SCENARIO", "from_shell")
    env = tmp_path / ".env"
    env.write_text(
        "TORCH_AGENT_MODE=live        # deterministic | live\n"
        "ANTHROPIC_API_KEY=                     # required only for live mode\n"
        "TORCH_SCENARIO=from_file\n"
    )
    assert load_env_file(env)
    assert os.environ["TORCH_AGENT_MODE"] == "live"  # inline comment stripped
    assert os.environ.get("ANTHROPIC_API_KEY", "") == ""  # an empty value stays empty, so from_env ignores it
    assert os.environ["TORCH_SCENARIO"] == "from_shell"


def test_tests_never_load_the_developer_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    clear(monkeypatch)
    env = tmp_path / ".env"
    env.write_text("TORCH_AGENT_MODE=live\n")
    assert os.environ.get("TORCH_DOTENV") == "0"  # set by tests/conftest.py
    assert not load_env_file(env)
    assert "TORCH_AGENT_MODE" not in os.environ
