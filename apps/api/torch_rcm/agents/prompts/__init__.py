"""Per-agent system prompts (07 §3.2) and the hashes a conversation is pinned to.

Principle: the model proposes; code gates and executes. A prompt is static text: the role, tier policy, the
closed action list, may/may-not lists, the situation catalog, the untrusted-content contract and the
terminal-tool protocol. Per-run data (case file, rules snapshot, world content) never goes here; it goes in
the first user message so the cached prefix is shared by every run of an agent kind.

`system_sha` is sha256 of the prompt text and `tools_sha` sha256 of the canonical tool list. Both are part of
the checkpoint pin and the cassette key, so a prompt or schema edit always misses (no version to bump).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Literal

from torch_rcm.agents.tools.schemas import JsonSchema, draft_tools, plan_tools, tools_sha
from torch_rcm.agents.types import AgentKind

PROMPT_DIR = Path(__file__).parent
LIVE_PROMPT_AGENTS: tuple[AgentKind, ...] = ("claims", "followup", "appeals")
Purpose = Literal["plan", "draft"]


@dataclass(frozen=True)
class Prompt:
    agent: AgentKind
    text: str
    system_sha: str


@cache
def load(agent: AgentKind) -> Prompt:
    if agent not in LIVE_PROMPT_AGENTS:
        raise KeyError(f"{agent} has no live prompt; it is always scripted (07 §2)")
    text = (PROMPT_DIR / f"{agent}.md").read_text(encoding="utf-8")
    return Prompt(agent=agent, text=text, system_sha=hashlib.sha256(text.encode("utf-8")).hexdigest())


def system_sha(agent: AgentKind) -> str:
    return load(agent).system_sha


def plans_live(agent: AgentKind) -> bool:
    """Appeals has no model-facing actions: its plan is scripted and only its drafting is live."""
    from torch_rcm.agents.tools.schemas import MODEL_ACTIONS

    return agent in LIVE_PROMPT_AGENTS and bool(MODEL_ACTIONS[agent])


def tools_for(agent: AgentKind, purpose: Purpose) -> list[JsonSchema]:
    """The fixed tool list of a conversation: reads (ToolRegistry.allowed) + terminal tools, in a fixed order."""
    if purpose == "draft":
        return draft_tools()
    if not plans_live(agent):
        raise KeyError(f"{agent} has no live plan conversation")
    return plan_tools(agent)


def tools_sha_for(agent: AgentKind, purpose: Purpose) -> str:
    return tools_sha(tools_for(agent, purpose))


__all__ = ["LIVE_PROMPT_AGENTS", "Prompt", "Purpose", "load", "plans_live", "system_sha", "tools_for", "tools_sha_for"]
