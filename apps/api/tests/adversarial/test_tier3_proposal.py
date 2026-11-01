"""Adversarial (b): a Plan proposing a tier-3 action (write_off, formal_appeal, void_claim) is refused by policy
with the right verdict, whatever the rules say."""

from __future__ import annotations

import pytest
from agent_world import CLAIM, PATIENT, ctx, rule

from torch_rcm.agents.catalog.actions import AGENT_ACTIONS
from torch_rcm.agents.policy import decide
from torch_rcm.agents.types import Plan, ProposedAction

WRITE_OFF = ProposedAction(
    action="write_off", params={"claim_id": CLAIM, "writeoff_cents": 22_800}, evidence_ids=("ev_1",)
)
VOID = ProposedAction(action="void_claim", params={"claim_id": CLAIM}, evidence_ids=("ev_1",))
APPEAL = ProposedAction(action="formal_appeal", params={"claim_id": CLAIM, "level": 1}, evidence_ids=("ev_1",))
REFUND = ProposedAction(action="discretionary_refund", params={"patient_id": PATIENT, "cents": 640})


def plan_with(*actions: ProposedAction) -> Plan:
    return Plan(situation_key="denied:CO-16:N29:pa_missing", actions=actions, reviewer_summary="x", planner="live")


@pytest.mark.parametrize("agent", ["followup", "claims", "posting", "eligibility"])
@pytest.mark.parametrize("action", [WRITE_OFF, VOID, APPEAL, REFUND], ids=lambda a: a.action)
def test_non_appeals_agent_proposing_tier3_is_refused_row1(agent: str, action: ProposedAction) -> None:
    plan = plan_with(action)
    rules = (rule(action.action, 3, "human_only"),)
    for a in plan.actions:
        d = decide(ctx(*rules, agent=agent, expected_values={"amount.write_off": 22_800}), a)
        assert (d.verdict, d.policy_row) == ("refuse", 1), d.reason
        assert "not available" in d.reason


def test_appeals_proposing_formal_appeal_is_prepared_for_the_dentist_row2() -> None:
    d = decide(ctx(rule("formal_appeal", 3, "human_only"), agent="appeals"), APPEAL)
    assert (d.verdict, d.policy_row) == ("propose", 2) and "dentist" in d.reason
    assert d.as_review_draft  # the appeal letter is agent text: review_draft


def test_even_a_corrupt_auto_rule_cannot_run_tier3() -> None:
    # assert_invariants would refuse this table at load; decide still never executes tier 3 in triage
    d = decide(ctx(rule("formal_appeal", 3, "auto"), agent="appeals"), APPEAL)
    assert d.verdict == "propose" and d.policy_row == 2


def test_approval_of_tier3_by_non_role_holder_is_refused() -> None:
    c = ctx(rule("void_claim", 3, "human_only"), run_kind="approval", actor_id="usr_dana", actor_role="billing")
    d = decide(c, VOID)
    assert (d.verdict, d.policy_row) == ("refuse", 1) and "lacks role" in d.reason


def test_mixed_plan_tier3_refused_others_continue() -> None:
    ok = ProposedAction(action="request_835", params={"claim_id": CLAIM}, evidence_ids=("ev_1",))
    plan = plan_with(ok, VOID)
    verdicts = [decide(ctx(rule("request_835", 1, "auto")), a).verdict for a in plan.actions]
    assert verdicts == ["execute", "refuse"]


def test_no_agent_catalog_lists_void_or_write_off() -> None:
    for actions in AGENT_ACTIONS.values():
        assert not {"void_claim", "write_off", "discretionary_refund", "collections_referral", "waiver"} & set(actions)
