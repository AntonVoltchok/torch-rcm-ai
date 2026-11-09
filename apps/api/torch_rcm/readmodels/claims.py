"""Claims read models: summaries, the pipeline strip, A/R aging and by-payer, and the Claims table query."""

from __future__ import annotations

import base64
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime
from typing import Literal

from torch_rcm.api.schemas import (
    ClaimList,
    ClaimMove,
    ClaimRow,
    ClaimSummary,
    HolderCount,
    MoveCount,
    NavBadges,
    PatientRef,
    PayerRef,
    StatusCount,
    Strip,
    StripTile,
)
from torch_rcm.domain.entities import Claim, InboxItem, Patient, Remittance
from torch_rcm.domain.enums import AR_STATUSES, OPEN_STATUSES, ClaimStatus, InboxItemKind, MoveWho, RemitStatus, Role
from torch_rcm.readmodels.moves import claim_move, sees
from torch_rcm.readmodels.snapshot import Snapshot

S = ClaimStatus
TILE_LABELS: dict[ClaimStatus, str] = {
    S.READY: "Ready",
    S.SENT: "Sent",
    S.REJECTED: "Rejected",
    S.ACCEPTED: "Accepted",
    S.PENDING: "Pending",
    S.DENIED: "Denied",
    S.APPEALED: "Appealed",
    S.PARTIAL: "Partial",
    S.PAID: "Paid",
}
TILE_ORDER: tuple[ClaimStatus, ...] = (
    S.READY,
    S.SENT,
    S.REJECTED,
    S.ACCEPTED,
    S.PENDING,
    S.DENIED,
    S.APPEALED,
    S.PARTIAL,
    S.PAID,
)
AGE_BUCKETS: tuple[tuple[str, int, int], ...] = (
    ("0_30", 0, 30),
    ("31_60", 31, 60),
    ("61_90", 61, 90),
    ("90_plus", 91, 10**6),
)


def age_bucket(days: int) -> str:
    return next(key for key, low, high in AGE_BUCKETS if low <= days <= high)


def is_open(claim: Claim) -> bool:
    return claim.closed_reason is None and claim.status in OPEN_STATUSES


def in_ar(claim: Claim) -> bool:
    return claim.closed_reason is None and claim.status in AR_STATUSES


def age_days(claim: Claim, today: date) -> int | None:
    """Days since the claim was sent (A/R aging basis); None for a claim that has not left."""
    return (today - claim.sent_at.date()).days if claim.sent_at else None


def paid_this_month(claim: Claim, today: date) -> bool:
    return (
        claim.status is S.PAID
        and claim.paid_at is not None
        and (claim.paid_at.year, claim.paid_at.month) == (today.year, today.month)
    )


def patient_ref(p: Patient) -> PatientRef:
    return PatientRef(id=p.id, name=f"{p.first} {p.last}", display_name=p.display_name, dob=p.dob)


def payer_ref(snap: Snapshot, key: str) -> PayerRef:
    payer = snap.payers[key]
    return PayerRef(key=payer.key, name=payer.name, short_name=payer.short_name)


def summarize(snap: Snapshot, claim: Claim, viewer_id: str | None = None) -> ClaimSummary:
    """`viewer_id` decides only `move.mine`; every other field is the same for everyone."""
    return ClaimSummary(
        id=claim.id,
        number=claim.number,
        status=claim.status,
        needs_action=snap.needs_action(claim.id),
        patient=patient_ref(snap.patients[claim.patient_id]),
        payer=payer_ref(snap, claim.payer_key.value),
        dos=claim.dos,
        procedures=claim.procedures_summary,
        billed_cents=claim.billed_cents,
        allowed_cents=claim.allowed_cents,
        paid_cents=claim.paid_cents,
        icn=claim.icn,
        reason=claim.reason_text,
        in_flight=claim.in_flight,
        age_days=age_days(claim, snap.today),
        file_time=claim.file_time,
        move=claim_move(snap, claim, viewer_id),
    )


# ── the strip ──────────────────────────────────────────────────────────────────────────────────────────────


def visible_inbox(snap: Snapshot, user_id: str | None) -> list[InboxItem]:
    """The viewer's open queue (`moves.sees`): the shared billing queue plus items assigned to them; front desk sees
    eligibility flags; dentists see only items assigned to them. No user reads as billing."""
    user = snap.users.get(user_id or "")
    if user is None:
        return [i for i in snap.open_items if i.assignee_user_id is None]
    return [i for i in snap.open_items if sees(user, i)]


