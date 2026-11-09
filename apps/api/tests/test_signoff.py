"""Tier-2 sign-off: only the owner signs, once, and only the rule she was shown (07 §5.2)."""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor

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


def signoffs(rt: Runtime) -> list[InboxItem]:
    return [i for i in rt.store.all(InboxItem) if i.kind is InboxItemKind.OWNER_SIGNOFF]


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


def test_the_same_key_returns_the_request_in_any_state(rt: Runtime) -> None:
    item = request(rt, RuleMode.AUTO, "k1")
    inbox_svc.reject(ctx(rt, MORGAN), item.id, "not now")
    assert request(rt, RuleMode.AUTO, "k1").id == item.id
    assert len(signoffs(rt)) == 1


def test_the_same_key_with_a_different_change_is_refused(rt: Runtime) -> None:
    request(rt, RuleMode.AUTO, "k1")
    with pytest.raises(ApiError) as exc:
        rules_svc.patch_rule(ctx(rt), RULE, RulePatchIn(mode=RuleMode.OBSERVE), idempotency_key="k1")
    assert (exc.value.status, exc.value.code) == (422, "idempotency_key_reused")
    assert len(signoffs(rt)) == 1


@pytest.mark.parametrize("key", ["", "x" * 201])
def test_a_bad_key_is_refused_before_a_request_is_written(rt: Runtime, key: str) -> None:
    with pytest.raises(ApiError) as exc:
        rules_svc.patch_rule(ctx(rt), RULE, RulePatchIn(mode=RuleMode.AUTO), idempotency_key=key)
    assert exc.value.code == "invalid_idempotency_key"
    assert signoffs(rt) == []


def test_the_request_pins_the_rule_it_was_asked_about(rt: Runtime) -> None:
    before = rule(rt)
    item = request(rt, RuleMode.AUTO)
    assert item.payload["rule_version"] == before.version
    assert item.payload["before"]["mode"] == before.mode.value
    assert item.payload["before"]["max_cents"] == before.scope.max_cents
    assert item.payload["before"]["confidence_floor"] == before.confidence_floor


def test_a_stale_approval_is_refused_and_signs_nothing(rt: Runtime) -> None:
    item = request(rt, RuleMode.AUTO)
    rules_svc.patch_rule(ctx(rt, MORGAN), RULE, RulePatchIn(mode=RuleMode.OBSERVE))
    current = rule(rt)

    with pytest.raises(ApiError) as exc:
        inbox_svc.approve(ctx(rt, MORGAN), item.id, None)

    assert (exc.value.status, exc.value.code) == (409, "signoff_stale")
    assert rule(rt) == current
    assert rt.store.require(InboxItem, item.id).state is InboxItemState.OPEN


def test_the_second_of_two_open_requests_is_stale_once_the_first_is_signed(rt: Runtime) -> None:
    first = request(rt, RuleMode.AUTO)
    second = request(rt, RuleMode.OBSERVE)
    inbox_svc.approve(ctx(rt, MORGAN), first.id, None)
    with pytest.raises(ApiError) as exc:
        inbox_svc.approve(ctx(rt, MORGAN), second.id, None)
    assert exc.value.code == "signoff_stale"
    assert rule(rt).mode is RuleMode.AUTO


def test_asking_again_after_the_rule_moved_is_a_fresh_request(rt: Runtime) -> None:
    stale = request(rt, RuleMode.AUTO)
    rules_svc.patch_rule(ctx(rt, MORGAN), RULE, RulePatchIn(mode=RuleMode.OBSERVE))
    fresh = request(rt, RuleMode.AUTO)
    assert fresh.id != stale.id and fresh.payload["rule_version"] == rule(rt).version
    inbox_svc.approve(ctx(rt, MORGAN), fresh.id, None)
    assert rule(rt).mode is RuleMode.AUTO


@pytest.mark.parametrize("keys", [(None, None), ("k1", "k1"), ("k1", "k2")], ids=["no key", "same key", "two keys"])
def test_concurrent_duplicates_are_one_request_and_never_a_500(rt: Runtime, keys: tuple[str | None, ...]) -> None:
    barrier = threading.Barrier(8)

    def ask(key: str | None) -> str:
        barrier.wait()
        try:
            rules_svc.patch_rule(ctx(rt), RULE, RulePatchIn(mode=RuleMode.AUTO), idempotency_key=key)
        except ApiError as exc:
            return str(exc.code)
        return "applied"

    with ThreadPoolExecutor(8) as pool:
        codes = list(pool.map(ask, keys * 4))

    assert set(codes) == {"owner_signoff_required"}
    assert len(signoffs(rt)) == 1
