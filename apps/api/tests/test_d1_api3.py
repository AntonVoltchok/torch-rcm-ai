"""D1 phase 4a (plan d1-build, "Phase 4a notes"): the Inbox headline, whether a rule could learn (`learnable`), the
track record's k of n, and 409 `claim_busy`."""

from __future__ import annotations

from typing import Any

import pytest
from pydantic import ValidationError

from torch_rcm.agents import learning
from torch_rcm.api.errors import ApiError
from torch_rcm.api.services import inbox as inbox_svc
from torch_rcm.api.services.context import Ctx
from torch_rcm.domain.entities import InboxItem, Run
from torch_rcm.domain.enums import InboxItemState, MoveWho, PlannerKind, RunStatus, RunTrigger
from torch_rcm.domain.values import Confidence, track_record
from torch_rcm.readmodels.claims import summarize
from torch_rcm.readmodels.headline import headline
from torch_rcm.readmodels.inbox import list_inbox
from torch_rcm.readmodels.snapshot import Snapshot
from torch_rcm.runtime import Runtime

DANA, MORGAN = "usr_dana", "usr_morgan"
GROUP = "delta_ny:denied:CO-16:N29:pa_missing"

# The canonical seed at its clock (Wed 10/28 10:40), item by item. Every one comes from its situation, none from `title`.
HEADLINES = {
    "itm_4821": "Delta needs the PA x-ray for this crown",
    "itm_4836": "Delta needs the PA x-ray for this crown",
    "itm_4840": "Delta needs the PA x-ray for this crown",
    "itm_4733": "Delta denied this crown as too frequent; its tooth history doesn't match our chart",
    "itm_4705": "MetLife hasn't paid in 64 days, past the prompt-pay limit",
    "itm_4851": "Cigna rejected the subscriber ID, and the eligibility response has a different one",
    "itm_4772": "Cigna applied a deductible the patient already met",
    "itm_4748": "Aetna paid the alternate benefit; the difference may be billable to the patient",
    "itm_4611": "The annual maximum is used up, so the balance goes to the patient",
    "itm_elig_chen": "J. Chen reaches the annual maximum at tomorrow's 9:00 AM visit",
    "itm_elig_kim": "Too soon for S. Kim's plan to cover bitewings at tomorrow's 1:00 PM visit",
    "itm_elig_park": "N. Park's coverage couldn't be verified for Friday's 9:00 AM visit",
}


def ctx(rt: Runtime, user: str = DANA) -> Ctx:
    return Ctx.for_user(rt, user)


def open_items(s: Snapshot) -> list[InboxItem]:
    return sorted((i for i in s.of(InboxItem) if i.state is InboxItemState.OPEN), key=lambda i: i.id)


def approver(item: InboxItem) -> str:
    return MORGAN if item.tier is not None and item.tier.value == 3 else DANA


# ── headline ─────────────────────────────────────────────────────────────────────────────────────────────


def test_every_canonical_headline_is_its_situation_sentence(canonical: Snapshot) -> None:
    got = {i.id: headline(canonical, i) for i in open_items(canonical)}
    assert got == HEADLINES
    assert not any(h == i.title for i in open_items(canonical) for h in [got[i.id]])  # none fell back to the title
    groups = list_inbox(canonical, DANA, group=True).groups or []
    assert [(g.group_key, g.headline) for g in groups] == [(GROUP, "Delta needs the PA x-ray for these 3 crowns")]


def test_the_headline_reads_the_classifier_never_the_model(canonical: Snapshot) -> None:
    """A live run's situation key is model output; the item's recorded classifier key decides the words."""
    item = next(i for i in canonical.of(InboxItem) if i.id == "itm_4705")
    run = next(r for r in canonical.of(Run) if r.id == item.run_id)
    live = run.model_copy(update={"planner": PlannerKind.LIVE, "situation_key": "denied:CO-16:N29:pa_missing"})
    snap = Snapshot(
        now=canonical.now, rows={**canonical.rows, Run: [live if r.id == run.id else r for r in canonical.of(Run)]}
    )
    assert headline(snap, item) == item.title  # the model's key is never read: no situation, so the title stands
    recorded = item.model_copy(update={"payload": {"classifier_situation": "pending:prompt_pay_eligible"}})
    assert headline(snap, recorded) == HEADLINES["itm_4705"]