def _by_holder(moves: list[ClaimMove]) -> list[HolderCount]:
    """A tile's claims split by holder, in first-seen order of MoveWho then holder (the Denied tally)."""
    counts: dict[tuple[MoveWho, Role | None, str | None, bool], int] = {}
    for m in moves:
        key = (m.who, m.holder_role, m.holder_user_id, m.mine)
        counts[key] = counts.get(key, 0) + 1
    order = list(MoveWho)
    return [
        HolderCount(who=who, holder_role=role, holder_user_id=uid, mine=mine, count=n)
        for (who, role, uid, mine), n in sorted(
            counts.items(), key=lambda kv: (order.index(kv[0][0]), not kv[0][3], kv[0][1] or "", kv[0][2] or "")
        )
    ]


def _moves(open_rows: list[Claim], move_of: dict[str, ClaimMove]) -> list[MoveCount]:
    out = []
    for who in MoveWho:
        rows = [c for c in open_rows if move_of[c.id].who is who]
        by_status = [StatusCount(status=s, count=n) for s in OPEN_STATUSES if (n := sum(c.status is s for c in rows))]
        out.append(MoveCount(who=who, count=len(rows), cents=sum(c.billed_cents for c in rows), by_status=by_status))
    return out


def strip(snap: Snapshot, user_id: str | None = None, location_id: str | None = None) -> Strip:
    """GET /summary/strip: one GROUP BY status over claims, plus the viewer's inbox count."""
    claims = [c for c in snap.of(Claim) if location_id is None or c.location_id == location_id]
    move_of = {c.id: claim_move(snap, c, user_id) for c in claims if is_open(c) or c.status is S.PAID}
    tiles: list[StripTile] = []
    flagged_total = flagged_cents = 0
    for status in TILE_ORDER:
        if status is S.PAID:
            rows = [c for c in claims if paid_this_month(c, snap.today)]
            cents = sum(c.paid_cents or 0 for c in rows)
            basis: Literal["billed", "paid"] = "paid"
        else:
            rows = [c for c in claims if c.status is status and c.closed_reason is None]
            cents = sum(c.billed_cents for c in rows)
            basis = "billed"
        flagged = [c for c in rows if snap.needs_action(c.id)]
        flagged_total += len(flagged)
        flagged_cents += sum(c.billed_cents for c in flagged)
        label = f"Paid · {snap.today:%b}" if status is S.PAID else TILE_LABELS[status]
        tiles.append(
            StripTile(
                status=status,
                count=len(rows),
                cents=cents,
                flagged=len(flagged),
                cents_basis=basis,
                label=label,
                by_holder=_by_holder([move_of[c.id] for c in rows]),
            )
        )
    inbox = visible_inbox(snap, user_id)
    open_rows = [c for c in claims if is_open(c)]
    ar_rows = [c for c in claims if in_ar(c)]
    paid = tiles[-1]
    return Strip(
        tiles=tiles,
        moves=_moves(open_rows, move_of),
        inbox_open=len(inbox),
        inbox_open_cents=sum(i.cents for i in inbox),
        inbox_claims=len({i.claim_id for i in inbox if i.claim_id}),
        inbox_visits=len({i.appointment_id for i in inbox if i.claim_id is None and i.appointment_id}),
        paid_month_count=paid.count,
        paid_month_cents=paid.cents,
        open_count=len(open_rows),
        open_cents=sum(c.billed_cents for c in open_rows),
        ar_count=len(ar_rows),
        ar_cents=sum(c.billed_cents for c in ar_rows),
        flagged_count=flagged_total,
        flagged_cents=flagged_cents,
        as_of=snap.now,
        paid_month_label=f"{snap.today:%b}",
        nav_badges=nav_badges(snap, inbox),
    )


def nav_badges(snap: Snapshot, inbox: list[InboxItem]) -> NavBadges:
    from torch_rcm.readmodels.activity import ran_without_review, this_week

    return NavBadges(
        payments=sum(1 for r in snap.of(Remittance) if r.status is not RemitStatus.AUTO_POSTED),
        eligibility=sum(1 for i in inbox if i.kind is InboxItemKind.ELIGIBILITY_FLAG),
        activity=sum(1 for r in this_week(snap) if ran_without_review(r)),
    )


def ar_aging(snap: Snapshot) -> dict[str, tuple[int, int]]:
    out = {key: (0, 0) for key, _, _ in AGE_BUCKETS}
    for c in snap.of(Claim):
        if in_ar(c):
            key = age_bucket(age_days(c, snap.today) or 0)
            count, cents = out[key]
            out[key] = (count + 1, cents + c.billed_cents)
    return out


def ar_by_payer(snap: Snapshot) -> dict[str, tuple[int, int]]:
    out: dict[str, tuple[int, int]] = {}
    for c in snap.of(Claim):
        if in_ar(c):
            count, cents = out.get(c.payer_key.value, (0, 0))
            out[c.payer_key.value] = (count + 1, cents + c.billed_cents)
    return out


