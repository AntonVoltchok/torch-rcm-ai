"""Tier-2 sign-off: only the owner signs, once, and only the rule she was shown (07 §5.2)."""

from __future__ import annotations

import pytest

from torch_rcm.api.errors import ApiError
from torch_rcm.api.schemas import RulePatchIn
from torch_rcm.api.services import inbox as inbox_svc
from torch_rcm.api.services import rules as rules_svc
from torch_rcm.api.services.context import Ctx
from torch_rcm.domain.entities import InboxItem, Rule, RuleChange
from torch_rcm.domain.enums import InboxItemKind, InboxItemState, RuleMode
from torch_rcm.domain.invariants import rules_valid
from torch_rcm.runtime import Runtime

RULE = "rule_t2_post_era"
DANA, MORGAN = "usr_dana", "usr_morgan"


def ctx(rt: Runtime, user: str = DANA) -> Ctx:
    return Ctx.for_user(rt, user)


def rule(rt: Runtime) -> Rule:
    return rt.store.require(Rule, RULE)


def request(rt: Runtime, mode: RuleMode, key: str | None = None) -> InboxItem:
    with pytest.raises(ApiError) as exc:
        rules_svc.patch_rule(ctx(rt), RULE, RulePatchIn(mode=mode), idempotency_key=key)
    assert (exc.value.status, exc.value.code) == (409, "owner_signoff_required")
    return rt.store.require(InboxItem, exc.value.details["inbox_item_id"])


def test_billing_cannot_replay_approve_on_a_resolved_signoff(rt: Runtime) -> None:
    item = request(rt, RuleMode.AUTO)
    inbox_svc.approve(ctx(rt, MORGAN), item.id, None)
    rules_svc.patch_rule(ctx(rt, MORGAN), RULE, RulePatchIn(mode=RuleMode.ASK))
    version = rule(rt).version

    with pytest.raises(ApiError) as exc:
        inbox_svc.approve(ctx(rt, DANA), item.id, None)

    assert (exc.value.status, exc.value.code) == (403, "tier_requires_owner")
    assert (rule(rt).mode, rule(rt).version) == (RuleMode.ASK, version)
    assert rules_valid(rt.store.all(Rule), {MORGAN}) == []


def test_the_owner_replaying_a_signoff_applies_nothing(rt: Runtime) -> None:
    item = request(rt, RuleMode.AUTO)
    first = inbox_svc.approve(ctx(rt, MORGAN), item.id, None)
    rules_svc.patch_rule(ctx(rt, MORGAN), RULE, RulePatchIn(mode=RuleMode.ASK))
    changes = rt.store.count(RuleChange)

    again = inbox_svc.approve(ctx(rt, MORGAN), item.id, None)

    assert again.item.id == first.item.id and again.item.state is InboxItemState.APPROVED
    assert again.rule is not None and again.rule.mode is RuleMode.ASK
    assert rt.store.count(RuleChange) == changes


def test_tier3_replay_needs_the_role_too(rt: Runtime) -> None:
    item = rt.store.require(InboxItem, "itm_4611")
    assert item.kind is not InboxItemKind.OWNER_SIGNOFF
    inbox_svc.approve(ctx(rt, MORGAN), item.id, None)
    with pytest.raises(ApiError) as exc:
        inbox_svc.approve(ctx(rt, DANA), item.id, None)
    assert (exc.value.status, exc.value.code) == (403, "tier_requires_owner")
