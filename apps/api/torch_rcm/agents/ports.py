"""The seam between the agent runtime and the simulated world.

Principle: the model proposes; code gates and executes. `WorldPort.act` is the only path to a mutation. It
is called only by executor recipe steps, and every call carries an idempotency key that the world's UNIQUE
WorldCallLog turns into "repeat → stored result". Reads go through `WorldPort.read`, which never mutates.

The real implementation is `torch_rcm.agents.tools.adapters.SimWorld` over `torch_rcm.world.sim.World`; tests can
substitute any object with these two methods (the adversarial and loop tests do).
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Protocol

from pydantic import Field

from torch_rcm.agents.types import EvidenceCandidate, Frozen, JsonValue

__all__ = ["Clock", "WorldCallResult", "WorldPort", "WorldRead", "WorldUnavailable"]


class WorldUnavailable(Exception):  # noqa: N818 - the spec's name (07 §9)
    """A simulated system is down (portal outage). Retried, then rescheduled (07 §9)."""

    def __init__(self, message: str, retry_after: datetime | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class WorldRead(Frozen):
    data: dict[str, JsonValue] = Field(default_factory=dict)
    evidence: tuple[EvidenceCandidate, ...] = ()


class WorldCallResult(Frozen):
    """One WorldCallLog row. `replayed` is true when the idempotency key had already been used."""

    ok: bool
    data: dict[str, JsonValue] = Field(default_factory=dict)
    reference: str | None = None
    evidence: tuple[EvidenceCandidate, ...] = ()
    replayed: bool = False
    requires_human: bool = False
    error: str | None = None
    world_call_id: str | None = None


class Clock(Protocol):
    def now(self) -> datetime: ...


class WorldPort(Protocol):
    """The simulated PMS, clearinghouse, NEA and payers."""

    def read(self, op: str, args: Mapping[str, JsonValue], *, run_id: str | None = None) -> WorldRead: ...

    def act(self, op: str, args: Mapping[str, JsonValue], idempotency_key: str, *, run_id: str) -> WorldCallResult: ...
