"""Settings › Agents: the tiered rules table, PATCH with the owner sign-off flow, the live preview, proposals."""

from __future__ import annotations

from typing import Any

from torch.api.errors import conflict, forbidden, not_found, unprocessable
from torch.api.schemas import (
    PracticeSettingsIn,
    PracticeSettingsOut,
    PreviewOut,
    ProposalList,
    ProposalOut,
    RuleChangeList,
    RulePatchIn,
    RulePatchOut,
    RuleRow,
    RulesOut,
    TierGroup,
    WeekDecisions,
)
from torch.api.services.context import Ctx
from torch.domain.entities import InboxItem, Practice, Rule, RuleChange, RuleProposal, Run
from torch.domain.enums import (
    InboxItemKind,
    InboxItemState,
    OutcomeMetric,
    ProposalState,
    Role,
    RuleMode,
    RuleOrigin,
    Tier,
)
from torch.domain.invariants import check_rule
from torch.domain.values import Confidence, RuleScope
from torch.readmodels.activity import ran_without_review, this_week, week_decisions
from torch.readmodels.snapshot import Snapshot

TIER_TEXT = {
    Tier.ONE: (
        "Talks to payers",
        "Agent, without review, from PMS data and documents; or asks Dana. "
        "Can learn to run without review where an outcome metric exists.",
    ),
    Tier.TWO: (
        "Touches the ledger or patients",
        "Agent, under a rule Dr. Morgan signed · $1,000 practice cap. "
        "Includes any payer- or patient-facing text the agent wrote.",
    ),
    Tier.THREE: ("Commits the practice", "A person, always. Agents may draft."),
}


def list_rules(ctx: Ctx) -> RulesOut:
    snap = ctx.snapshot()
    runs = this_week(snap)
    open_items = snap.open_items
    groups: list[TierGroup] = []
    for tier in Tier:
        rows = []
        for rule in sorted((r for r in snap.of(Rule) if r.tier is tier), key=lambda r: (r.sort, r.id)):
            ran = sum(1 for r in runs if r.rule_id == rule.id and ran_without_review(r))
            waiting = sum(1 for i in open_items if i.rule_id == rule.id)
            pct = rule.base_rate.pct()
            conf = (
                Confidence(
                    pct=pct,
                    basis=f"{rule.base_rate.k} of {rule.base_rate.n}" if pct is not None else "no base rate",
                )
                if rule.base_rate.n
                else None
            )
            signer = snap.users.get(rule.signed_by or "")
            rows.append(
                RuleRow(
                    rule=rule,
                    ran_without_review_7d=ran,
                    waiting=waiting,
                    confidence=conf,
                    signed_by_name=signer.name if signer else None,
                    locked=tier is Tier.THREE,
                )
            )
        label, text = TIER_TEXT[tier]
        groups.append(TierGroup(tier=tier, label=label, description=text, rows=rows))
    week = week_decisions(snap)
    return RulesOut(
        tiers=groups,
        practice_cap_cents=snap.practice.practice_cap_cents,
        this_week=WeekDecisions(total=week["total"], ran=week["ran"], to_you=week["to_dana"]),
        changes_count=len(snap.of(RuleChange)),
        proposals_open=sum(1 for p in snap.of(RuleProposal) if p.state is ProposalState.OPEN),
    )


def list_changes(ctx: Ctx) -> RuleChangeList:
    rows = sorted(ctx.rt.store.all(RuleChange), key=lambda c: c.at, reverse=True)
    return RuleChangeList(items=rows, total=len(rows))


def _change_dict(patch: RulePatchIn) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if patch.mode is not None:
        out["mode"] = patch.mode.value
    if patch.max_cents is not None:
        out["max_cents"] = patch.max_cents
    if patch.confidence_floor is not None:
        out["confidence_floor"] = patch.confidence_floor
    return out


