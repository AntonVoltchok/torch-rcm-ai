"""`Idempotency-Key` on mutations: the first response per (user, key) is stored and replayed (services only)."""

from __future__ import annotations

from datetime import timedelta

import pytest

from torch_rcm.api.errors import ApiError
from torch_rcm.api.schemas import PracticeSettingsIn, RulePatchIn
from torch_rcm.api.services import inbox as inbox_svc
from torch_rcm.api.services import rules as rules_svc
from torch_rcm.api.services.context import Ctx
from torch_rcm.api.services.idempotency import record_id
from torch_rcm.domain.entities import IdempotencyRecord, InboxItem, Job, Rule, RuleChange, Run
from torch_rcm.domain.enums import InboxItemState, RuleMode, RunTrigger
from torch_rcm.runtime import Runtime
from torch_rcm.scheduler import kinds as K

GROUP = "delta_ny:denied:CO-16:N29:pa_missing"


def ctx(rt: Runtime, user: str = "usr_dana") -> Ctx:
    return Ctx.for_user(rt, user)


def run_start_jobs(rt: Runtime) -> int:
    return len(rt.store.find(Job, {"kind": K.RUN_START}))


def test_approve_replay_returns_the_stored_response_and_starts_one_run(rt: Runtime) -> None:
    first = inbox_svc.approve(ctx(rt), "itm_4821", None, idempotency_key="k-approve-1")
    again = inbox_svc.approve(ctx(rt), "itm_4821", None, idempotency_key="k-approve-1")
    assert again == first
    approvals = [r for r in rt.store.find(Run, {"inbox_item_id": "itm_4821"}) if r.trigger is RunTrigger.APPROVAL]
    assert first.run is not None and [r.id for r in approvals] == [first.run.id]
    assert run_start_jobs(rt) == 1
    rec = rt.store.require(IdempotencyRecord, record_id("usr_dana", "k-approve-1"))
    assert rec.scope == "POST /inbox/itm_4821:approve" and rec.status_code == 202
    assert rec.body == first.model_dump(mode="json")


def test_without_a_key_run_level_dedupe_still_holds_and_nothing_is_stored(rt: Runtime) -> None:
    first = inbox_svc.approve(ctx(rt), "itm_4821", None)
    again = inbox_svc.approve(ctx(rt), "itm_4821", None)
    assert first.run is not None and again.run is not None and again.run.id == first.run.id  # approval:{item_id}
    assert rt.store.count(IdempotencyRecord) == 0


def test_approve_group_replay(rt: Runtime) -> None:
    first = inbox_svc.approve_group(ctx(rt), GROUP, idempotency_key="k-group")
    again = inbox_svc.approve_group(ctx(rt), GROUP, idempotency_key="k-group")
    assert again == first and len(first.runs) == 3 and run_start_jobs(rt) == 3


def test_reject_and_snooze_replay(rt: Runtime) -> None:
    rejected = inbox_svc.reject(ctx(rt), "itm_4851", "will call the patient", idempotency_key="k-reject")
    assert inbox_svc.reject(ctx(rt), "itm_4851", "will call the patient", idempotency_key="k-reject") == rejected
    until = rt.clock.now() + timedelta(hours=2)
    snoozed = inbox_svc.snooze(ctx(rt), "itm_4748", until, idempotency_key="k-snooze")
    assert inbox_svc.snooze(ctx(rt), "itm_4748", until, idempotency_key="k-snooze") == snoozed
    assert rt.store.require(InboxItem, "itm_4748").state is InboxItemState.SNOOZED


def test_settings_patches_replay_without_a_second_change(rt: Runtime) -> None:
    patch = RulePatchIn(mode=RuleMode.AUTO)
    first = rules_svc.patch_rule(ctx(rt), "rule_t1_status_check", patch, idempotency_key="k-rule")
    changes = rt.store.count(RuleChange)
    version = rt.store.require(Rule, "rule_t1_status_check").version
    assert rules_svc.patch_rule(ctx(rt), "rule_t1_status_check", patch, idempotency_key="k-rule") == first
    assert rt.store.count(RuleChange) == changes
    assert rt.store.require(Rule, "rule_t1_status_check").version == version
    cap = PracticeSettingsIn(practice_cap_cents=150_000)
    out = rules_svc.patch_practice(ctx(rt, "usr_morgan"), cap, idempotency_key="k-cap")
    assert rules_svc.patch_practice(ctx(rt, "usr_morgan"), cap, idempotency_key="k-cap") == out


def test_same_key_with_a_different_request_is_a_422(rt: Runtime) -> None:
    inbox_svc.reject(ctx(rt), "itm_4851", "will call the patient", idempotency_key="k-shared")
    with pytest.raises(ApiError) as exc:
        inbox_svc.snooze(ctx(rt), "itm_4748", rt.clock.now() + timedelta(hours=1), idempotency_key="k-shared")
    assert (exc.value.status, exc.value.code) == (422, "idempotency_key_reused")
    assert rt.store.require(InboxItem, "itm_4748").state is InboxItemState.OPEN


def test_keys_are_per_user(rt: Runtime) -> None:
    inbox_svc.reject(ctx(rt), "itm_4851", "will call the patient", idempotency_key="k-user")
    until = rt.clock.now() + timedelta(hours=1)
    out = inbox_svc.snooze(ctx(rt, "usr_morgan"), "itm_4748", until, idempotency_key="k-user")
    assert out.item.state is InboxItemState.SNOOZED


def test_a_refused_mutation_is_not_stored_so_a_retry_runs_again(rt: Runtime) -> None:
    cap = PracticeSettingsIn(practice_cap_cents=150_000)
    with pytest.raises(ApiError):
        rules_svc.patch_practice(ctx(rt), cap, idempotency_key="k-refused")  # billing: 403 owner_only
    assert rt.store.get(IdempotencyRecord, record_id("usr_dana", "k-refused")) is None


def test_empty_or_oversized_key_is_rejected(rt: Runtime) -> None:
    for key in ("", "x" * 201):
        with pytest.raises(ApiError) as exc:
            inbox_svc.reject(ctx(rt), "itm_4851", "r", idempotency_key=key)
        assert exc.value.code == "invalid_idempotency_key"
