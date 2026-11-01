"""Inbox mutations: approve (creates the Run and enqueues `run.start` for torch_rcm.agents), group approve, reject,
snooze, reopen, always-auto-run. Every mutation writes an AuditEvent and returns `meta.counts`."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from torch_rcm.api.errors import conflict, forbidden, not_found, unprocessable
from torch_rcm.api.schemas import ApproveOut, GroupApproveOut, InboxItemDetail, InboxList, ItemOut, ProposalOut
from torch_rcm.api.services.context import Ctx
from torch_rcm.api.services.idempotency import idempotent
from torch_rcm.api.services.rules import apply_rule_change
from torch_rcm.domain.entities import InboxItem, Rule, RuleProposal, Run
from torch_rcm.domain.enums import (
    AgentKind,
    InboxItemKind,
    InboxItemState,
    ProposalState,
    Role,
    RootCause,
    RunStatus,
    RunTrigger,
    Tier,
)
from torch_rcm.domain.values import ProposalEvidence
from torch_rcm.readmodels.inbox import item_detail, item_out, list_inbox
from torch_rcm.scheduler import kinds as K
from torch_rcm.world.sim import HoldWindowClosedError

TIER3_ROLES = {
    "write_off": (Role.OWNER,),
    "formal_appeal": (Role.DENTIST, Role.OWNER),
    "void_claim": (Role.OWNER,),
}


def get_inbox(ctx: Ctx, state: str, kind: str | None, agent: str | None, group: bool) -> InboxList:
    return list_inbox(ctx.snapshot(), ctx.user.id, state=state, kind=kind, agent=agent, group=group)


def get_item(ctx: Ctx, item_id: str) -> InboxItemDetail:
    snap = ctx.snapshot()
    item = next((i for i in snap.of(InboxItem) if i.id == item_id), None)
    if item is None:
        raise not_found("inbox item", item_id)
    return item_detail(snap, item)


def _require_item(ctx: Ctx, item_id: str) -> InboxItem:
    item = ctx.rt.store.get(InboxItem, item_id)
    if item is None:
        raise not_found("inbox item", item_id)
    return item


def _approval_run(ctx: Ctx, item: InboxItem, edits: dict[str, Any] | None) -> Run:
    """The Run for an approval: queued, keyed by the item (a double approve is one run), handed to the agents
    through a `run.start` job. Approval runs make no model calls (07-agents §12.7)."""
    key = f"approval:{item.id}"
    existing = ctx.rt.store.find(Run, {"idempotency_key": key}, limit=1)
    if existing:
        return existing[0]
    action = item.proposed_action.action if item.proposed_action else None
    run = Run(
        id=f"run_appr_{item.id.removeprefix('itm_')}_{ctx.now:%m%d%H%M%S}",
        agent=item.agent or AgentKind.FOLLOWUP,
        trigger=RunTrigger.APPROVAL,
        actor=ctx.user.id,
        rule_id=item.rule_id,
        inbox_item_id=item.id,
        claim_id=item.claim_id,
        patient_id=item.patient_id,
        remittance_id=item.remittance_id,
        idempotency_key=key,
        status=RunStatus.QUEUED,
        action=action,
        action_label=action.value.replace("_", " ") if action else "",
        tier=item.tier,
        plan={
            "proposed_action": item.proposed_action.model_dump(mode="json") if item.proposed_action else None,
            "edits": edits or {},
        },
        started_at=ctx.now,
    )
    with ctx.rt.store.tx():
        ctx.rt.store.insert(run)
        ctx.rt.scheduler.enqueue(
            K.RUN_START, ctx.now, {"run_id": run.id, "inbox_item_id": item.id}, f"run.start:{run.id}"
        )
    return run


def _check_can_approve(ctx: Ctx, item: InboxItem) -> None:
    if item.state in (InboxItemState.APPROVED, InboxItemState.EDITED):
        return  # idempotent replay handled by the caller
    if item.state is not InboxItemState.OPEN:
        raise conflict("already_resolved", f"{item.title} is {item.state.value}", state=item.state.value)
    if item.tier is Tier.THREE:
        action = item.proposed_action.action.value if item.proposed_action else ""
        allowed = TIER3_ROLES.get(action, (Role.OWNER,))
        if ctx.user.role not in allowed or (
            item.assignee_user_id and item.assignee_user_id != ctx.user.id and ctx.user.role is not Role.OWNER
        ):
            raise forbidden(
                "tier_requires_owner",
                "Tier 3 commits the practice: only the owner (or the rendering dentist for a formal appeal) "
                "may approve it.",
                required_roles=[r.value for r in allowed],
            )
    if item.kind is InboxItemKind.OWNER_SIGNOFF:
        ctx.require_role(Role.OWNER, code="tier_requires_owner", message="Only the owner signs tier-2 rules.")
    if item.proposed_action and item.proposed_action.requires_hold_window and item.claim_id:
        try:
            ctx.rt.world.vyne.assert_editable(item.claim_id)
        except HoldWindowClosedError as exc:
            raise conflict(
                "file_departed",
                str(exc),
                alternatives=["corrected_claim"],
                left_at=exc.left_at.isoformat() if exc.left_at else None,
            ) from exc


def approve(ctx: Ctx, item_id: str, edits: dict[str, Any] | None, *, idempotency_key: str | None = None) -> ApproveOut:
    scope = f"POST /inbox/{item_id}:approve"
    return idempotent(
        ctx, idempotency_key, scope, edits, ApproveOut, lambda: _approve(ctx, item_id, edits), status_code=202
    )


def _approve(ctx: Ctx, item_id: str, edits: dict[str, Any] | None) -> ApproveOut:
    item = _require_item(ctx, item_id)
    _check_can_approve(ctx, item)
    if item.kind is InboxItemKind.OWNER_SIGNOFF:
        return _approve_signoff(ctx, item)
    if item.kind is InboxItemKind.ELIGIBILITY_FLAG:
        _resolve(ctx, item, InboxItemState.DONE, "flagged to the front desk")
        return ApproveOut(item=item_out(ctx.snapshot(), item), run=None, meta=ctx.meta())
    replay = item.state in (InboxItemState.APPROVED, InboxItemState.EDITED)
    run = _approval_run(ctx, item, edits)
    if not replay:
        item.run_id = run.id
        _resolve(ctx, item, InboxItemState.EDITED if edits else InboxItemState.APPROVED, "approved", edits=edits)
    return ApproveOut(item=item_out(ctx.snapshot(), item), run=run, meta=ctx.meta())


def _approve_signoff(ctx: Ctx, item: InboxItem) -> ApproveOut:
    rule = ctx.rt.store.get(Rule, item.rule_id or "")
    if rule is None:
        raise not_found("rule", item.rule_id or "")
    rule, _ = apply_rule_change(ctx, rule, item.payload.get("change", {}), sign=True)
    _resolve(ctx, item, InboxItemState.APPROVED, "signed")
    return ApproveOut(item=item_out(ctx.snapshot(), item), run=None, rule=rule, meta=ctx.meta())


def _resolve(
    ctx: Ctx,
    item: InboxItem,
    state: InboxItemState,
    verb: str,
    *,
    edits: dict[str, Any] | None = None,
    note: str | None = None,
) -> None:
    item.state = state
    item.resolved_by = ctx.user.id
    item.resolved_at = ctx.now
    item.resolution_note = note
    if edits:
        item.payload = {**item.payload, "edits": edits}
    with ctx.rt.store.tx():
        ctx.rt.store.update(item)
        ctx.audit(
            f"inbox.{verb.split(maxsplit=1)[0]}",
            "inbox_item",
            item.id,
            f"{ctx.user.name} {verb}: {item.title}",
            claim_id=item.claim_id,
        )


def approve_group(ctx: Ctx, group_key: str, *, idempotency_key: str | None = None) -> GroupApproveOut:
    return idempotent(
        ctx,
        idempotency_key,
        "POST /inbox:approve-group",
        {"group_key": group_key},
        GroupApproveOut,
        lambda: _approve_group(ctx, group_key),
        status_code=202,
    )


def _approve_group(ctx: Ctx, group_key: str) -> GroupApproveOut:
    items = ctx.rt.store.find(InboxItem, {"group_key": group_key, "state": InboxItemState.OPEN}, order_by="created_at")
    if not items:
        raise not_found("open group", group_key)
    for item in items:
        _check_can_approve(ctx, item)
    runs = []
    for item in items:
        run = _approval_run(ctx, item, None)
        item.run_id = run.id
        _resolve(ctx, item, InboxItemState.APPROVED, "approved (group)")
        runs.append(run)
    snap = ctx.snapshot()
    fresh = {i.id: i for i in snap.of(InboxItem)}
    return GroupApproveOut(items=[item_out(snap, fresh[i.id]) for i in items], runs=runs, meta=ctx.meta())


def reject(ctx: Ctx, item_id: str, reason: str, *, idempotency_key: str | None = None) -> ItemOut:
    scope = f"POST /inbox/{item_id}:reject"
    return idempotent(ctx, idempotency_key, scope, {"reason": reason}, ItemOut, lambda: _reject(ctx, item_id, reason))


def _reject(ctx: Ctx, item_id: str, reason: str) -> ItemOut:
    item = _require_item(ctx, item_id)
    if item.state is not InboxItemState.OPEN:
        raise conflict("already_resolved", f"{item.title} is {item.state.value}")
    _resolve(ctx, item, InboxItemState.REJECTED, "rejected", note=reason)
    return ItemOut(item=item_out(ctx.snapshot(), item), meta=ctx.meta())


def snooze(ctx: Ctx, item_id: str, until: datetime, *, idempotency_key: str | None = None) -> ItemOut:
    scope = f"POST /inbox/{item_id}:snooze"
    return idempotent(ctx, idempotency_key, scope, {"until": until}, ItemOut, lambda: _snooze(ctx, item_id, until))


def _snooze(ctx: Ctx, item_id: str, until: datetime) -> ItemOut:
    item = _require_item(ctx, item_id)
    if item.state is not InboxItemState.OPEN:
        raise conflict("already_resolved", f"{item.title} is {item.state.value}")
    if until <= ctx.now:
        raise unprocessable("invalid_until", "snooze until must be in the future (sim time)")
    item.state = InboxItemState.SNOOZED
    item.snoozed_until = until
    with ctx.rt.store.tx():
        ctx.rt.store.update(item)
        ctx.rt.scheduler.enqueue(
            K.SNOOZE_WAKE, until, {"item_id": item.id}, f"snooze_wake:{item.id}:{until.isoformat()}"
        )
        ctx.audit("inbox.snooze", "inbox_item", item.id, f"{ctx.user.name} snoozed until {until:%a %m/%d %H:%M}")
    return ItemOut(item=item_out(ctx.snapshot(), item), meta=ctx.meta())


def reopen(ctx: Ctx, item_id: str) -> ItemOut:
    item = _require_item(ctx, item_id)
    if item.state not in (InboxItemState.SNOOZED, InboxItemState.REJECTED):
        raise conflict("not_reopenable", f"{item.title} is {item.state.value}")
    item.state = InboxItemState.OPEN
    item.snoozed_until = item.resolved_by = item.resolved_at = None
    with ctx.rt.store.tx():
        ctx.rt.store.update(item)
        ctx.audit("inbox.reopen", "inbox_item", item.id, f"{ctx.user.name} reopened {item.title}")
    return ItemOut(item=item_out(ctx.snapshot(), item), meta=ctx.meta())


def always_auto_run(ctx: Ctx, item_id: str) -> ProposalOut:
    """Create a RuleProposal from this item's slice now (tier 1 only; `ours` never learns)."""
    item = _require_item(ctx, item_id)
    if item.tier is not Tier.ONE or item.rule_id is None:
        raise unprocessable(
            "tier_not_learnable",
            "Only tier-1 actions under a rule with an outcome metric can learn to run without review.",
        )
    root = item.payload.get("root_cause")
    claim_root = None
    if item.claim_id:
        from torch_rcm.domain.entities import Claim

        claim = ctx.rt.store.get(Claim, item.claim_id)
        claim_root = claim.denial.root_cause.value if claim and claim.denial else None
    if RootCause.OURS.value in (root, claim_root):
        raise unprocessable(
            "root_cause_guard",
            "Root cause is ours: fix the upstream rule; this slice can never run without review.",
            rule_id=item.rule_id,
        )
    rule = ctx.rt.store.require(Rule, item.rule_id)
    if rule.outcome_metric.value == "none":
        raise unprocessable(
            "tier_not_learnable", f"{rule.label} has no outcome metric, so it is authored, never learned."
        )
    pid = f"prop_{item.id.removeprefix('itm_')}_{ctx.now:%m%d%H%M}"
    existing = ctx.rt.store.get(RuleProposal, pid)
    proposal = existing or RuleProposal(
        id=pid,
        title=f"{rule.label} · always run without review",
        rule_draft={
            "rule_id": rule.id,
            "action": rule.action.value,
            "tier": 1,
            "mode": "auto",
            "scope": rule.scope.model_dump(mode="json"),
            "confidence_floor": 0.9,
            "outcome_metric": rule.outcome_metric.value,
        },
        evidence=ProposalEvidence(
            approved=rule.base_rate.n,
            total=rule.base_rate.n,
            outcome_k=rule.base_rate.k,
            outcome_n=rule.base_rate.n,
        ),
        root_cause_guard=False,
        state=ProposalState.OPEN,
        created_at=ctx.now,
        source_item_id=item.id,
    )
    if existing is None:
        with ctx.rt.store.tx():
            ctx.rt.store.insert(proposal)
            ctx.audit("rule.propose", "rule", rule.id, f"{ctx.user.name} asked Torch to always run '{rule.label}'")
    return ProposalOut(proposal=proposal, meta=ctx.meta())
