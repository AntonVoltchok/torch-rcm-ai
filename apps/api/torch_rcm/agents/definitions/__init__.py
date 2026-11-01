"""Declarative agent definitions (07 §2): one frozen `AgentDefinition` per agent.

Principle: the model proposes; code gates and executes. A definition is data the runtime and tests read —
triggers, the read tools its planner may call (`ToolRegistry.allowed`), the actions it may *propose* with
their catalog tiers, what it may write as text, its outcome metric, the inbox item kinds it produces and its
failure policy. Tiers are never restated here: `proposable` is derived from `catalog.actions`, so a
definition cannot drift from the catalog, and `assert_definition()` refuses any definition that could
propose a tier-3 action as something it runs (Appeals *prepares* tier-3 work; it lists it under
`prepares_only`).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from torch_rcm.agents.catalog.actions import ACTIONS, AGENT_ACTIONS
from torch_rcm.agents.tools.registry import ToolRegistry
from torch_rcm.agents.types import AGENT_KINDS, AgentKind, InboxItemKind, OutcomeMetric, Tier


class DefinitionError(AssertionError):
    """A definition disagrees with the catalog (unknown action, tier-3 action proposable)."""


@dataclass(frozen=True)
class FailurePolicy:
    """07 §2 "Failures": at most one `run_failed` item, only when a person has a decision to make."""

    max_run_failed_items: int = 1
    run_failed_when: tuple[str, ...] = ("deadline_le_14d", "file_time_missed", "appointment_lt_24h")
    otherwise: str = "reschedule"


@dataclass(frozen=True)
class AgentDefinition:
    kind: AgentKind
    label: str
    triggers: tuple[str, ...]
    actions: tuple[str, ...]  # what it may propose (policy decides whether it runs)
    writes_text: tuple[str, ...]  # what it may write; agent text is always tier 2 (07 §5.3)
    outcome_metric: OutcomeMetric
    inbox_kinds: tuple[InboxItemKind, ...]
    live: str  # "no" | "yes" | "drafting_only"
    prepares_only: tuple[str, ...] = ()  # tier-3 work it prepares for a role holder; never proposable to run
    may_not: tuple[str, ...] = ()
    failure: FailurePolicy = field(default_factory=FailurePolicy)

    @property
    def reads(self) -> tuple[str, ...]:
        return ToolRegistry.allowed(self.kind)

    @property
    def proposable(self) -> dict[str, Tier | None]:
        """Action → catalog tier (None = an internal Hold, not an action on the world)."""
        return {a: ACTIONS[a].tier for a in self.actions}


def assert_definition(d: AgentDefinition) -> None:
    problems: list[str] = []
    for name in (*d.actions, *d.prepares_only):
        if name not in ACTIONS:
            problems.append(f"{d.kind}: unknown action {name}")
    problems += [f"{d.kind}: tier-3 {a} is proposable" for a in d.actions if a in ACTIONS and ACTIONS[a].tier == 3]
    problems += [f"{d.kind}: {a} is not tier 3" for a in d.prepares_only if a in ACTIONS and ACTIONS[a].tier != 3]
    if set(d.actions) | set(d.prepares_only) != set(AGENT_ACTIONS[d.kind]):
        problems.append(f"{d.kind}: actions differ from catalog AGENT_ACTIONS")
    if problems:
        raise DefinitionError("; ".join(problems))


def registry() -> dict[AgentKind, AgentDefinition]:
    from torch_rcm.agents.definitions import appeals, claims, eligibility, followup, posting

    defs = {m.DEFINITION.kind: m.DEFINITION for m in (eligibility, claims, followup, appeals, posting)}
    for d in defs.values():
        assert_definition(d)
    assert tuple(defs) == AGENT_KINDS
    return defs


__all__ = ["AgentDefinition", "DefinitionError", "FailurePolicy", "assert_definition", "registry"]