# ── the Claims table ───────────────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class ClaimQuery:
    status: tuple[ClaimStatus, ...] = ()
    needs_action: bool | None = None
    payer: str | None = None
    provider: str | None = None
    age_bucket: str | None = None
    q: str | None = None
    location_id: str | None = None
    sort: str = "-age"
    cursor: str | None = None
    limit: int = 200
    include_paid_all: bool = False


SORT_KEYS = {"number", "patient", "payer", "dos", "billed", "status", "age", "last_activity"}


def _sort_key(snap: Snapshot, key: str, claim: Claim) -> tuple[object, ...]:
    if key == "number":
        return (claim.number,)
    if key == "patient":
        p = snap.patients[claim.patient_id]
        return (p.last, p.first)
    if key == "payer":
        return (claim.payer_key.value,)
    if key == "dos":
        return (claim.dos,)
    if key == "billed":
        return (claim.billed_cents,)
    if key == "status":
        return (TILE_ORDER.index(claim.status),)
    if key == "last_activity":
        return (_last_activity(snap, claim)[0] or claim.built_at,)
    return (age_days(claim, snap.today) or -1,)


def _matches(snap: Snapshot, c: Claim, q: ClaimQuery) -> bool:
    if c.closed_reason is not None:
        return False
    if q.status and c.status not in q.status:
        return False
    if (
        not q.status
        and c.status is S.PAID
        and not (q.include_paid_all or paid_this_month(c, snap.today) or q.needs_action)
    ):
        return False
    if q.needs_action is not None and snap.needs_action(c.id) != q.needs_action:
        return False
    if q.status == (S.PAID,) and not q.include_paid_all and not paid_this_month(c, snap.today):
        return False
    checks = (
        q.payer is None or c.payer_key.value == q.payer,
        q.provider is None or c.provider_id == q.provider,
        q.location_id is None or c.location_id == q.location_id,
        q.age_bucket is None or (c.sent_at is not None and age_bucket(age_days(c, snap.today) or 0) == q.age_bucket),
    )
    if not all(checks):
        return False
    if q.q:
        needle = q.q.strip().lower().lstrip("#")
        p = snap.patients[c.patient_id]
        hay = f"{c.number} {p.first} {p.last} {c.icn or ''}".lower()
        return needle in hay
    return True


def encode_cursor(offset: int) -> str:
    return base64.urlsafe_b64encode(f"o:{offset}".encode()).decode()


def decode_cursor(cursor: str | None) -> int:
    if not cursor:
        return 0
    try:
        kind, _, value = base64.urlsafe_b64decode(cursor.encode()).decode().partition(":")
        return int(value) if kind == "o" else 0
    except (ValueError, UnicodeDecodeError):
        return 0


def query_claims(snap: Snapshot, q: ClaimQuery, viewer_id: str | None = None) -> ClaimList:
    rows = [c for c in snap.of(Claim) if _matches(snap, c, q)]
    desc = q.sort.startswith("-")
    key = q.sort.lstrip("-")
    key = key if key in SORT_KEYS else "age"
    rows.sort(key=lambda c: (_sort_key(snap, key, c), c.number), reverse=desc)
    offset = decode_cursor(q.cursor)
    page = rows[offset : offset + q.limit]
    flagged = [c for c in rows if snap.needs_action(c.id)]
    nxt = encode_cursor(offset + q.limit) if offset + q.limit < len(rows) else None
    return ClaimList(
        items=[claim_row(snap, c, viewer_id) for c in page],
        total=len(rows),
        total_cents=sum(c.billed_cents for c in rows),
        flagged_count=len(flagged),
        flagged_cents=sum(c.billed_cents for c in flagged),
        next_cursor=nxt,
    )


def _last_activity(snap: Snapshot, claim: Claim) -> tuple[datetime | None, str | None]:
    runs = snap.runs_by_claim.get(claim.id, [])
    acks = snap.acks_by_claim.get(claim.id, [])
    candidates: list[tuple[datetime, str]] = [(r.started_at, r.result_summary or r.action_label) for r in runs]
    candidates += [(a.at, a.message) for a in acks]
    if not candidates:
        return None, None
    at, text = max(candidates, key=lambda x: x[0])
    return at, text


def claim_row(snap: Snapshot, claim: Claim, viewer_id: str | None = None) -> ClaimRow:
    at, text = _last_activity(snap, claim)
    items = snap.open_items_by_claim.get(claim.id, [])
    provider = snap.providers[claim.provider_id]
    return ClaimRow(
        **summarize(snap, claim, viewer_id).model_dump(),
        provider_id=claim.provider_id,
        provider_name=provider.name,
        location_id=claim.location_id,
        agent_note=items[0].title if items else claim.in_flight,
        last_activity_at=at,
        last_activity=text,
    )


def claims_needing_action(snap: Snapshot) -> Iterable[Claim]:
    return (snap.claims[cid] for cid in snap.open_items_by_claim if cid in snap.claims)