# ── track record ─────────────────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("k", "n", "basis"),
    [
        (23, 25, "23 of 25 paid within 30 days"),
        (3, 4, "3 of 4 paid within 30 days, too few for a rate"),
        (1, 1, "1 of 1 paid within 30 days, too few for a rate"),
        (0, 0, "No past cases like this yet."),
    ],
)
def test_track_record_words(k: int, n: int, basis: str) -> None:
    record = track_record(k, n, "paid within 30 days")
    assert (record.k, record.n, record.basis) == (k, n, basis)
    assert record.pct == (round(100 * k / n) if n >= 5 else None)


@pytest.mark.parametrize(
    "bad",
    [
        {"pct": 92, "k": 26, "n": 25},  # k above n
        {"pct": 90, "k": 23, "n": 25},  # a percent that is not k of n
        {"pct": 100, "k": 4, "n": 4},  # a percent under five cases
        {"pct": None, "k": 23, "n": 25},  # k of n with its percent withheld
    ],
)
def test_a_confidence_cannot_state_a_percent_its_numbers_do_not_give(bad: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        Confidence(outcome="paid", basis="x", **bad)


def test_every_seeded_track_record_is_its_numbers(canonical: Snapshot) -> None:
    for item in open_items(canonical):
        c = item.confidence
        assert c is not None, item.id
        if c.pct is not None:
            assert c.basis == f"{c.k} of {c.n} {c.outcome}", item.id
            assert "30 d " not in c.basis and not c.basis.endswith("30 d"), item.id


# ── learnable ────────────────────────────────────────────────────────────────────────────────────────────


def _answer(rt: Runtime, item: InboxItem) -> str | None:
    """What `POST /inbox/{id}:always-auto-run` answers: None for a proposal, else its 422 code."""
    try:
        inbox_svc.always_auto_run(ctx(rt), item.id)
    except ApiError as exc:
        assert exc.status == 422
        return exc.code
    return None


def test_the_line_shown_up_front_is_what_the_endpoint_answers(rt: Runtime) -> None:
    snap = ctx(rt).snapshot()
    for item in open_items(snap):
        shown = inbox_svc.get_item(ctx(rt), item.id).learnable
        assert shown.code == _answer(rt, item), item.id
        assert shown.ok is (shown.code is None)
    by_id = {i.id: inbox_svc.get_item(ctx(rt), i.id).learnable for i in open_items(snap)}
    assert by_id["itm_4821"].code == "root_cause_guard"
    assert by_id["itm_4611"].reason == "A person always does this one. It never runs on its own."
    assert by_id["itm_4733"].reason == "The agents wrote this text, so a person reads it before it goes out."
    assert by_id["itm_4772"].reason == "The owner sets this rule. It isn't learned from approvals."
    assert by_id["itm_4705"].ok and by_id["itm_4851"].ok


def test_a_cause_that_is_ours_only_when_computed_now_is_caught_up_front(
    rt: Runtime, monkeypatch: pytest.MonkeyPatch
) -> None:
    """#4705 records no cause; if the agents would compute `ours` now, the up-front line and the endpoint both say so."""

    def ours(_dom: object, claim_id: str) -> str:
        return "ours" if claim_id == "clm_4705" else "unknown"

    monkeypatch.setattr("torch_rcm.agents.case.claim_root_cause", ours)
    monkeypatch.setattr(learning, "claim_root_cause", ours)
    item = rt.store.require(InboxItem, "itm_4705")
    assert item.payload.get("root_cause") is None
    assert inbox_svc.get_item(ctx(rt), "itm_4705").learnable.code == "root_cause_guard"
    assert _answer(rt, item) == "root_cause_guard"


def test_too_few_cases_cannot_be_proposed() -> None:
    from torch_rcm.agents.policy import learnable

    answer = learnable(tier=1, rule_label="x", outcome_metric="paid_30d", n=4, causes=("payer",))
    assert (answer.ok, answer.code) == (False, "not_enough_evidence")


# ── 409 claim_busy ───────────────────────────────────────────────────────────────────────────────────────


def hold(rt: Runtime, claim_id: str, status: RunStatus = RunStatus.RUNNING) -> Run:
    """A rule-triggered run (a scheduled status check, say) on the claim, queued, running or paused."""
    template = rt.store.all(Run)[0]
    run = template.model_copy(
        update={
            "id": f"run_hold_{claim_id}",
            "idempotency_key": f"hold:{claim_id}",
            "claim_id": claim_id,
            "inbox_item_id": None,
            "trigger": RunTrigger.RULE,
            "status": status,
            "claim_outcome": None,
        }
    )
    with rt.store.tx():
        rt.store.insert(run)
    return run


def test_busy_is_exactly_when_the_claim_is_with_the_agents(rt: Runtime) -> None:
    """For every open item on a claim: `claim.move.who == agents` if and only if approve answers 409 claim_busy."""
    items = [i for i in open_items(ctx(rt).snapshot()) if i.claim_id]
    for item in items:
        snap = ctx(rt).snapshot()
        assert summarize(snap, snap.claims[item.claim_id or ""]).move.who is not MoveWho.AGENTS, item.id
    for item in items:
        hold(rt, item.claim_id or "")
    for item in items:
        snap = ctx(rt).snapshot()
        assert summarize(snap, snap.claims[item.claim_id or ""]).move.who is MoveWho.AGENTS, item.id
        with pytest.raises(ApiError) as exc:
            inbox_svc.approve(ctx(rt, approver(item)), item.id, None)
        assert (exc.value.status, exc.value.code) == (409, "claim_busy"), item.id
        number = snap.claims[item.claim_id or ""].number
        assert exc.value.message == f"Agents are working on #{number}. Approve again when they finish."
        assert exc.value.details and exc.value.details["busy"][0]["run_id"] == f"run_hold_{item.claim_id}"


def test_a_paused_run_says_how_to_free_the_claim(rt: Runtime) -> None:
    hold(rt, "clm_4705", RunStatus.PAUSED)
    with pytest.raises(ApiError) as exc:
        inbox_svc.approve(ctx(rt), "itm_4705", None)
    assert exc.value.message == (
        "Agents are paused with a run open on #4705. Resume the agents or cancel that run first."
    )
    assert exc.value.details and exc.value.details["busy"][0]["move_label"] == "Agents paused"


def test_replaying_your_own_approval_is_not_busy(rt: Runtime) -> None:
    first = inbox_svc.approve(ctx(rt), "itm_4705", None)
    assert first.run is not None and first.run.status is RunStatus.QUEUED  # its own run now holds the claim
    again = inbox_svc.approve(ctx(rt), "itm_4705", None, idempotency_key="a-new-key")
    assert again.run is not None and again.run.id == first.run.id


def test_a_refusal_is_not_stored_under_its_key(rt: Runtime) -> None:
    run = hold(rt, "clm_4705")
    with pytest.raises(ApiError):
        inbox_svc.approve(ctx(rt), "itm_4705", None, idempotency_key="k1")
    with rt.store.tx():
        rt.store.update(run.model_copy(update={"status": RunStatus.SUCCEEDED}))
    out = inbox_svc.approve(ctx(rt), "itm_4705", None, idempotency_key="k1")
    assert out.run is not None and out.item.state is InboxItemState.APPROVED


def test_a_group_is_all_or_nothing(rt: Runtime) -> None:
    hold(rt, "clm_4836")
    runs = rt.store.count(Run)
    with pytest.raises(ApiError) as exc:
        inbox_svc.approve_group(ctx(rt), GROUP)
    assert exc.value.code == "claim_busy"
    assert exc.value.message == "Agents are working on #4836. Approve again when they finish."
    assert [b["item_id"] for b in (exc.value.details or {})["busy"]] == ["itm_4836"]
    members = rt.store.find(InboxItem, {"group_key": GROUP})
    assert {m.state for m in members} == {InboxItemState.OPEN}  # nothing approved
    assert rt.store.count(Run) == runs  # and no run made
