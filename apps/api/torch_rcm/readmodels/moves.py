"""Whose move a claim is waiting on (D1's baton), and who may act on an inbox item.

One function for every screen and for the agents' `Run.claim_outcome`, so the Inbox row, the claim header, the KPI
cards and the eval all read the same holder. `who` never depends on the viewer; only `mine` does. The rules, first
match wins (plan d1-build, Phase 1 (api) notes 1):

1. a closed claim → nobody
2. a queued, running or paused run on the claim → agents
3. an open inbox item on the claim → practice (the holder is the item the viewer can act on, else the weightiest)
4. an uncleared hold → by its reason
5. a queued payer-file entry → agents
6. by status: paid → nobody; ready → agents under an Auto send rule; sent → payer until 2 business days pass without a
   payer acknowledgment; rejected → practice; denied/partial → payer only if something was filed since the last
   remittance, else practice; accepted/pending/appealed → payer
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import date, timedelta

from torch_rcm.api.schemas import ClaimMove
from torch_rcm.domain.entities import Claim, InboxItem, Remittance, Rule, Run, User
from torch_rcm.domain.enums import (
    ACTIVE_RUN_STATUSES,
    AckStage,
    ClaimStatus,
    FileEntryState,
    HoldReason,
    InboxItemKind,
    MoveWho,
    Role,
    RuleAction,
    RuleMode,
    RunStatus,
    RunTrigger,
    Tier,
)
from torch_rcm.domain.values import ClaimOutcome
from torch_rcm.readmodels.snapshot import Snapshot

# Tier 3 commits the practice: who may approve each action (owner always). The services' authority check uses this.
TIER3_APPROVERS: dict[str, tuple[Role, ...]] = {
    "write_off": (Role.OWNER,),
    "formal_appeal": (Role.DENTIST, Role.OWNER),
    "void_claim": (Role.OWNER,),
}

HOLD_HOLDER: dict[HoldReason, tuple[MoveWho, Role | None]] = {
    HoldReason.NOTE_UNSIGNED: (MoveWho.PRACTICE, Role.DENTIST),
    HoldReason.PROCS_NOT_IN_NOTE: (MoveWho.PRACTICE, Role.DENTIST),
    HoldReason.RENDERING_MISMATCH: (MoveWho.PRACTICE, Role.DENTIST),
    HoldReason.MISSING_IMAGE: (MoveWho.PRACTICE, Role.BILLING),
    HoldReason.SUBSCRIBER_ID_INVALID: (MoveWho.PRACTICE, Role.BILLING),
    HoldReason.OTHER_DOCUMENTED: (MoveWho.PRACTICE, Role.BILLING),
    HoldReason.AWAITING_PRIMARY_EOB: (MoveWho.PAYER, None),
    HoldReason.REPROCESSING_REQUESTED: (MoveWho.PAYER, None),
}

A = RuleAction
FILING_ACTIONS: frozenset[RuleAction] = frozenset(
    {
        A.RESUBMIT_WITH_ATTACHMENT,
        A.REPROCESSING_REQUEST,
        A.RECORDS_REQUEST,
        A.FORMAL_APPEAL,
        A.CORRECTED_CLAIM,
        A.SEND_CLAIM_PMS_CODES,
        A.SEND_CLAIM_AGENT_TEXT,
        A.FIX_DEMOGRAPHICS_RESEND,
        A.COB_ORDER_CHANGE,
    }
)  # actions that put something in front of the payer that it must answer
PAYER_ACKS = frozenset({AckStage.PAYER_277CA_A1, AckStage.PAYER_277CA_A7})
NO_REPLY_BUSINESS_DAYS = 2

type _Move = Callable[..., ClaimMove]

ROLE_WORD: dict[Role, str] = {
    Role.OWNER: "the owner",
    Role.BILLING: "billing",
    Role.DENTIST: "the dentist",
    Role.FRONT_DESK: "the front desk",
}


def approver_roles(item: InboxItem) -> tuple[Role, ...] | None:
    """Roles that may approve this item, or None when any viewer who sees it may (tiers 1–2)."""
    if item.kind is InboxItemKind.OWNER_SIGNOFF:
        return (Role.OWNER,)
    if item.tier is Tier.THREE:
        action = item.proposed_action.action.value if item.proposed_action else ""
        return TIER3_APPROVERS.get(action, (Role.OWNER,))
    return None


def can_approve(user: User | None, item: InboxItem) -> bool:
    """The server's one authority rule (`services.inbox._check_authority` raises on the same test)."""
    if user is None:
        return False
    roles = approver_roles(item)
    if roles is not None and user.role not in roles:
        return False
    if roles is not None and item.assignee_user_id and item.assignee_user_id != user.id:
        return user.role is Role.OWNER
    return True


