"""Static per-model capability table and the three request profiles (07 §3.1, ADR-0001).

Principle: the model proposes; code gates and executes. Reproducibility comes from policy, recipes and
cassettes, not from sampling: **no `temperature`, `top_p` or `top_k` is ever sent to a 5.5 model** (Sonnet and
Opus 5.5 reject them; Haiku 5.5 says to omit them). Nothing here is probed at runtime: `GET /v1/models/{id}` at
live boot only fails fast, it does not change a profile.

| role  | model             | thinking                    | effort  | tool_choice                          |
|-------|-------------------|-----------------------------|---------|--------------------------------------|
| exec  | claude-sonnet-5-5 | {"type": "between_tools"}   | medium  | auto (any/tool → 400 on Sonnet 5.5)  |
| draft | claude-opus-5-5   | {"type": "adaptive"}        | high    | auto (any/tool → 400 on Opus 5.5)    |
| fast  | claude-haiku-5-5  | {"type": "disabled"}        | omitted | forced {"type":"tool","name":…}      |
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from torch.agents.types import Effort, ThinkingType

Role = Literal["exec", "draft", "fast"]
SAMPLING_PARAMS = frozenset({"temperature", "top_p", "top_k"})


class Capability(BaseModel):
    """What a model family accepts. A request outside this is a 400 we must never send."""

    model_config = ConfigDict(frozen=True)

    family: str
    thinking: frozenset[ThinkingType]
    tool_choice: frozenset[Literal["auto", "any", "tool", "none"]]
    efforts: frozenset[Effort]
    effort_with_thinking: dict[str, frozenset[Effort]] = {}
    accepts_sampling: bool = False
    cache_read_multiplier: float
    max_output_tokens: int = 64_000


CAPABILITIES: dict[str, Capability] = {
    "claude-sonnet-5-5": Capability(
        family="claude-sonnet-5-5",
        thinking=frozenset({"between_tools", "adaptive"}),  # `disabled` and manual budgets → 400
        tool_choice=frozenset({"auto", "none"}),
        efforts=frozenset({"low", "medium", "high"}),
        effort_with_thinking={"between_tools": frozenset({"low", "medium", "high"})},
        cache_read_multiplier=0.05,
    ),
    "claude-opus-5-5": Capability(
        family="claude-opus-5-5",
        thinking=frozenset({"adaptive"}),
        tool_choice=frozenset({"auto", "none"}),
        efforts=frozenset({"low", "medium", "high"}),
        cache_read_multiplier=0.05,
    ),
    "claude-haiku-5-5": Capability(
        family="claude-haiku-5-5",
        thinking=frozenset({"disabled", "adaptive"}),
        tool_choice=frozenset(
            {"auto", "any", "tool", "none"}
        ),  # forced choice accepted; with thinking it skips thinking
        efforts=frozenset({"low", "medium", "high"}),  # accepted (default medium); the fast profile omits it
        cache_read_multiplier=0.1,
    ),
}


class ModelProfile(BaseModel):
    model_config = ConfigDict(frozen=True)

    role: Role
    model: str
    thinking: ThinkingType
    effort: Effort | None
    tool_choice: Literal["auto", "forced"]
    forced_tool: str | None = None
    cache_read_multiplier: float

    def thinking_param(self) -> dict[str, Any]:
        # between_tools takes no other fields: `display` (summarized thinking) is rejected with it.
        return {"type": self.thinking}

    def tool_choice_param(self) -> dict[str, Any]:
        if self.tool_choice == "forced":
            assert self.forced_tool, "a forced profile names its tool"
            return {"type": "tool", "name": self.forced_tool}
        return {"type": "auto"}


class ProfileError(ValueError):
    """A configured model/effort the capability table rejects. Raised at startup."""


def capability(model: str) -> Capability:
    family = next((f for f in CAPABILITIES if model == f or model.startswith(f + "-")), None)
    if family is None:
        raise ProfileError(f"{model} is not in the static capability table (torch/agents/llm/models.py)")
    return CAPABILITIES[family]


def make_profile(role: Role, model: str, effort: Effort | None, *, forced_tool: str | None = None) -> ModelProfile:
    cap = capability(model)
    thinking: ThinkingType = {"exec": "between_tools", "draft": "adaptive", "fast": "disabled"}[role]  # type: ignore[assignment]
    if thinking not in cap.thinking:
        raise ProfileError(f"{model} does not accept thinking={thinking}")
    if role == "fast":
        effort = None
    elif effort is None or effort not in cap.efforts:
        raise ProfileError(f"{model} does not accept effort={effort}")
    allowed = cap.effort_with_thinking.get(thinking)
    if effort is not None and allowed is not None and effort not in allowed:
        raise ProfileError(f"{model} rejects effort={effort} with thinking={thinking}")
    tool_choice: Literal["auto", "forced"] = "forced" if role == "fast" else "auto"
    if tool_choice == "forced" and "tool" not in cap.tool_choice:
        raise ProfileError(f"{model} rejects a forced tool_choice")
    return ModelProfile(
        role=role,
        model=model,
        thinking=thinking,
        effort=effort,
        tool_choice=tool_choice,
        forced_tool=forced_tool if role == "fast" else None,
        cache_read_multiplier=cap.cache_read_multiplier,
    )


def profiles(
    model_exec: str, model_draft: str, model_fast: str, effort_exec: Effort, effort_draft: Effort
) -> dict[Role, ModelProfile]:
    return {
        "exec": make_profile("exec", model_exec, effort_exec),
        "draft": make_profile("draft", model_draft, effort_draft),
        "fast": make_profile("fast", model_fast, None, forced_tool="submit_benefits"),
    }
