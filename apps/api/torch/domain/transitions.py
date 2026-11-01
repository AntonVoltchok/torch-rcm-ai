"""Claim status state machine (01-domain-model "Claim status transitions").

The client never sets a status; the server moves claims through `apply_transition`, which refuses any edge
that is not in the table and any edge whose minimum tier the caller does not have.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from torch.domain.enums import ClaimStatus, Tier

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


@dataclass(frozen=True, slots=True)
class Edge:
    source: ClaimStatus
    target: ClaimStatus
    cause: Cause
    min_tier: Tier | None  # None = a world event (not a Torch action)


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
)

_INDEX: dict[tuple[ClaimStatus, ClaimStatus, Cause], Edge] = {(e.source, e.target, e.cause): e for e in EDGES}


class TransitionError(ValueError):
    """Raised for an edge that is not in the state machine or that the caller's tier may not take."""


def find_edge(source: ClaimStatus, target: ClaimStatus, cause: Cause) -> Edge:
    edge = _INDEX.get((source, target, cause))
    if edge is None:
        raise TransitionError(f"{source} → {target} by {cause} is not a claim transition")
    return edge


def apply_transition(
    source: ClaimStatus, target: ClaimStatus, cause: Cause, actor_tier: Tier | None = None
) -> ClaimStatus:
    """Validate and return the new status.

    `actor_tier` is the highest tier the caller may act at (a tier-1 rule run passes Tier.ONE; a human owner
    passes Tier.THREE; world events pass None and may only take world edges).
    """
    edge = find_edge(source, target, cause)
    if edge.min_tier is None:
        if actor_tier is not None:
            raise TransitionError(f"{cause} is a world event; Torch cannot cause it")
        return target
    if actor_tier is None or actor_tier < edge.min_tier:
        raise TransitionError(f"{source} → {target} needs tier {int(edge.min_tier)}")
    return target


def allowed_targets(source: ClaimStatus) -> set[ClaimStatus]:
    return {e.target for e in EDGES if e.source == source}
