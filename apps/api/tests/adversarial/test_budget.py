"""Adversarial (c): budgets bound a run (reads capped at 12; turns, tokens, cost) — the pure check."""

from __future__ import annotations

import random

import pytest

from torch_rcm.agents.config import AgentConfig, ConfigError

CFG = AgentConfig()


def stop(**kw: int) -> str | None:
    base = {"turns": 1, "reads": 0, "total_tokens": 0, "cost_usd_micros": 0}
    base.update(kw)
    return CFG.budget_stop(**base)


def test_within_budget() -> None:
    assert stop() is None
    assert stop(reads=12, turns=8, total_tokens=60_000, cost_usd_micros=250_000) is None  # inclusive limits


@pytest.mark.parametrize(
    ("kw", "needle"),
    [
        ({"reads": 13}, "read budget"),
        ({"turns": 9}, "turn budget"),
        ({"total_tokens": 60_001}, "token budget"),
        ({"cost_usd_micros": 250_001}, "cost cap"),
    ],
)
def test_over_budget_stops(kw: dict[str, int], needle: str) -> None:
    reason = stop(**kw)
    assert reason and needle in reason


def test_read_loop_is_capped() -> None:
    reads = 0
    while stop(reads=reads + 1) is None:
        reads += 1
    assert reads == CFG.run_max_reads == 12


def test_property_any_exceeded_limit_stops() -> None:
    rng = random.Random(5)
    for _ in range(500):
        kw = {
            "reads": rng.randint(0, 20),
            "turns": rng.randint(0, 12),
            "total_tokens": rng.randint(0, 90_000),
            "cost_usd_micros": rng.randint(0, 400_000),
        }
        over = kw["reads"] > 12 or kw["turns"] > 8 or kw["total_tokens"] > 60_000 or kw["cost_usd_micros"] > 250_000
        assert (stop(**kw) is not None) is over


def test_config_rejects_unusable_setups() -> None:
    with pytest.raises(ConfigError):
        AgentConfig.from_env({"TORCH_AGENT_MODE": "live"})
    with pytest.raises(ConfigError):
        AgentConfig.from_env({"TORCH_LIVE_AGENTS": "posting"})
    assert AgentConfig.from_env({}).agent_mode == "deterministic"
