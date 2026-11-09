"""Inbox read models: priority order (deadline proximity × cents × tier), groups, item views."""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import date

from torch_rcm.agents.policy import learnable
from torch_rcm.agents.types import UNKNOWN
from torch_rcm.api.schemas import HoldWindow, InboxGroup, InboxItemDetail, InboxItemOut, InboxList, Learnable
from torch_rcm.domain.entities import FileEntry, InboxItem, Run
from torch_rcm.domain.enums import FileEntryState, InboxItemKind, InboxItemState, RootCause, RuleMode, Tier
from torch_rcm.readmodels.claims import patient_ref, split_inbox, summarize, visible_inbox
from torch_rcm.readmodels.headline import group_headline, headline, situation
from torch_rcm.readmodels.snapshot import Snapshot
from torch_rcm.readmodels.wording import action_label, item_touches, lands, signer_note

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


def _policy_sentence(reason: str) -> str:
    parts = [p[0].upper() + p[1:] for p in reason.replace("_", " ").split(" · ")]
    text = ". ".join(parts)
    return f"{text.removesuffix(' is ask')} is set to Ask." if text.endswith(" is ask") else f"{text}."


def stopped_by(snap: Snapshot, item: InboxItem) -> str:
    """Why this reached a person. A run records the policy's own reason; a seeded item has none, so its tier, kind
    and rule say it. Built here so the web never restates policy."""
    reason = item.payload.get("policy_reason")
    if reason:
        return _policy_sentence(str(reason))
    if item.kind is InboxItemKind.ELIGIBILITY_FLAG:
        return "What a patient is quoted or asked to sign is a person's call."
    if item.kind is InboxItemKind.OWNER_SIGNOFF:
        return "A tier 2 rule changes only with the owner's signature."
    if item.tier is Tier.THREE:
        return "Tier 3 is human only. No rule can run this."
    if item.kind is InboxItemKind.REVIEW_DRAFT:
        return "Agent-written text to a payer goes to a person."
    rule = snap.rules.get(item.rule_id or "")
    if rule is None:
        return "No rule covers this, so a person decides."
    if rule.mode is RuleMode.ASK:
        return f"Rule \u201c{rule.label}\u201d is set to Ask."
    run = next((r for r in snap.of(Run) if r.id == item.run_id), None)
    detail = f" {run.result_summary}" if run and run.result_summary else ""
    return f"Outside the rule \u201c{rule.label}\u201d.{detail}"


def item_out(snap: Snapshot, item: InboxItem, viewer_id: str | None = None) -> InboxItemOut:
    claim = snap.claims.get(item.claim_id or "")
    patient = snap.patients.get(item.patient_id or "")
    evidence = [snap.evidence[e] for e in item.evidence if e in snap.evidence]
    root = item.payload.get("root_cause") or (claim.denial.root_cause.value if claim and claim.denial else None)
    return InboxItemOut(
        id=item.id,
        kind=item.kind,
        state=item.state,
        title=item.title,
        headline=headline(snap, item),
        summary=item.summary,
        recommendation=item.recommendation,
        agent=item.agent,
        tier=item.tier,
        cents=item.cents,
        confidence=item.confidence,
        group_key=item.group_key,
        group_title=item.group_title,
        claim=summarize(snap, claim, viewer_id) if claim else None,
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
        stopped_by=stopped_by(snap, item),
        root_cause=RootCause(root) if root else None,
        suspicious_evidence=any(e.suspicious for e in evidence),
        action_label=action_label(snap, item),
        touches=item_touches(snap, [item]),
        signer_note=signer_note(snap, item, viewer_id),
        lands=lands(snap, item),
        learnable=item_learnable(snap, item),
    )


def item_learnable(snap: Snapshot, item: InboxItem) -> Learnable:
    """Policy's answer to "could this rule learn to run without review?", over every root cause on record: the
    item's, the claim's denial, and the one the agents would compute now (when the snapshot can ask)."""
    rule = snap.rules.get(item.rule_id or "")
    claim = snap.claims.get(item.claim_id or "")
    now = snap.root_cause_now(claim.id) if claim and snap.root_cause_now else None
    stated = item.payload.get("root_cause")
    answer = learnable(
        tier=item.tier.value if item.tier is not None else None,
        rule_label=rule.label if rule else None,
        outcome_metric=rule.outcome_metric.value if rule else None,
        n=rule.base_rate.n if rule else 0,
        drafted=item.kind is InboxItemKind.REVIEW_DRAFT,
        unnamed=situation(snap, item) == UNKNOWN,
        causes=(
            stated if isinstance(stated, str) else None,
            claim.denial.root_cause.value if claim and claim.denial else None,
            now,
        ),
    )
    return Learnable(ok=answer.ok, code=answer.code, reason=answer.reason)


def hold_window(snap: Snapshot, item: InboxItem) -> HoldWindow | None:
    if item.claim_id is None:
        return None
    entries = snap.file_entries_by_claim.get(item.claim_id, [])
    if not entries:
        return None
    last: FileEntry = entries[-1]
    departed = last.state is FileEntryState.DEPARTED
    from torch_rcm.world.sim import EDIT_LOCK

    return HoldWindow(
        editable_until=None if departed else last.file_time - EDIT_LOCK,
        file_time=last.file_time,
        departed=departed,
        alternatives=["corrected_claim"] if departed else [],
    )


def item_detail(snap: Snapshot, item: InboxItem, viewer_id: str | None = None) -> InboxItemDetail:
    base = item_out(snap, item, viewer_id)
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
    outs = sorted((item_out(snap, i, user_id) for i in items), key=lambda o: (-o.priority, o.created_at, o.id))
    groups = _groups(snap, outs, {i.id: i for i in items}) if group else None
    yours, waiting = split_inbox(snap, user_id, items)
    return InboxList(
        items=outs,
        total=len(outs),
        total_cents=sum(o.cents for o in outs),
        actionable=len(yours),
        waiting=waiting,
        groups=groups,
    )


def _groups(snap: Snapshot, items: list[InboxItemOut], raw: dict[str, InboxItem]) -> list[InboxGroup]:
    by_key: dict[str, list[InboxItemOut]] = defaultdict(list)
    for item in items:
        if item.group_key:
            by_key[item.group_key].append(item)
    out = [
        InboxGroup(
            group_key=k,
            title=f"{rows[0].group_title or k} ({len(rows)})",
            headline=group_headline(snap, [raw[r.id] for r in rows], f"{rows[0].group_title or k} ({len(rows)})"),
            count=len(rows),
            cents=sum(r.cents for r in rows),
            item_ids=[r.id for r in rows],
            action_label=action_label(snap, raw[rows[0].id], n=len(rows)),
            touches=item_touches(snap, [raw[r.id] for r in rows]),
        )
        for k, rows in by_key.items()
        if len(rows) > 1
    ]
    return sorted(out, key=lambda g: -g.cents)
