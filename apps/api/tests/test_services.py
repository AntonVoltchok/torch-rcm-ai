"""API behaviour through the service layer (the routers are thin wrappers over these functions; the HTTP
contract tests in test_api_contract.py exercise the same flows over httpx where FastAPI is installed)."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

import pytest

from conftest import THURSDAY_0710
from torch_rcm.api.errors import ApiError
from torch_rcm.api.schemas import InjectIn, RulePatchIn
from torch_rcm.api.services import claims as claims_svc
from torch_rcm.api.services import inbox as inbox_svc
from torch_rcm.api.services import rules as rules_svc
from torch_rcm.api.services import screens, system
from torch_rcm.api.services.context import Ctx
from torch_rcm.domain.entities import Attachment, Claim, InboxItem, Job, Rule, Run
from torch_rcm.domain.enums import AttachmentKind, AttachmentSource, ClaimStatus, InboxItemState, RuleMode
from torch_rcm.readmodels.claims import ClaimQuery
from torch_rcm.runtime import Runtime
from torch_rcm.scheduler import kinds as K

GROUP = "delta_ny:denied:CO-16:N29:pa_missing"


def ctx(rt: Runtime, user: str = "usr_dana") -> Ctx:
    return Ctx.for_user(rt, user)


def code(exc: pytest.ExceptionInfo[ApiError]) -> tuple[int, str]:
    return exc.value.status, exc.value.code


# ── inbox ──────────────────────────────────────────────────────────────────────────────────────────────────


def test_inbox_open_is_12_with_the_delta_group(rt: Runtime) -> None:
    out = inbox_svc.get_inbox(ctx(rt), "open", None, None, True)
    assert (out.total, out.total_cents) == (12, 969_700)
    assert (
        out.groups and out.groups[0].title == "Delta Dental · missing PA x-ray (3)" and out.groups[0].cents == 373_000
    )
    detail = inbox_svc.get_item(ctx(rt), "itm_4821")
    assert detail.confidence and detail.confidence.pct == 92 and "23 of 25" in detail.confidence.basis
    assert {e.kind.value for e in detail.evidence} >= {"portal_screenshot", "pms_record", "era_line"}
    assert detail.audit_note and "root cause: ours" in detail.audit_note


def test_approve_group_creates_three_runs_and_moves_the_badges(rt: Runtime) -> None:
    out = inbox_svc.approve_group(ctx(rt), GROUP)
    assert len(out.runs) == 3 and all(r.status.value == "queued" and r.trigger.value == "approval" for r in out.runs)
    assert out.meta.counts.inbox_open == 9
    tiles = {t.status: t for t in out.meta.counts.tiles}
    assert tiles[ClaimStatus.DENIED].count == 5 and tiles[ClaimStatus.DENIED].flagged == 2
    jobs = rt.store.find(Job, {"kind": K.RUN_START})
    assert sorted(j.payload["inbox_item_id"] for j in jobs) == ["itm_4821", "itm_4836", "itm_4840"]


def test_approve_is_idempotent_per_item(rt: Runtime) -> None:
    first = inbox_svc.approve(ctx(rt), "itm_4705", None)
    again = inbox_svc.approve(ctx(rt), "itm_4705", None)
    assert first.run and again.run and first.run.id == again.run.id
    assert rt.store.count(Run, {"inbox_item_id": "itm_4705"}) == 2  # the seeded triage run + one approval run


def test_tier3_requires_owner(rt: Runtime) -> None:
    with pytest.raises(ApiError) as exc:
        inbox_svc.approve(ctx(rt), "itm_4611", None)
    assert code(exc) == (403, "tier_requires_owner")
    out = inbox_svc.approve(ctx(rt, "usr_morgan"), "itm_4611", None)
    assert out.item.state is InboxItemState.APPROVED and out.run and out.run.actor == "usr_morgan"


def test_rejected_item_cannot_be_approved(rt: Runtime) -> None:
    inbox_svc.reject(ctx(rt), "itm_4851", "will call the patient")
    with pytest.raises(ApiError) as exc:
        inbox_svc.approve(ctx(rt), "itm_4851", None)
    assert code(exc) == (409, "already_resolved")


def test_file_departed_offers_a_corrected_claim(rt: Runtime) -> None:
    item = rt.store.require(InboxItem, "itm_4851")
    rt.world.vyne.queue(
        "clm_4851",
        __import__("torch_rcm.domain.enums", fromlist=["FileEntryKind"]).FileEntryKind.RESUBMIT,
        by="usr_dana",
        key="t",
    )
    asyncio.run(rt.scheduler.run_due(rt.clock.now() + timedelta(minutes=40)))
    with pytest.raises(ApiError) as exc:
        inbox_svc.approve(ctx(rt), item.id, None)
    assert (
        code(exc) == (409, "file_departed")
        and exc.value.details
        and exc.value.details["alternatives"] == ["corrected_claim"]
    )


def test_snooze_and_wake(rt: Runtime) -> None:
    until = rt.clock.now() + timedelta(hours=2)
    out = inbox_svc.snooze(ctx(rt), "itm_4748", until)
    assert out.item.state is InboxItemState.SNOOZED and out.meta.counts.inbox_open == 11
    asyncio.run(rt.scheduler.run_due(until + timedelta(minutes=1)))
    assert rt.store.require(InboxItem, "itm_4748").state is InboxItemState.OPEN


def test_always_auto_run_guards_root_cause_ours(rt: Runtime) -> None:
    with pytest.raises(ApiError) as exc:
        inbox_svc.always_auto_run(ctx(rt), "itm_4821")
    assert code(exc) == (422, "root_cause_guard")
    out = inbox_svc.always_auto_run(ctx(rt), "itm_4705")
    assert out.proposal.state.value == "open" and not out.proposal.root_cause_guard


# ── rules ──────────────────────────────────────────────────────────────────────────────────────────────────


def test_rules_table_shape(rt: Runtime) -> None:
    out = rules_svc.list_rules(ctx(rt, "usr_morgan"))
    assert [len(t.rows) for t in out.tiers] == [9, 7, 3]
    assert (out.this_week.ran, out.this_week.to_you, out.this_week.total) == (41, 12, 53)
    assert out.changes_count == 5 and out.practice_cap_cents == 100_000


def test_tier2_patch_by_billing_needs_owner_signoff(rt: Runtime) -> None:
    with pytest.raises(ApiError) as exc:
        rules_svc.patch_rule(ctx(rt), "rule_t2_patient_transfer", RulePatchIn(mode=RuleMode.AUTO))
    assert code(exc) == (409, "owner_signoff_required")
    item_id = (exc.value.details or {})["inbox_item_id"]
    assert inbox_svc.get_inbox(ctx(rt, "usr_morgan"), "open", None, None, False).total == 13
    assert inbox_svc.get_inbox(ctx(rt), "open", None, None, False).total == 12
    out = inbox_svc.approve(ctx(rt, "usr_morgan"), item_id, None)
    assert out.rule and out.rule.mode is RuleMode.AUTO and out.rule.signed_by == "usr_morgan" and out.rule.version == 2


def test_owner_patch_signs_and_tier3_is_locked(rt: Runtime) -> None:
    out = rules_svc.patch_rule(ctx(rt, "usr_morgan"), "rule_t2_patient_transfer", RulePatchIn(mode=RuleMode.AUTO))
    assert out.rule.signed_by == "usr_morgan" and out.change.after["mode"] == "auto"
    with pytest.raises(ApiError) as exc:
        rules_svc.patch_rule(ctx(rt, "usr_morgan"), "rule_t3_formal_appeal", RulePatchIn(mode=RuleMode.AUTO))
    assert code(exc) == (403, "human_only")


def test_tier1_patch_by_billing_applies(rt: Runtime) -> None:
    out = rules_svc.patch_rule(ctx(rt), "rule_t1_status_check", RulePatchIn(mode=RuleMode.AUTO))
    assert out.rule.mode is RuleMode.AUTO and out.rule.version == 2


def test_preview_holds_root_cause_ours(rt: Runtime) -> None:
    base = rules_svc.preview(ctx(rt), "rule_t1_status_check", None, None)
    assert (base.would_run, base.total) == (41, 53)
    flip = rules_svc.preview(ctx(rt), "rule_t1_delta_pa", RuleMode.AUTO, 200_000)
    assert (flip.would_run, flip.held_by_root_cause) == (41, {"ours": 3})
    prompt_pay = rules_svc.preview(ctx(rt), "rule_t1_reprocessing", RuleMode.AUTO, None)
    assert prompt_pay.would_run == 42


def test_proposals_accept_and_guard(rt: Runtime) -> None:
    with pytest.raises(ApiError) as exc:
        rules_svc.accept_proposal(ctx(rt), "prop_delta_pa_ours")
    assert code(exc) == (422, "root_cause_guard")
    with pytest.raises(ApiError) as exc:
        rules_svc.accept_proposal(ctx(rt), "prop_guardian_5mm")
    assert code(exc) == (422, "not_enough_evidence")
    out = rules_svc.accept_proposal(ctx(rt), "prop_delta_pa")
    assert (
        out.rule
        and out.rule.origin.value == "learned"
        and out.rule.signed_by == "usr_dana"
        and out.rule.scope.max_cents == 200_000
    )
    assert rt.store.count(Rule) == 20


# ── claims ─────────────────────────────────────────────────────────────────────────────────────────────────


def test_claims_filters_sort_and_cursor(rt: Runtime) -> None:
    denied = claims_svc.list_claims(ctx(rt), ClaimQuery(status=(ClaimStatus.DENIED,)))
    assert denied.total == 5 and denied.flagged_count == 5
    flagged = claims_svc.list_claims(ctx(rt), ClaimQuery(needs_action=True))
    assert (flagged.total, flagged.total_cents) == (9, 826_500)
    page1 = claims_svc.list_claims(ctx(rt), ClaimQuery(limit=50, sort="number"))
    page2 = claims_svc.list_claims(ctx(rt), ClaimQuery(limit=50, sort="number", cursor=page1.next_cursor))
    assert page1.total == 107 + 118 and page1.next_cursor and page2.items[0].number > page1.items[-1].number
    assert claims_svc.list_claims(ctx(rt), ClaimQuery(q="4744")).items[0].id == "clm_4744"
    by_age = claims_svc.list_claims(ctx(rt), ClaimQuery(status=(ClaimStatus.PENDING,), sort="-age", limit=1))
    assert by_age.items[0].id == "clm_3561"


def test_the_built_entry_lists_what_left_with_the_claim_not_what_came_later(rt: Runtime) -> None:
    claim = rt.store.require(Claim, "clm_4821")
    later = Attachment(
        id="att_later",
        kind=AttachmentKind.PA,
        nea_number="26-4463084",
        source=AttachmentSource.PMS_IMAGING,
        created_at=rt.clock.now(),
    )
    rt.store.update(claim.model_copy(update={"attachments": [*claim.attachments, later]}))
    d = claims_svc.claim_detail(ctx(rt), "clm_4821")
    assert next(e for e in d.timeline if e.kind == "built").detail == "BWX NEA# 47720913"


def test_claim_detail_tells_the_owens_story(rt: Runtime) -> None:
    d = claims_svc.claim_detail(ctx(rt), "clm_4821")
    assert d.claim.needs_action and d.money.allowed_cents == 98_600 and d.money.contractual_cents == 25_400
    kinds = [e.kind for e in d.timeline]
    assert kinds.index("built") < kinds.index("payer_277ca_a1") < kinds.index("remittance")
    assert any(e.root_cause and e.root_cause.value == "ours" for e in d.timeline)
    assert [i.id for i in d.open_inbox_items] == ["itm_4821"]


def test_void_is_owner_only_and_corrected_links_original(rt: Runtime) -> None:
    with pytest.raises(ApiError) as exc:
        claims_svc.void_claim(ctx(rt), "clm_4855", "duplicate")
    assert code(exc) == (403, "tier_requires_owner")
    out = claims_svc.void_claim(ctx(rt, "usr_morgan"), "clm_4855", "duplicate")
    assert out.meta.counts.tiles[0].count == 5, "Ready 6 → 5"
    corr = claims_svc.corrected_claim(ctx(rt), "clm_4733", {})
    assert corr.claim.status is ClaimStatus.READY
    detail = claims_svc.claim_detail(ctx(rt), corr.claim.id)
    assert detail.parent_claim_id == "clm_4733" and detail.frequency_code == 7


def test_manual_triage_enqueues_a_run_and_rejects_a_second(rt: Runtime) -> None:
    out = claims_svc.triage(ctx(rt), "clm_4744", None)
    assert out.run.trigger.value == "manual" and out.run.actor == "usr_dana" and out.run.agent.value == "followup"
    with pytest.raises(ApiError) as exc:
        claims_svc.triage(ctx(rt), "clm_4744", None)
    assert code(exc) == (409, "run_in_progress")


# ── static screens ─────────────────────────────────────────────────────────────────────────────────────────


def test_ledger_today(rt: Runtime) -> None:
    out = screens.ledger_today(ctx(rt))
    assert {r.claim.number for r in out.sent} == {4857, 4864, 4860, 4866, 4863}
    assert {r.claim.number for r in out.leaving_next_file} >= {4859, 4855, 4856}
    assert {h.claim.number for h in out.held} == {4842, 4847, 4849}
    assert [n.cdt for n in out.not_billable] == ["D4341"]
    assert out.next_file_time and out.next_file_time.strftime("%H:%M") == "10:45"


def test_eligibility_and_benefits(rt: Runtime) -> None:
    out = screens.eligibility(ctx(rt, "usr_tasha"), None)
    assert out.need_human == 3
    panel = screens.benefits(ctx(rt, "usr_tasha"), "apt_1029_chen_j")
    assert (
        panel.coverage.remaining_max_cents,
        panel.planned_fee_cents,
        panel.insurance_est_cents,
        panel.patient_est_cents,
    ) == (18_000, 65_000, 18_000, 47_000)


def test_cash_is_owner_only_and_reconciles(rt: Runtime) -> None:
    out = screens.cash(ctx(rt, "usr_morgan"), None)
    kpis = {k.key: k for k in out.kpis}
    assert kpis["days_in_ar"].value == 27 and "÷" in kpis["days_in_ar"].formula
    assert kpis["collections_month"].value == 8_694_000
    assert out.agent_impact.hours_saved_est.basis.startswith("estimate")


def test_denials_grouped_by_next_action(rt: Runtime) -> None:
    asyncio.run(rt.scheduler.run_due(THURSDAY_0710))
    out = screens.denials(ctx(rt))
    rows = {r.claim.id: r for g in out.groups for r in g.rows}
    ito = rows["clm_4796"]
    assert ito.next_action.value == "formal_appeal" and ito.signer == "Dr. Lee" and ito.erisa
    assert "patient authorization required (ERISA)" in ito.checklist
    assert rows["clm_3561"].patient_billable_if_lost is False
    assert out.total == 9


def test_activity_and_patients(rt: Runtime) -> None:
    out = screens.activity(ctx(rt), None, "followup", None)
    assert out.summary.decisions == 53 and all(r.agent is None or r.agent.value == "followup" for r in out.rows)
    bal = screens.patient_balances(ctx(rt))
    assert (bal.ar_cents, bal.credits_cents) == (3_310_000, 218_000)


# ── system ─────────────────────────────────────────────────────────────────────────────────────────────────


def test_advance_and_clock(rt: Runtime) -> None:
    async def advance() -> str:
        accepted = system.start_advance(ctx(rt, "usr_morgan"), None, THURSDAY_0710)
        await rt.scheduler.wait()
        return accepted.advance_id

    out = system.get_advance(ctx(rt, "usr_morgan"), asyncio.run(advance()))
    assert out.done and out.state == "done" and out.error is None and out.now == THURSDAY_0710 and out.meta
    assert {t.status: t.count for t in out.meta.counts.tiles}[ClaimStatus.DENIED] == 9
    assert system.clock(ctx(rt)).now == THURSDAY_0710
    with pytest.raises(ApiError) as exc:
        system.advance_target(ctx(rt), 10, THURSDAY_0710)
    assert code(exc) == (422, "invalid_advance")


def test_agents_pause_is_owner_only_and_parks_agent_jobs(rt: Runtime) -> None:
    with pytest.raises(ApiError):
        system.set_paused(ctx(rt), True)
    inbox_svc.approve(ctx(rt), "itm_4705", None)
    status = system.set_paused(ctx(rt, "usr_morgan"), True)
    assert status.paused and status.paused_by == "usr_morgan"
    assert rt.store.count(Job, {"kind": K.RUN_START, "state": "parked"}) == 1
    with pytest.raises(ApiError) as exc:
        claims_svc.triage(ctx(rt), "clm_4744", None)
    assert code(exc) == (409, "agents_paused")
    assert not system.set_paused(ctx(rt, "usr_morgan"), False).paused
    assert rt.store.count(Job, {"kind": K.RUN_START, "state": "queued"}) == 1


def test_world_inject_and_reseed(rt: Runtime) -> None:
    out = system.inject(ctx(rt, "usr_morgan"), InjectIn(event="portal_outage", payer_key="delta_ny"))  # type: ignore[arg-type]
    assert "down since 10:40" in out.detail
    assert any(p.portal_down for p in system.world_payers(ctx(rt)) if p.key.value == "delta_ny")
    inbox_svc.approve_group(ctx(rt), GROUP)
    re = system.reseed(ctx(rt), "canonical")
    assert re.meta.counts.inbox_open == 12 and re.now == datetime.fromisoformat("2026-10-28T10:40:00-04:00")
    with pytest.raises(ApiError) as exc:
        system.reseed(ctx(rt), "nope")
    assert code(exc) == (422, "unknown_scenario")


def test_unknown_user_is_401(rt: Runtime) -> None:
    with pytest.raises(ApiError) as exc:
        Ctx.for_user(rt, "usr_mallory")
    assert code(exc) == (401, "unknown_user")


# ── integration: practice cap, nav badges, typed overnight deadlines, frequency history ───────────────────


def test_practice_cap_patch_is_owner_only(rt: Runtime) -> None:
    from torch_rcm.api.schemas import PracticeSettingsIn

    with pytest.raises(ApiError) as exc:
        rules_svc.patch_practice(ctx(rt), PracticeSettingsIn(practice_cap_cents=150_000))
    assert code(exc) == (403, "owner_only")
    with pytest.raises(ApiError) as exc:
        rules_svc.patch_practice(ctx(rt, "usr_morgan"), PracticeSettingsIn(practice_cap_cents=-1))
    assert code(exc) == (422, "invalid_cap")
    out = rules_svc.patch_practice(ctx(rt, "usr_morgan"), PracticeSettingsIn(practice_cap_cents=150_000))
    assert out.practice_cap_cents == 150_000 and out.meta.counts.inbox_open == 12
    assert rules_svc.list_rules(ctx(rt, "usr_morgan")).practice_cap_cents == 150_000


def test_strip_nav_badges_are_server_counts(rt: Runtime) -> None:
    s = screens.summary_strip(ctx(rt), None)
    assert s.paid_month_label == "Oct"
    assert (s.nav_badges.payments, s.nav_badges.eligibility, s.nav_badges.activity) == (3, 3, 41)


def test_overnight_denials_carry_typed_deadlines(rt: Runtime) -> None:
    from torch_rcm.domain.entities import Claim

    asyncio.run(rt.scheduler.run_due(THURSDAY_0710))
    got = {
        c.number: (c.deadline.kind.value, c.deadline.due_on and c.deadline.due_on.isoformat(), c.deadline.basis)
        for c in rt.store.all(Claim)
        if c.number in (4796, 4797, 3561, 4800)
    }
    assert got[4796] == ("appeal", "2027-04-27", "Guardian: 180 days from the 10/29 ERA · ERISA (29 CFR 2560.503-1)")
    assert got[3561] == ("appeal", "2027-04-27", "MetLife: timely-filing appeal 180 days from the 10/29 ERA")
    assert got[4800] == ("timely_filing", "2027-10-13", "MetLife: file as primary within 365 days of the 10/13 DOS")
    assert got[4797] == ("none", None, "records request · no appeal clock")
    rows = {r.claim.number: r for g in screens.denials(ctx(rt)).groups for r in g.rows}
    assert rows[4796].deadline.kind.value == "appeal" and rows[4796].erisa


def test_chen_frequency_rows_show_pms_history(rt: Runtime) -> None:
    panel = screens.benefits(ctx(rt), "apt_1029_chen_j")
    iso = lambda d: d and d.isoformat()  # noqa: E731
    rows = {f.cdt: (iso(f.last_done), iso(f.ok_from)) for f in panel.frequencies}
    assert rows["D4341"] == ("2024-03-12", None)
    assert rows["D0274"] == ("2025-11-03", "2026-11-03")
    assert rows["D1110"] == ("2026-04-14", None)