def apply_rule_change(ctx: Ctx, rule: Rule, change: dict[str, Any], *, sign: bool) -> tuple[Rule, RuleChange]:
    """Apply a change, bump the version, write the RuleChange. Tier-2 edits clear the signature and fall back to
    `ask` unless an owner signs them in the same change (07-agents §5.2)."""
    before = {
        "mode": rule.mode.value,
        "max_cents": rule.scope.max_cents,
        "confidence_floor": rule.confidence_floor,
        "signed_by": rule.signed_by,
    }
    if "mode" in change:
        rule.mode = RuleMode(change["mode"])
    if "max_cents" in change:
        rule.scope = rule.scope.model_copy(update={"max_cents": change["max_cents"]})
    if "confidence_floor" in change:
        rule.confidence_floor = change["confidence_floor"]
    if rule.tier is Tier.TWO:
        if sign:
            rule.signed_by, rule.signed_at = ctx.user.id, ctx.now
        else:
            rule.signed_by = rule.signed_at = None
            if rule.mode is RuleMode.AUTO:
                rule.mode = RuleMode.ASK
    rule.version += 1
    rule.changed_by, rule.changed_at = ctx.user.id, ctx.now
    check_rule(rule)
    after = {
        "mode": rule.mode.value,
        "max_cents": rule.scope.max_cents,
        "confidence_floor": rule.confidence_floor,
        "signed_by": rule.signed_by,
    }
    affected = sum(1 for r in ctx.rt.store.find(Run, {"agent": rule.agent}) if r.rule_id == rule.id)
    rc = RuleChange(
        id=f"rch_{rule.id}_{rule.version}",
        rule_id=rule.id,
        at=ctx.now,
        by=ctx.user.id,
        before=before,
        after=after,
        items_affected_since=affected,
        summary=_summary(rule, before, after),
    )
    with ctx.rt.store.tx():
        ctx.rt.store.update(rule)
        ctx.rt.store.upsert(rc)
        ctx.audit("rule.change", "rule", rule.id, rc.summary, version=rule.version)
    return rule, rc


def _summary(rule: Rule, before: dict[str, Any], after: dict[str, Any]) -> str:
    parts = [
        f"{k}: {before[k]} → {after[k]}" for k in ("mode", "max_cents", "confidence_floor") if before[k] != after[k]
    ]
    if after["signed_by"] and after["signed_by"] != before["signed_by"]:
        parts.append(f"signed by {after['signed_by']}")
    return f"{rule.label} · " + (", ".join(parts) or "no change")


def patch_rule(ctx: Ctx, rule_id: str, patch: RulePatchIn) -> RulePatchOut:
    rule = ctx.rt.store.get(Rule, rule_id)
    if rule is None:
        raise not_found("rule", rule_id)
    change = _change_dict(patch)
    if not change:
        raise unprocessable("empty_patch", "Give mode, max_cents or confidence_floor.")
    if rule.tier is Tier.THREE:
        raise forbidden("human_only", "Tier-3 rules are human-only; they cannot be changed.")
    if ctx.user.role not in (Role.OWNER, Role.BILLING):
        raise forbidden("forbidden", f"{ctx.user.name} cannot change agent rules")
    if rule.tier is Tier.TWO and ctx.user.role is not Role.OWNER:
        item = request_signoff(ctx, rule, change)
        raise conflict(
            "owner_signoff_required",
            "Tier-2 rules need Dr. Morgan's signature; sent to her for sign-off.",
            inbox_item_id=item.id,
            rule_id=rule.id,
        )
    rule, rc = apply_rule_change(ctx, rule, change, sign=rule.tier is Tier.TWO)
    return RulePatchOut(rule=rule, change=rc, meta=ctx.meta())


#: The practice-wide tier-2 cap must stay within what one person can reasonably review ($0 … $25,000).
PRACTICE_CAP_MAX_CENTS = 2_500_000


def patch_practice(ctx: Ctx, body: PracticeSettingsIn) -> PracticeSettingsOut:
    """PATCH /settings/practice: the owner sets the tier-2 practice cap (tier 1 is exempt; policy reads it)."""
    ctx.require_role(Role.OWNER, code="owner_only", message="Only the owner can change the practice cap.")
    cap = body.practice_cap_cents
    if cap < 0 or cap > PRACTICE_CAP_MAX_CENTS:
        raise unprocessable(
            "invalid_cap",
            f"The practice cap must be between $0 and ${PRACTICE_CAP_MAX_CENTS // 100:,}.",
            practice_cap_cents=cap,
        )
    practice = ctx.rt.store.all(Practice)[0]
    before = practice.practice_cap_cents
    if cap != before:
        practice.practice_cap_cents = cap
        ctx.rt.store.update(practice)
        ctx.audit(
            "practice_cap_changed",
            "practice",
            practice.id,
            f"Practice cap ${before / 100:,.0f} → ${cap / 100:,.0f}",
            before=before,
            after=cap,
        )
    return PracticeSettingsOut(practice_cap_cents=cap, meta=ctx.meta())


