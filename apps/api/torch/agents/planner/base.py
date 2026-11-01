"""Planner protocol and the small types every planner shares.

Principle: the model proposes; code gates and executes. A planner turns a `CaseFile` into a validated
`Plan` (situation, reads, actions from a closed list, cited evidence, optional draft text). It never
executes a mutation: its only access to the world is the `Reader` the executor hands it, which runs
scope-checked read tools and records their evidence on the run's `investigate` step.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass, field
from typing import Protocol

from torch.agents.types import (
    CaseFile,
    Draft,
    DraftKind,
    Evidence,
    EvidenceKind,
    JsonValue,
    Plan,
    PlannerKind,
    ResultText,
    RunOutcome,
    Usage,
)


@dataclass
class ReadResult:
    ok: bool
    tool: str
    args: dict[str, JsonValue]
    data: dict[str, JsonValue] = field(default_factory=dict)
    evidence: list[Evidence] = field(default_factory=list)
    error: str | None = None
    progress_line: str = ""


type Reader = Callable[[str, dict[str, JsonValue]], Awaitable[ReadResult]]


class PlannerFallback(Exception):  # noqa: N818 - control flow, not an error the user sees
    """The model misbehaved or the API failed; the executor falls back to the labelled script (07 §9)."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class EvidenceSet:
    """On-file case evidence plus everything gathered in this run, queryable by kind and data."""

    def __init__(self, items: Iterable[Evidence]) -> None:
        self.items: list[Evidence] = []
        seen: set[str] = set()
        for e in items:
            if e.id not in seen:
                self.items.append(e)
                seen.add(e.id)

    def add(self, items: Iterable[Evidence]) -> None:
        for e in items:
            if all(e.id != x.id for x in self.items):
                self.items.append(e)

    def of(self, *kinds: EvidenceKind) -> list[Evidence]:
        return [e for e in self.items if e.kind in kinds]

    def ids(self, *kinds: EvidenceKind) -> list[str]:
        return [e.id for e in self.of(*kinds)]

    def first(self, kind: EvidenceKind, **data: JsonValue) -> Evidence | None:
        return next((e for e in self.of(kind) if all(e.data.get(k) == v for k, v in data.items())), None)

    def by_id(self) -> dict[str, Evidence]:
        return {e.id: e for e in self.items}

    def __contains__(self, evidence_id: object) -> bool:
        return any(e.id == evidence_id for e in self.items)


class Planner(Protocol):
    kind: PlannerKind
    usage: Usage

    async def plan(self, case: CaseFile, read: Reader, evidence: EvidenceSet) -> Plan: ...

    async def draft(self, case: CaseFile, plan: Plan, kind: DraftKind, evidence: EvidenceSet) -> Draft | None: ...

    async def result(self, case: CaseFile, outcome: RunOutcome) -> ResultText: ...
