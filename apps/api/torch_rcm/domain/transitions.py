"""Claim status state machine (01-domain-model "Claim status transitions").

The client never sets a status; the server moves claims through `apply_transition`, which refuses any edge
that is not in the table and any edge whose minimum tier the caller does not have.

Three kinds of edge, because `ClaimStatus` has nine values and no "closed" or "replaced" status:

- `move`  — the claim's status becomes the target (`apply_transition`).
- `spawn` — a corrected claim (frequency 7): the original keeps its status and is closed `superseded`; a NEW
  claim (`parent_claim_id` → original) is built `ready`, queued, and reaches `sent` by the ready → sent
  file-departure edge (`start_corrected_claim`).
- `close` — write-off or void: the status is unchanged and the claim becomes terminal with a `ClosedReason`
  (`close_claim`). Both are tier 3, so they also require `by_human=True`: no code path automates them.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Literal

from torch_rcm.domain.enums import ClaimStatus, ClosedReason, Tier

S = ClaimStatus


class Cause(StrEnum):
    """What moved the claim. World causes are other parties' systems; the rest are Torch actions."""

    FILE_DEPARTED = "file_departed"  # world: the claim left in a payer file
    CLEARINGHOUSE_REJECT = "clearinghouse_reject"  # world: Vyne 277CA A7
    PAYER_REJECT = "payer_reject"  # world: payer 277CA A7
    PAYER_ACCEPT = "payer_accept"  # world: payer 277CA A1/A2, ICN assigned
    PAYER_IN_PROCESS = "payer_in_process"  # world: payer 277 "in process"
    ADJUDICATED = "adjudicated"  # world: 835 arrived
    RECONSIDERATION_SENT = "reconsideration_sent"  # tier 1: records / inquiry / resubmit
    DEMOGRAPHIC_RESEND = "demographic_resend"  # tier 1
    FORMAL_APPEAL_FILED = "formal_appeal_filed"  # tier 3, human
    APPEAL_DECIDED = "appeal_decided"  # world
    CORRECTED_CLAIM = "corrected_claim"  # tier 2: frequency-7 replacement (a new claim id, links the original)
    WRITE_OFF = "write_off"  # tier 3, human: terminal, status unchanged
    VOID_CLAIM = "void_claim"  # tier 3, human: frequency 8 (or withdrawn from the file), terminal


EdgeKind = Literal["move", "spawn", "close"]


@dataclass(frozen=True, slots=True)
class Edge:
    source: ClaimStatus
    target: ClaimStatus
    cause: Cause
    min_tier: Tier | None  # None = a world event (not a Torch action)
    kind: EdgeKind = "move"


EDGES: tuple[Edge, ...] = (
    Edge(S.READY, S.SENT, Cause.FILE_DEPARTED, Tier.ONE),
    Edge(S.SENT, S.REJECTED, Cause.CLEARINGHOUSE_REJECT, None),
    Edge(S.SENT, S.REJECTED, Cause.PAYER_REJECT, None),
    Edge(S.SENT, S.ACCEPTED, Cause.PAYER_ACCEPT, None),
    Edge(S.REJECTED, S.SENT, Cause.DEMOGRAPHIC_RESEND, Tier.ONE),
    Edge(S.REJECTED, S.SENT, Cause.FILE_DEPARTED, Tier.ONE),
    Edge(S.ACCEPTED, S.PENDING, Cause.PAYER_IN_PROCESS, None),
    Edge(S.ACCEPTED, S.PAID, Cause.ADJUDICATED, None),
    Edge(S.ACCEPTED, S.PARTIAL, Cause.ADJUDICATED, None),
    Edge(S.ACCEPTED, S.DENIED, Cause.ADJUDICATED, None),
    Edge(S.PENDING, S.PAID, Cause.ADJUDICATED, None),
    Edge(S.PENDING, S.PARTIAL, Cause.ADJUDICATED, None),
    Edge(S.PENDING, S.DENIED, Cause.ADJUDICATED, None),
    Edge(S.DENIED, S.PENDING, Cause.RECONSIDERATION_SENT, Tier.ONE),
    Edge(S.DENIED, S.PAID, Cause.ADJUDICATED, None),  # reprocessed after a reconsideration
    Edge(S.DENIED, S.PARTIAL, Cause.ADJUDICATED, None),
    Edge(S.DENIED, S.APPEALED, Cause.FORMAL_APPEAL_FILED, Tier.THREE),
    Edge(S.APPEALED, S.PAID, Cause.APPEAL_DECIDED, None),
    Edge(S.APPEALED, S.PARTIAL, Cause.APPEAL_DECIDED, None),
    Edge(S.APPEALED, S.DENIED, Cause.APPEAL_DECIDED, None),
    # partial: one line paid, another denied — the denied line is reconsidered or appealed on the same claim
    Edge(S.PARTIAL, S.PENDING, Cause.RECONSIDERATION_SENT, Tier.ONE),  # reconsideration in flight
    Edge(S.PARTIAL, S.APPEALED, Cause.FORMAL_APPEAL_FILED, Tier.THREE),
    # corrected claim (frequency 7): the target is where the NEW claim lands once its file departs
    *(
        Edge(src, S.SENT, Cause.CORRECTED_CLAIM, Tier.TWO, "spawn")
        for src in (S.DENIED, S.PARTIAL, S.REJECTED, S.SENT, S.ACCEPTED, S.PENDING)
    ),
    # terminal, status unchanged
    Edge(S.DENIED, S.DENIED, Cause.WRITE_OFF, Tier.THREE, "close"),
    Edge(S.PARTIAL, S.PARTIAL, Cause.WRITE_OFF, Tier.THREE, "close"),
    *(Edge(src, src, Cause.VOID_CLAIM, Tier.THREE, "close") for src in ClaimStatus if src is not S.PAID),
)

