"""01-domain-model invariants after seed, after the Thursday advance and after the Friday advance."""

from __future__ import annotations

import asyncio

import pytest

from conftest import FRIDAY_0710, THURSDAY_0710, snap
from torch_rcm.domain import invariants as inv
from torch_rcm.domain.entities import (
    Claim,
    InboxItem,
    Practice,
    Remittance,
    Rule,
    RuleProposal,
    Run,
    User,
    WorldCallLog,
)
from torch_rcm.domain.enums import ClaimStatus, Role
from torch_rcm.readmodels.claims import strip
from torch_rcm.readmodels.snapshot import Snapshot
from torch_rcm.runtime import Runtime


def assert_all(s: Snapshot, calls: list[WorldCallLog]) -> None:
    owners = {u.id for u in s.of(User) if u.role is Role.OWNER}
    tiles = {t.status: t.count for t in strip(s).tiles}
    flagged = {c.id for c in s.of(Claim) if s.needs_action(c.id)}
    rules = {r.id: r for r in s.of(Rule)}
    checks = {
        "remit lines balance": inv.remit_lines_balance(s.of(Remittance)),
        "claim lines balance": inv.claim_lines_balance(s.of(Claim)),
        "strip = group by": inv.strip_equals_group_by(s.of(Claim), tiles),
        "needs_action ⇔ open item": inv.needs_action_iff_open_item(s.of(Claim), s.of(InboxItem), flagged),
        "would_have_run ⇔ observe": inv.would_have_run_iff_observe(s.of(Run), rules),
        "rules valid": inv.rules_valid(s.of(Rule), owners),
        "guarded proposals": inv.guarded_proposals_unaccepted(s.of(RuleProposal)),
        "no agent tier 3": inv.no_agent_tier3(s.of(Run)),
        "unique keys": inv.unique_idempotency_keys(s.of(Run), calls),
        "paused": inv.nothing_ran_while_paused(s.of(Practice)[0], calls),
    }
    assert {k: v[:3] for k, v in checks.items() if v} == {}


def test_invariants_after_seed(canonical: Snapshot, canonical_world) -> None:  # type: ignore[no-untyped-def]
    assert_all(canonical, canonical_world.of(WorldCallLog))


def test_inbox_badge_equals_open_items_and_activity_awaiting(canonical: Snapshot) -> None:
    from torch_rcm.readmodels.activity import activity

    s = strip(canonical, "usr_dana")
    assert s.inbox_open == len(canonical.open_items) == activity(canonical).summary.awaiting_you == 12


def test_no_tier3_rule_leaves_human_only(canonical: Snapshot) -> None:
    tier3 = [r for r in canonical.of(Rule) if int(r.tier) == 3]
    assert len(tier3) == 3
    assert all(r.mode.value == "human_only" for r in tier3)
    rule = tier3[0].model_copy(update={"mode": "auto"})
    with pytest.raises(inv.InvariantError):
        inv.check_rule(rule)


def test_tier2_auto_rule_needs_owner_signature(canonical: Snapshot) -> None:
    rule = next(r for r in canonical.of(Rule) if r.id == "rule_t2_post_era").model_copy(update={"signed_by": None})
    with pytest.raises(inv.InvariantError):
        inv.check_rule(rule)


@pytest.mark.parametrize("until", [THURSDAY_0710, FRIDAY_0710])
def test_invariants_after_advance(rt: Runtime, until) -> None:  # type: ignore[no-untyped-def]
    asyncio.run(rt.scheduler.run_due(until))
    s = snap(rt)
    assert_all(s, rt.store.all(WorldCallLog))
    assert s.now == until
    assert any(c.status is ClaimStatus.DENIED for c in s.of(Claim))
