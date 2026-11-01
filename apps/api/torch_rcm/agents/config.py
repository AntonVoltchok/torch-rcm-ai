"""Agent runtime configuration (07 §10), read once from `TORCH_*` environment variables.

Principle: the model proposes; code gates and executes. Config chooses *which planner* runs and the
budgets that bound it; nothing here can widen what an action may do — that is the rules table's job.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, SecretStr

from torch_rcm.agents.types import AGENT_KINDS, AgentKind, Effort


class ConfigError(RuntimeError):
    """Raised at startup; the process must not boot with an unusable agent configuration."""


class AgentConfig(BaseModel):
    model_config = ConfigDict(frozen=True)

    agent_mode: Literal["deterministic", "live"] = "deterministic"
    anthropic_api_key: SecretStr | None = None
    live_agents: frozenset[AgentKind] = frozenset({"claims", "followup", "appeals"})
    model_exec: str = "claude-sonnet-5-5"
    model_draft: str = "claude-opus-5-5"
    model_fast: str = "claude-haiku-5-5"
    effort_exec: Effort = "medium"
    effort_draft: Effort = "high"
    run_max_turns: int = 8
    run_max_reads: int = 12
    run_token_budget: int = 60_000
    run_cost_cap_usd: float = 0.25
    llm_max_attempts: int = 4
    llm_timeout_s: float = 60.0
    llm_max_tokens: int = 4096
    live_concurrency: int = 2
    advance_live_run_cap: int = 8
    step_delay: bool = True
    step_delay_scale: float = 1.0
    worker_concurrency: int = 4
    lease_seconds: int = 30
    poll_ms: int = 250
    cassette_mode: Literal["off", "record", "replay"] = "off"
    cassette_dir: Path = Path("cassettes")
    scenario: str = "canonical"
    db_path: Path = Path("var/torch.db")
    practice_id: str = "prc_harbor"
    # 07 §9: WorldUnavailable → retries at these delays (seconds, scaled by `delay_scale`), then the run fails
    # and a triage run is rescheduled `outage_reschedule_minutes` of sim time later (never an approval run).
    world_retry_backoff_s: tuple[float, ...] = (2.0, 8.0, 30.0)
    outage_reschedule_minutes: int = 120
    # a deadline due within this many days means a person has a decision to make when a run fails
    decision_risk_days: int = 14

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> AgentConfig:
        e = os.environ if env is None else env
        raw: dict[str, object] = {}
        for name in cls.model_fields:
            key = "ANTHROPIC_API_KEY" if name == "anthropic_api_key" else f"TORCH_{name.upper()}"
            if key in e and e[key] != "":
                raw[name] = e[key]
        if isinstance(raw.get("live_agents"), str):
            raw["live_agents"] = frozenset(a.strip() for a in str(raw["live_agents"]).split(",") if a.strip())
        if isinstance(raw.get("world_retry_backoff_s"), str):
            raw["world_retry_backoff_s"] = tuple(
                float(x) for x in str(raw["world_retry_backoff_s"]).split(",") if x.strip()
            )
        cfg = cls.model_validate(raw)
        cfg.validate_startup()
        return cfg

    @property
    def delay_scale(self) -> float:
        return self.step_delay_scale if self.step_delay else 0.0

    def is_live_for(self, agent: AgentKind) -> bool:
        return self.agent_mode == "live" and agent in self.live_agents

    def validate_startup(self) -> None:
        """Fail fast (07 §10): live without a key, an unknown agent, or an effort a profile rejects."""
        if self.agent_mode == "live" and self.anthropic_api_key is None and self.cassette_mode != "replay":
            raise ConfigError("set ANTHROPIC_API_KEY or use TORCH_AGENT_MODE=deterministic")
        unknown = set(self.live_agents) - set(AGENT_KINDS)
        if unknown:
            raise ConfigError(f"unknown TORCH_LIVE_AGENTS: {sorted(unknown)}")
        if self.live_agents & {"eligibility", "posting"}:
            raise ConfigError("eligibility and posting are always scripted (07 §2)")

    def budget_stop(self, *, turns: int, reads: int, total_tokens: int, cost_usd_micros: int) -> str | None:
        """Pure budget check (07 §3.3 "budget stop"): the reason a run must stop, or None while within budget.

        Limits are inclusive (exactly `run_max_reads` reads is allowed; one more stops the run)."""
        if reads > self.run_max_reads:
            return f"read budget: {reads} reads > {self.run_max_reads}"
        if turns > self.run_max_turns:
            return f"turn budget: {turns} turns > {self.run_max_turns}"
        if total_tokens > self.run_token_budget:
            return f"token budget: {total_tokens} > {self.run_token_budget}"
        if cost_usd_micros > round(self.run_cost_cap_usd * 1_000_000):
            return f"cost cap: ${cost_usd_micros / 1_000_000:.2f} > ${self.run_cost_cap_usd:.2f}"
        return None