def request_signoff(ctx: Ctx, rule: Rule, change: dict[str, Any]) -> InboxItem:
    owner = next(u for u in ctx.snapshot().users.values() if u.role is Role.OWNER)
    preview = preview_counts(
        ctx.snapshot(),
        rule.id,
        RuleMode(change.get("mode", rule.mode.value)),
        change.get("max_cents", rule.scope.max_cents),
    )
    item = InboxItem(
        id=f"itm_signoff_{rule.id}_{ctx.now:%m%d%H%M%S}",
        kind=InboxItemKind.OWNER_SIGNOFF,
        state=InboxItemState.OPEN,
        agent=None,
        title=f"Sign-off · {rule.label}",
        summary=f"{ctx.user.name} asked to change a tier-2 rule: " + ", ".join(f"{k} → {v}" for k, v in change.items()),
        recommendation=(
            f"This week, {preview.would_run} of {preview.total} decisions would have run without review "
            f"(now {preview.baseline_would_run})."
        ),
        tier=Tier.TWO,
        rule_id=rule.id,
        assignee_user_id=owner.id,
        required_role=Role.OWNER,
        created_at=ctx.now,
        payload={"change": change, "requested_by": ctx.user.id, "preview": preview.model_dump()},
    )
    with ctx.rt.store.tx():
        ctx.rt.store.insert(item)
        ctx.audit(
            "rule.signoff_requested",
            "rule",
            rule.id,
            f"{ctx.user.name} requested sign-off: {rule.label}",
            change=change,
        )
    return item


# ── preview ────────────────────────────────────────────────────────────────────────────────────────────────


def would_run(
    run: Run,
    rule: Rule | None,
    *,
    mode: RuleMode,
    max_cents: int | None,
    target_rule_id: str,
    cents: int,
    root_cause: str | None,
) -> tuple[bool, str | None]:
    """Would this week's decision have run without review if `target_rule_id` had (mode, max_cents)?
    Returns (would_run, held_reason). Pure; mirrors the Policy rows that a mode change can affect."""
    if run.rule_id != target_rule_id or rule is None:
        return ran_without_review(run), None
    if mode is not RuleMode.AUTO:
        return False, None
    if rule.tier is Tier.THREE:
        return False, None
    if root_cause == "ours":
        return False, "ours"
    if max_cents is not None and cents > max_cents:
        return False, "over_cap"
    return True, None


def preview_counts(snap: Snapshot, rule_id: str, mode: RuleMode, max_cents: int | None) -> PreviewOut:
    rules = snap.rules
    runs = this_week(snap)
    items = {i.id: i for i in snap.of(InboxItem)}
    total = len(runs)
    baseline = sum(1 for r in runs if ran_without_review(r))
    held: dict[str, int] = {}
    count = 0
    for run in runs:
        item = items.get(run.inbox_item_id or "")
        claim = snap.claims.get(run.claim_id or "")
        root = (item.payload.get("root_cause") if item else None) or (
            claim.denial.root_cause.value if claim and claim.denial else None
        )
        cents = item.cents if item else (claim.billed_cents if claim else 0)
        ok, reason = would_run(
            run,
            rules.get(run.rule_id or ""),
            mode=mode,
            max_cents=max_cents,
            target_rule_id=rule_id,
            cents=cents,
            root_cause=root,
        )
        count += ok
        if reason:
            held[reason] = held.get(reason, 0) + 1
    return PreviewOut(
        rule_id=rule_id,
        mode=mode,
        max_cents=max_cents,
        would_run=count,
        total=total,
        baseline_would_run=baseline,
        held_by_root_cause=held,
    )