#: Statuses with no outgoing edge of any kind (a paid claim is done; refunds are ledger entries, not edges).
TERMINAL_STATUSES: frozenset[ClaimStatus] = frozenset({S.PAID})
CLOSE_REASON: dict[Cause, ClosedReason] = {
    Cause.WRITE_OFF: ClosedReason.WRITE_OFF,
    Cause.VOID_CLAIM: ClosedReason.VOIDED,
}

_INDEX: dict[tuple[ClaimStatus, ClaimStatus, Cause], Edge] = {(e.source, e.target, e.cause): e for e in EDGES}


class TransitionError(ValueError):
    """Raised for an edge that is not in the state machine or that the caller's tier may not take."""


def find_edge(source: ClaimStatus, target: ClaimStatus, cause: Cause) -> Edge:
    edge = _INDEX.get((source, target, cause))
    if edge is None:
        raise TransitionError(f"{source} → {target} by {cause} is not a claim transition")
    return edge


def _gate(edge: Edge, actor_tier: Tier | None, *, by_human: bool) -> None:
    if edge.min_tier is None:
        if actor_tier is not None:
            raise TransitionError(f"{edge.cause} is a world event; Torch cannot cause it")
        return
    if actor_tier is None or actor_tier < edge.min_tier:
        raise TransitionError(f"{edge.source} → {edge.target} by {edge.cause} needs tier {int(edge.min_tier)}")
    if edge.min_tier is Tier.THREE and not by_human:
        raise TransitionError(f"{edge.cause} is tier 3: a person takes it, never a rule or an agent")


def apply_transition(
    source: ClaimStatus,
    target: ClaimStatus,
    cause: Cause,
    actor_tier: Tier | None = None,
    *,
    by_human: bool = False,
) -> ClaimStatus:
    """Validate a `move` edge and return the new status.

    `actor_tier` is the highest tier the caller may act at (a tier-1 rule run passes Tier.ONE; a human owner
    passes Tier.THREE with `by_human=True`; world events pass None and may only take world edges).
    """
    edge = find_edge(source, target, cause)
    if edge.kind != "move":
        raise TransitionError(f"{cause} is a {edge.kind} edge: use start_corrected_claim / close_claim")
    _gate(edge, actor_tier, by_human=by_human)
    return target


def start_corrected_claim(source: ClaimStatus, actor_tier: Tier | None) -> ClaimStatus:
    """Validate a frequency-7 replacement of a claim in `source`; return the NEW claim's initial status.

    The original keeps `source` and is closed `superseded`; the replacement links it via `parent_claim_id`.
    """
    _gate(find_edge(source, S.SENT, Cause.CORRECTED_CLAIM), actor_tier, by_human=False)
    return S.READY


def close_claim(source: ClaimStatus, cause: Cause, actor_tier: Tier | None, *, by_human: bool) -> ClosedReason:
    """Validate a terminal `close` edge (write-off, void); the status is unchanged. Returns the reason to record."""
    edge = find_edge(source, source, cause)
    if edge.kind != "close":
        raise TransitionError(f"{cause} does not close a claim")
    _gate(edge, actor_tier, by_human=by_human)
    return CLOSE_REASON[cause]


def allowed_targets(source: ClaimStatus) -> set[ClaimStatus]:
    """Statuses a claim in `source` can move to (`move` edges only; spawn and close edges keep its status)."""
    return {e.target for e in EDGES if e.source == source and e.kind == "move"}


def allowed_causes(source: ClaimStatus) -> set[Cause]:
    """Every cause with an edge out of `source`, of any kind."""
    return {e.cause for e in EDGES if e.source == source}
