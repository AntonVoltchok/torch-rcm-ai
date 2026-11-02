"""The 01-domain-model invariants as pure functions. Each returns a list of violations (empty = holds), so tests
and the eval harness can assert them after seed, after the demo script and after any clock advance.

Inputs are plain sequences of entities; nothing here touches the store or the clock.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Sequence

from torch_rcm.domain.entities import (
    Claim,
    InboxItem,
    Practice,
    Remittance,
    Rule,
    RuleProposal,
    Run,
    WorldCallLog,
)
from torch_rcm.domain.enums import (
    TIER3_ACTIONS,
    ClaimStatus,
    InboxItemState,
    OutcomeMetric,
    ProposalState,
    RuleMode,
    RuleOrigin,
    RunStatus,
    RunTrigger,
    Tier,
)


class InvariantError(ValueError):
    pass


def remit_lines_balance(remittances: Iterable[Remittance]) -> list[str]:
    """Σ paid + adj + patient = billed on every remittance line; patient = Σ PR adjustments."""
    bad: list[str] = []
    for remit in remittances:
        for line in remit.lines:
            if line.billed != line.paid + sum(a.cents for a in line.adj) + line.patient_cents:
                bad.append(f"{remit.id}/{line.id}: {line.billed} ≠ {line.paid} + Σadj + {line.patient_cents}")
            if line.patient_cents != sum(a.cents for a in line.patient_adj):
                bad.append(f"{remit.id}/{line.id}: patient_cents ≠ Σ PR adjustments")
    return bad


def claim_lines_balance(claims: Iterable[Claim]) -> list[str]:
    bad: list[str] = []
    for claim in claims:
        for line in claim.lines:
            if line.paid_cents is None:
                continue
            total = line.paid_cents + sum(a.cents for a in line.adj) + (line.patient_cents or 0)
            if total != line.fee_cents:
                bad.append(f"{claim.id}/{line.id}: {line.fee_cents} ≠ {total}")
        if claim.billed_cents != sum(line.fee_cents for line in claim.lines):
            bad.append(f"{claim.id}: billed ≠ Σ line fees")
    return bad


def strip_equals_group_by(claims: Sequence[Claim], tiles: dict[ClaimStatus, int]) -> list[str]:
    """The strip's counts are a GROUP BY status of live claims (paid excluded: it is a month window)."""
    counts = Counter(c.status for c in claims if c.closed_reason is None)
    return [
        f"{s.value}: strip {tiles[s]} ≠ group-by {counts.get(s, 0)}"
        for s in tiles
        if s is not ClaimStatus.PAID and tiles[s] != counts.get(s, 0)
    ]


def needs_action_iff_open_item(claims: Sequence[Claim], items: Sequence[InboxItem], flagged: set[str]) -> list[str]:
    referenced = {i.claim_id for i in items if i.state is InboxItemState.OPEN and i.claim_id}
    bad = [f"{cid} flagged without an open item" for cid in flagged - referenced]
    bad += [
        f"{cid} has an open item but is not flagged" for cid in referenced - flagged if any(c.id == cid for c in claims)
    ]
    return bad


def item_root_cause_matches_claim(claims: Sequence[Claim], items: Sequence[InboxItem]) -> list[str]:
    """Every screen reads the claim's denial, so a finding held only on an item would show two answers."""
    by_id = {c.id: c for c in claims}
    out: list[str] = []
    for item in items:
        claim = by_id.get(item.claim_id or "")
        found = item.payload.get("root_cause")
        if item.state is InboxItemState.OPEN and claim and claim.denial and found and found != claim.denial.root_cause:
            out.append(f"{item.id}: item says {found}, claim {claim.number} says {claim.denial.root_cause}")
    return out


def would_have_run_iff_observe(runs: Iterable[Run], rules: dict[str, Rule]) -> list[str]:
    bad: list[str] = []
    for run in runs:
        rule = rules.get(run.rule_id or "")
        if run.status is RunStatus.WOULD_HAVE_RUN and (rule is None or rule.mode is not RuleMode.OBSERVE):
            bad.append(f"{run.id}: would_have_run but rule is not in observe")
    return bad