def preview(ctx: Ctx, rule_id: str, mode: RuleMode | None, max_cents: int | None) -> PreviewOut:
    snap = ctx.snapshot()
    rule = snap.rules.get(rule_id)
    if rule is None:
        raise not_found("rule", rule_id)
    return preview_counts(
        snap, rule_id, mode or rule.mode, max_cents if max_cents is not None else rule.scope.max_cents
    )


# ── proposals ──────────────────────────────────────────────────────────────────────────────────────────────


def list_proposals(ctx: Ctx) -> ProposalList:
    rows = sorted(
        ctx.rt.store.all(RuleProposal),
        key=lambda p: (p.state.value != "open", p.root_cause_guard, p.created_at),
    )
    return ProposalList(items=rows, total=len(rows))


def accept_proposal(ctx: Ctx, proposal_id: str) -> ProposalOut:
    proposal = _proposal(ctx, proposal_id)
    if proposal.root_cause_guard:
        raise unprocessable(
            "root_cause_guard",
            "Root cause is ours: fix the upstream rule. This slice can never run without review.",
        )
    if proposal.watching:
        raise unprocessable(
            "not_enough_evidence",
            "Watching · n = 1: a proposal needs 20 resolved items before it can be accepted.",
        )
    if ctx.user.role not in (Role.OWNER, Role.BILLING):
        raise forbidden("forbidden", f"{ctx.user.name} cannot accept rule proposals")
    draft = proposal.rule_draft
    base = ctx.rt.store.require(Rule, draft["rule_id"])
    scope = RuleScope.model_validate(draft.get("scope", {}))
    new = Rule(
        id=f"{base.id}_learned_{(scope.max_cents or 0) // 100}",
        label=f"{base.label} · under ${(scope.max_cents or 0) / 100:,.0f}" if scope.max_cents else base.label,
        version=1,
        origin=RuleOrigin.LEARNED,
        tier=base.tier,
        agent=base.agent,
        action=base.action,
        scope=scope,
        mode=RuleMode.AUTO,
        confidence_floor=draft.get("confidence_floor", 0.9),
        outcome_metric=OutcomeMetric(draft.get("outcome_metric", base.outcome_metric.value)),
        reverses_in=base.reverses_in,
        signed_by=ctx.user.id,
        signed_at=ctx.now,
        changed_by=ctx.user.id,
        changed_at=ctx.now,
        base_rate=base.base_rate,
        sort=base.sort,
        description=(
            f"Learned from {proposal.evidence.approved} of {proposal.evidence.total} approvals; "
            f"{proposal.evidence.outcome_k} of {proposal.evidence.outcome_n} paid within 30 d."
        ),
    )
    check_rule(new)
    proposal.state = ProposalState.ACCEPTED
    with ctx.rt.store.tx():
        ctx.rt.store.upsert(new)
        ctx.rt.store.update(proposal)
        ctx.rt.store.upsert(
            RuleChange(
                id=f"rch_{new.id}_1",
                rule_id=new.id,
                at=ctx.now,
                by=ctx.user.id,
                before={},
                after={"mode": "auto", "max_cents": scope.max_cents, "origin": "learned"},
                summary=f"Accepted proposal: {proposal.title}",
            )
        )
        ctx.audit("proposal.accept", "rule", new.id, f"{ctx.user.name} accepted: {proposal.title}")
    return ProposalOut(proposal=proposal, rule=new, meta=ctx.meta())


def dismiss_proposal(ctx: Ctx, proposal_id: str) -> ProposalOut:
    proposal = _proposal(ctx, proposal_id)
    proposal.state = ProposalState.DISMISSED
    with ctx.rt.store.tx():
        ctx.rt.store.update(proposal)
        ctx.audit("proposal.dismiss", "rule_proposal", proposal.id, f"{ctx.user.name} dismissed: {proposal.title}")
    return ProposalOut(proposal=proposal, meta=ctx.meta())


def _proposal(ctx: Ctx, proposal_id: str) -> RuleProposal:
    proposal = ctx.rt.store.get(RuleProposal, proposal_id)
    if proposal is None:
        raise not_found("proposal", proposal_id)
    if proposal.state is not ProposalState.OPEN:
        raise conflict("already_resolved", f"proposal is {proposal.state.value}")
    return proposal