def sees(user: User | None, item: InboxItem) -> bool:
    """Whether the item is in this user's queue (`visible_inbox`): the shared billing queue plus items assigned to
    them; front desk sees eligibility flags; dentists see only items assigned to them."""
    role = user.role if user else Role.BILLING
    mine = item.assignee_user_id is not None and user is not None and item.assignee_user_id == user.id
    shared = item.assignee_user_id is None
    if role in (Role.BILLING, Role.OWNER):
        return shared or mine
    if role is Role.FRONT_DESK:
        return mine or (shared and item.kind is InboxItemKind.ELIGIBILITY_FLAG)
    return mine


def can_act(user: User | None, item: InboxItem) -> bool:
    return user is not None and sees(user, item) and can_approve(user, item)


def item_holder_role(item: InboxItem) -> Role:
    if item.required_role is not None:
        return item.required_role
    roles = approver_roles(item)
    return roles[0] if roles else Role.BILLING


def _sole(snap: Snapshot, role: Role) -> User | None:
    holders = [u for u in snap.of(User) if u.role is role]
    return holders[0] if len(holders) == 1 else None


def _practice_label(snap: Snapshot, role: Role, user_id: str | None, signs: bool) -> str:
    user = snap.users.get(user_id or "") or (_sole(snap, role) if signs else None)
    if signs:
        return f"{user.name} signs" if user else f"{ROLE_WORD[role].capitalize()} signs"
    return f"Waiting on {user.name if user else ROLE_WORD[role]}"


def _holder_item(items: Iterable[InboxItem], viewer: User | None) -> InboxItem:
    """The item the viewer can act on, else the weightiest: a tier-3 sign-off blocks everything behind it."""
    ordered = sorted(items, key=lambda i: (-(i.tier.value if i.tier else 0), i.created_at, i.id))
    return next((i for i in ordered if can_act(viewer, i)), ordered[0])


@dataclass(frozen=True, slots=True)
class MoveBasis:
    """What a move is read from, when it is not the snapshot as it stands: the agents read a claim's move around
    their own run (`exclude_run`), and an approval run's "before" counts its item as still open (`open_item`)."""

    exclude_run: str | None = None
    open_item: str | None = None
    closed_item: str | None = None  # `lands`: the item being approved, as if already resolved


def claim_move(snap: Snapshot, claim: Claim, viewer_id: str | None = None, basis: MoveBasis | None = None) -> ClaimMove:
    b = basis or MoveBasis()
    viewer = snap.users.get(viewer_id or "")
    payer = snap.payers[claim.payer_key.value].short_name

    def move(
        who: MoveWho, label: str, role: Role | None = None, user_id: str | None = None, mine: bool = False
    ) -> ClaimMove:
        return ClaimMove(who=who, holder_role=role, holder_user_id=user_id, mine=mine, label=label)

    if claim.closed_reason is not None:
        return move(MoveWho.NOBODY, "Closed")
    runs = snap.runs_by_claim.get(claim.id, [])
    active = [r for r in runs if r.status in ACTIVE_RUN_STATUSES and r.id != b.exclude_run]
    if active:
        paused = all(r.status is RunStatus.PAUSED for r in active)
        return move(MoveWho.AGENTS, "Agents paused" if paused else "With the agents")
    items = [i for i in snap.open_items_by_claim.get(claim.id, []) if i.id != b.closed_item]
    if b.open_item and b.open_item not in {i.id for i in items}:
        extra = next((i for i in snap.of(InboxItem) if i.id == b.open_item and i.claim_id == claim.id), None)
        items += [extra] if extra else []
    if items:
        item = _holder_item(items, viewer)
        role = item_holder_role(item)
        signs = approver_roles(item) is not None
        label = _practice_label(snap, role, item.assignee_user_id, signs)
        return move(MoveWho.PRACTICE, label, role, item.assignee_user_id, can_act(viewer, item))
    holds = snap.holds_by_subject.get(claim.id, [])
    if holds:
        hold = holds[0]
        who, hold_role = HOLD_HOLDER[hold.reason]
        if who is MoveWho.PAYER or hold_role is None:
            primary = hold.reason is HoldReason.AWAITING_PRIMARY_EOB
            return move(who, "Waiting on the primary payer's EOB" if primary else f"Waiting on {payer}")
        user_id = hold.owner_user_id
        mine = viewer is not None and (viewer.id == user_id if user_id else viewer.role in (hold_role, Role.OWNER))
        return move(who, _practice_label(snap, hold_role, user_id, signs=False), hold_role, user_id, mine)
    queued = [e for e in snap.file_entries_by_claim.get(claim.id, []) if e.state is FileEntryState.QUEUED]
    if queued:
        return move(MoveWho.AGENTS, f"In the {queued[-1].file_time:%-I:%M %p} {payer} file")
    return _by_status(snap, claim, viewer, payer, move)


