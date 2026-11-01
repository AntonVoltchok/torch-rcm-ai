"""Inbox read models: priority order (deadline proximity × cents × tier), groups, item views."""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import date

from torch.api.schemas import HoldWindow, InboxGroup, InboxItemDetail, InboxItemOut, InboxList
from torch.domain.entities import FileEntry, InboxItem
from torch.domain.enums import FileEntryState, InboxItemState, RootCause, Tier
from torch.readmodels.claims import patient_ref, summarize, visible_inbox
from torch.readmodels.snapshot import Snapshot

TIER_WEIGHT = {Tier.ONE: 1.0, Tier.TWO: 1.15, Tier.THREE: 1.3}
DONE_STATES = (
    InboxItemState.APPROVED,
    InboxItemState.EDITED,
    InboxItemState.REJECTED,
    InboxItemState.EXPIRED,
    InboxItemState.DONE,
)


def priority(item: InboxItem, today: date) -> float:
    """Higher first. Money on a log scale so a $3,000 item does not bury every $200 one; deadlines inside two
    weeks pull an item up sharply; tier 3 decisions edge ahead of tier 1."""
    money = math.log10(max(item.cents, 100) / 100 + 1)
    tier = TIER_WEIGHT.get(item.tier, 1.1) if item.tier is not None else 1.1
    if item.deadline_on is not None:
        days = max((item.deadline_on - today).days, 0)
        urgency = 1 + 14 / (days + 1)
    else:
        urgency = 1.0
    return round(money * tier * urgency, 4)


def item_out(snap: Snapshot, item: InboxItem) -> InboxItemOut:
    claim = snap.claims.get(item.claim_id or "")
    patient = snap.patients.get(item.patient_id or "")
    evidence = [snap.evidence[e] for e in item.evidence if e in snap.evidence]
    root = item.payload.get("root_cause") or (claim.denial.root_cause.value if claim and claim.denial else None)
    return InboxItemOut(
        id=item.id,
        kind=item.kind,
        state=item.state,
        title=item.title,
        summary=item.summary,
        recommendation=item.recommendation,
        agent=item.agent,
        tier=item.tier,
        cents=item.cents,
        confidence=item.confidence,
        group_key=item.group_key,
        group_title=item.group_title,
        claim=summarize(snap, claim) if claim else None,
        patient=patient_ref(patient) if patient else None,
        appointment_id=item.appointment_id,
        remittance_id=item.remittance_id,
        rule_id=item.rule_id,
        run_id=item.run_id,
        evidence_ids=item.evidence,
        proposed_action=item.proposed_action,
        required_role=item.required_role,
        assignee_user_id=item.assignee_user_id,
        deadline_on=item.deadline_on,
        created_at=item.created_at,
        snoozed_until=item.snoozed_until,
        resolved_by=item.resolved_by,
        resolved_at=item.resolved_at,
        priority=priority(item, snap.today),
        root_cause=RootCause(root) if root else None,
        suspicious_evidence=any(e.suspicious for e in evidence),
    )


def hold_window(snap: Snapshot, item: InboxItem) -> HoldWindow | None:
    if item.claim_id is None:
        return None
    entries = snap.file_entries_by_claim.get(item.claim_id, [])
    if not entries:
        return None
    last: FileEntry = entries[-1]
    departed = last.state is FileEntryState.DEPARTED
    from torch.world.sim import EDIT_LOCK

    return HoldWindow(
        editable_until=None if departed else last.file_time - EDIT_LOCK,
        file_time=last.file_time,
        departed=departed,
        alternatives=["corrected_claim"] if departed else [],
    )


def item_detail(snap: Snapshot, item: InboxItem) -> InboxItemDetail:
    base = item_out(snap, item)
    return InboxItemDetail(
        **base.model_dump(),
        plan_steps=item.plan_steps,
        audit_note=item.audit_note,
        evidence=[snap.evidence[e] for e in item.evidence if e in snap.evidence],
        payload=item.payload,
        hold_window=hold_window(snap, item),
    )


def list_inbox(
    snap: Snapshot,
    user_id: str | None,
    *,
    state: str = "open",
    kind: str | None = None,
    agent: str | None = None,
    group: bool = False,
) -> InboxList:
    if state == "open":
        items = visible_inbox(snap, user_id)
    elif state == "snoozed":
        items = [i for i in snap.of(InboxItem) if i.state is InboxItemState.SNOOZED]
    else:
        items = [i for i in snap.of(InboxItem) if i.state in DONE_STATES]
    if kind:
        items = [i for i in items if i.kind.value == kind]
    if agent:
        items = [i for i in items if i.agent is not None and i.agent.value == agent]
    outs = sorted((item_out(snap, i) for i in items), key=lambda o: (-o.priority, o.created_at, o.id))
    groups = _groups(outs) if group else None
    return InboxList(items=outs, total=len(outs), total_cents=sum(o.cents for o in outs), groups=groups)


def _groups(items: list[InboxItemOut]) -> list[InboxGroup]:
    by_key: dict[str, list[InboxItemOut]] = defaultdict(list)
    for item in items:
        if item.group_key:
            by_key[item.group_key].append(item)
    out = [
        InboxGroup(
            group_key=k,
            title=f"{rows[0].group_title or k} ({len(rows)})",
            count=len(rows),
            cents=sum(r.cents for r in rows),
            item_ids=[r.id for r in rows],
        )
        for k, rows in by_key.items()
        if len(rows) > 1
    ]
    return sorted(out, key=lambda g: -g.cents)