def observe_opens_no_item(items: Iterable[InboxItem]) -> list[str]:
    """`rule_mode` is the mode the deciding rule had when its run opened the item (seeded items carry none: an item
    that predates a switch to `observe` is fine, and approving it records `would_have_run`)."""
    return [f"{i.id}: opened under {i.rule_id} on observe" for i in items if i.payload.get("rule_mode") == "observe"]


def observe_contacts_no_payer(runs: Iterable[Run], calls: Iterable[WorldCallLog]) -> list[str]:
    observed = {r.id for r in runs if r.status is RunStatus.WOULD_HAVE_RUN}
    return [
        f"{c.run_id}: {c.operation} on {c.system}"
        for c in calls
        if c.run_id in observed and c.system.startswith("payer:")
    ]


def check_rule(rule: Rule) -> None:
    """Raise InvariantError for a rule that may not exist (the DB-level check constraint, in code)."""
    if rule.action in TIER3_ACTIONS and rule.mode is not RuleMode.HUMAN_ONLY:
        raise InvariantError(f"{rule.id}: tier-3 action {rule.action.value} must be human_only")
    if rule.tier is Tier.THREE and rule.mode is not RuleMode.HUMAN_ONLY:
        raise InvariantError(f"{rule.id}: tier-3 rules are human_only")
    if rule.tier is Tier.TWO and rule.mode is RuleMode.AUTO and not rule.signed_by:
        raise InvariantError(f"{rule.id}: tier-2 rule in auto needs an owner signature")
    if rule.origin is RuleOrigin.LEARNED and rule.outcome_metric is OutcomeMetric.NONE:
        raise InvariantError(f"{rule.id}: a learned rule needs an outcome metric")


def rules_valid(rules: Iterable[Rule], owners: set[str]) -> list[str]:
    bad: list[str] = []
    for rule in rules:
        try:
            check_rule(rule)
        except InvariantError as exc:
            bad.append(str(exc))
        if rule.tier is Tier.TWO and rule.mode is RuleMode.AUTO and rule.signed_by not in owners:
            bad.append(f"{rule.id}: signed by a non-owner")
    return bad


def guarded_proposals_unaccepted(proposals: Iterable[RuleProposal]) -> list[str]:
    return [
        f"{p.id}: root-cause-guarded proposal accepted"
        for p in proposals
        if p.root_cause_guard and p.state is ProposalState.ACCEPTED
    ]


def no_agent_tier3(runs: Iterable[Run]) -> list[str]:
    """No agent-triggered run executed a tier-3 action (proposing one to a person is fine)."""
    return [
        f"{r.id}: agent run executed {r.action.value if r.action else ''}"
        for r in runs
        if r.trigger in (RunTrigger.RULE, RunTrigger.SCHEDULE, RunTrigger.APPROVAL)
        and r.action in TIER3_ACTIONS
        and r.verdict is not None
        and r.verdict.value == "execute"
        and r.actor is None
    ]


def unique_idempotency_keys(runs: Iterable[Run], calls: Iterable[WorldCallLog]) -> list[str]:
    bad: list[str] = []
    for label, keys in (
        ("run", [r.idempotency_key for r in runs]),
        ("world_call", [c.idempotency_key for c in calls]),
    ):
        dupes = [k for k, n in Counter(keys).items() if n > 1]
        bad += [f"duplicate {label} idempotency key {k}" for k in dupes]
    return bad


def nothing_ran_while_paused(practice: Practice, calls: Iterable[WorldCallLog]) -> list[str]:
    if not practice.agents_paused or practice.agents_paused_at is None:
        return []
    since = practice.agents_paused_at
    return [
        f"{c.id}: mutation by run {c.run_id} while paused" for c in calls if c.mutation and c.run_id and c.at > since
    ]