def _billing(viewer: User | None) -> bool:
    return viewer is not None and viewer.role in (Role.BILLING, Role.OWNER)


def _by_status(snap: Snapshot, claim: Claim, viewer: User | None, payer: str, move: _Move) -> ClaimMove:
    """Rule 6. A payer is named only on evidence it owes a response; otherwise the claim is unworked and the
    practice holds it (red team d1-api: unworked A/R must not hide behind "Waiting on Delta")."""
    s = claim.status
    if s is ClaimStatus.PAID:
        return move(MoveWho.NOBODY, "Finished")
    if s is ClaimStatus.READY:
        send = next((r for r in snap.of(Rule) if r.action is RuleAction.SEND_CLAIM_PMS_CODES), None)
        if send is not None and send.mode is RuleMode.AUTO:
            return move(MoveWho.AGENTS, "With the agents")
        return move(MoveWho.PRACTICE, "Ready to send", Role.BILLING, None, _billing(viewer))
    if s is ClaimStatus.SENT:
        sent = claim.sent_at.date() if claim.sent_at else snap.today
        if claim.ack_stage not in PAYER_ACKS and business_days(sent, snap.today) > NO_REPLY_BUSINESS_DAYS:
            return move(
                MoveWho.PRACTICE, f"No reply from {payer} since {sent:%m/%d}", Role.BILLING, None, _billing(viewer)
            )
        return move(MoveWho.PAYER, f"Sent {sent:%m/%d}, no reply yet")
    if s is ClaimStatus.REJECTED:
        return move(MoveWho.PRACTICE, "Rejected, not resent", Role.BILLING, None, _billing(viewer))
    if s in (ClaimStatus.DENIED, ClaimStatus.PARTIAL) and not filed_since_remit(snap, claim):
        word = "Denied" if s is ClaimStatus.DENIED else "Underpaid"
        return move(MoveWho.PRACTICE, f"{word}, nothing filed", Role.BILLING, None, _billing(viewer))
    return move(MoveWho.PAYER, f"Waiting on {payer}")


def business_days(start: date, end: date) -> int:
    """Weekdays after `start` up to and including `end`."""
    return sum((start + timedelta(days=d)).weekday() < 5 for d in range(1, (end - start).days + 1))


def filed_since_remit(snap: Snapshot, claim: Claim) -> bool:
    """Something left for the payer after its last remittance on this claim: a file, a filing run, or an
    in-flight request the PMS records (an appeal, records sent)."""
    if claim.in_flight:
        return True
    remits = [r.received_at for r in snap.of(Remittance) if any(line.claim_id == claim.id for line in r.lines)]
    last = max(remits, default=None)
    left = [e.departed_at for e in snap.file_entries_by_claim.get(claim.id, []) if e.departed_at is not None]
    left += [
        r.finished_at
        for r in snap.runs_by_claim.get(claim.id, [])
        if r.status is RunStatus.SUCCEEDED and r.action in FILING_ACTIONS and r.finished_at is not None
    ]
    return any(last is None or at > last for at in left)


def run_claim_side(snap: Snapshot, run: Run, *, before: bool) -> tuple[ClaimStatus, MoveWho] | None:
    """A run's own claim, read around the run itself: the run is never counted as holding it, and an approval run's
    "before" counts its approved item as still open (so an approval reads practice → …). None for a claimless run."""
    claim = snap.claims.get(run.claim_id or "")
    if claim is None:
        return None
    approval = before and run.trigger is RunTrigger.APPROVAL
    basis = MoveBasis(exclude_run=run.id, open_item=run.inbox_item_id if approval else None)
    return claim.status, claim_move(snap, claim, basis=basis).who


def claim_outcome(
    before: tuple[ClaimStatus, MoveWho] | None, after: tuple[ClaimStatus, MoveWho] | None
) -> ClaimOutcome | None:
    if after is None:
        return None
    b = before or after
    return ClaimOutcome(status_from=b[0], status_to=after[0], move_from=b[1], move_to=after[1])
