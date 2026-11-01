"""Every row of the 07 §5.1 decision table, rule specificity, approval re-checks and the invariant asserts."""

from __future__ import annotations

import random
from datetime import datetime

import pytest
from agent_world import CLAIM, PATIENT, ctx, ev, rule

from torch.agents.catalog.actions import ACTIONS, AGENT_ACTIONS, TIER3_ACTIONS
from torch.agents.policy import (
    ROWS,
    Policy,
    PolicyInvariantError,
    RootCauseGuardError,
    RulePatch,
    apply_rule_patch,
    assert_invariants,
    decide,
    guard_root_cause_ours,
    match_rule,
    route_rule_patch,
)
from torch.agents.types import BaseRate, GuardResult, ProposedAction, RuleScope

RESUBMIT = ProposedAction(
    action="resubmit_with_attachment",
    params={"claim_id": CLAIM, "image_id": "img_t", "attachment_kind": "pa"},
    evidence_ids=("ev_1",),
)
AUTO_RESUBMIT = rule("resubmit_with_attachment", 1, "auto")


def verdict(c, a=RESUBMIT):  # type: ignore[no-untyped-def]
    d = decide(c, a)
    return d.verdict, d.policy_row


# ---------------------------------------------------------------- table shape


def test_rows_match_spec_table() -> None:
    expected = {
        0: "park", 1: "refuse", 2: "propose", 3: "execute", 4: "propose", 5: "propose", 6: "propose",
        7: "observe", 8: "propose", 9: "propose", 10: "propose", 11: "propose", 12: "propose", 13: "propose",
        14: "refuse", 15: "execute",
    }  # fmt: skip
    assert {r.number: r.verdict for r in ROWS} == expected
    assert {r.number for r in ROWS if r.approval_recheck} == {0, 1, 3, 14, 15}


def test_row15_baseline_executes() -> None:
    d = decide(ctx(AUTO_RESUBMIT), RESUBMIT)
    assert (d.verdict, d.policy_row) == ("execute", 15)
    assert d.rule_id == AUTO_RESUBMIT.id and d.confidence and d.confidence.pct == 92


# ---------------------------------------------------------------- rows 0-1


def test_row0_paused_parks_before_anything() -> None:
    assert verdict(ctx(AUTO_RESUBMIT, paused=True)) == ("park", 0)
    # even an invalid action parks: no world call, nothing else evaluated
    assert verdict(ctx(paused=True), ProposedAction(action="void_claim", params={"claim_id": CLAIM})) == ("park", 0)


def test_row0_paused_parks_approval_runs() -> None:
    assert verdict(ctx(AUTO_RESUBMIT, run_kind="approval", paused=True)) == ("park", 0)


@pytest.mark.parametrize(
    "action",
    [
        ProposedAction(action="not_an_action", params={}),
        ProposedAction(action="post_era_line", params={"remittance_id": "rem_t"}),  # posting's, not followup's
        ProposedAction(action="resubmit_with_attachment", params={"claim_id": CLAIM}),  # missing params
        ProposedAction(
            action="resubmit_with_attachment",
            params={"claim_id": CLAIM, "image_id": "img_t", "attachment_kind": "pa", "confidence": 0.99},
        ),  # unknown key
        ProposedAction(
            action="resubmit_with_attachment",
            params={"claim_id": "clm_other", "image_id": "img_t", "attachment_kind": "pa"},
        ),  # out of scope
        ProposedAction(
            action="resubmit_with_attachment",
            params={"claim_id": CLAIM, "image_id": "img_t", "attachment_kind": "pa"},
            evidence_ids=("ev_never_gathered",),
        ),
    ],
    ids=["unknown", "other_agent", "missing_param", "extra_param", "out_of_scope", "ungathered_evidence"],
)
def test_row1_refuses(action: ProposedAction) -> None:
    assert verdict(ctx(AUTO_RESUBMIT), action) == ("refuse", 1)


def test_row1_demographic_value_must_equal_evidence() -> None:
    r = rule("fix_demographics_resend", 1, "auto", base_rate=BaseRate(n=25, k=25))
    base = {"claim_id": CLAIM, "field": "subscriber_id", "source": "pms"}
    c = ctx(r, agent="claims", expected_values={"pms.subscriber_id": "DD100"})
    assert verdict(c, ProposedAction(action="fix_demographics_resend", params={**base, "value": "DD999"})) == (
        "refuse",
        1,
    )
    assert verdict(c, ProposedAction(action="fix_demographics_resend", params={**base, "value": "DD100"})) == (
        "execute",
        15,
    )
    # a triage run may not propose a value code cannot source
    no_source = ctx(r, agent="claims")
    assert verdict(no_source, ProposedAction(action="fix_demographics_resend", params={**base, "value": "DD100"})) == (
        "refuse",
        1,
    )


def test_row1_amount_param_must_equal_evidence() -> None:
    r = rule("patient_transfer", 2, "auto", signed_by="usr_morgan")
    a = ProposedAction(action="patient_transfer", params={"claim_id": CLAIM, "cents": 2720})
    assert verdict(ctx(r, agent="posting", cents=2720), a) == ("refuse", 1)  # no evidence value in triage
    ok = ctx(r, agent="posting", cents=2720, expected_values={"amount.patient_transfer": 2720})
    assert verdict(ok, a) == ("execute", 15)
    bad = ctx(r, agent="posting", cents=2720, expected_values={"amount.patient_transfer": 2700})
    assert verdict(bad, a) == ("refuse", 1)


# ---------------------------------------------------------------- rows 2-4 (tier 3, paper EOB)

FORMAL_APPEAL = ProposedAction(action="formal_appeal", params={"claim_id": CLAIM, "level": 1})
T3_RULE = rule("formal_appeal", 3, "human_only")


def test_row2_tier3_agent_started_is_proposed() -> None:
    d = decide(ctx(T3_RULE, agent="appeals"), FORMAL_APPEAL)
    assert (d.verdict, d.policy_row) == ("propose", 2)
    assert "human only" in d.reason


def test_row3_tier3_human_started_by_role_holder_executes() -> None:
    for role in ("dentist", "owner"):
        c = ctx(T3_RULE, agent="appeals", run_kind="manual", actor_id="usr_lee", actor_role=role)
        assert verdict(c, FORMAL_APPEAL) == ("execute", 3)


def test_row3_without_role_is_refused() -> None:
    c = ctx(T3_RULE, agent="appeals", run_kind="manual", actor_id="usr_dana", actor_role="billing")
    assert verdict(c, FORMAL_APPEAL) == ("refuse", 1)


def test_row4_paper_eob_never_auto_posts() -> None:
    r = rule("post_era_line", 2, "auto", signed_by="usr_morgan", max_cents=500_000)
    a = ProposedAction(action="post_era_line", params={"remittance_id": "rem_t"})
    assert verdict(ctx(r, agent="posting", cents=50_000, paper_eob=True), a) == ("propose", 4)
    assert verdict(ctx(r, agent="posting", cents=50_000, paper_eob=False), a) == ("execute", 15)


# ---------------------------------------------------------------- rows 5-8


def test_row5_unknown_situation_never_executes_whatever_the_rule() -> None:
    assert verdict(ctx(AUTO_RESUBMIT, classifier_situation="unknown", item_type="unknown")) == ("propose", 5)


def test_row5_only_suspicious_evidence() -> None:
    c = ctx(AUTO_RESUBMIT, evidence={"ev_1": ev("ev_1", "portal_screenshot", suspicious=True)})
    d = decide(c, RESUBMIT)
    assert (d.verdict, d.policy_row) == ("propose", 5) and "suspicious" in d.reason
    mixed = ctx(AUTO_RESUBMIT, evidence={"ev_1": ev("ev_1", suspicious=True), "ev_2": ev("ev_2")})
    assert verdict(mixed, RESUBMIT.model_copy(update={"evidence_ids": ("ev_1", "ev_2")})) == ("execute", 15)


def test_row6_no_rule() -> None:
    d = decide(ctx(), RESUBMIT)
    assert (d.verdict, d.policy_row, d.reason) == ("propose", 6, "no rule")


def test_row7_observe_records_only() -> None:
    assert verdict(ctx(rule("resubmit_with_attachment", 1, "observe"))) == ("observe", 7)


@pytest.mark.parametrize("mode", ["ask", "human_only"])
def test_row8_ask_and_human_only(mode: str) -> None:
    assert verdict(ctx(rule("resubmit_with_attachment", 1, mode))) == ("propose", 8)


# ---------------------------------------------------------------- row 9 (agent text)

TEXT = ProposedAction(action="send_claim_agent_text", params={"claim_id": CLAIM})


def test_row9_agent_text_without_signed_text_rule_is_review_draft() -> None:
    r = rule("send_claim_agent_text", 2, "auto", signed_by="usr_morgan", covers_agent_text=False)
    d = decide(ctx(r, agent="claims", cents=50_000, draft_guard=GuardResult(ok=True)), TEXT)
    assert (d.verdict, d.policy_row, d.as_review_draft) == ("propose", 9, True)


def test_row9_guard_failed_is_review_draft_even_under_signed_rule() -> None:
    r = rule("send_claim_agent_text", 2, "auto", signed_by="usr_morgan", covers_agent_text=True)
    bad = GuardResult(ok=False, errors=("segment 0: unsourced 412",))
    d = decide(ctx(r, agent="claims", cents=50_000, draft_guard=bad), TEXT)
    assert (d.verdict, d.policy_row, d.as_review_draft) == ("propose", 9, True)
    assert "fact check" in d.reason


def test_row9_signed_text_rule_and_passing_guard_proceeds() -> None:
    r = rule("send_claim_agent_text", 2, "auto", signed_by="usr_morgan", covers_agent_text=True)
    assert verdict(ctx(r, agent="claims", cents=50_000, draft_guard=GuardResult(ok=True)), TEXT) == ("execute", 15)


def test_any_proposal_with_text_is_review_draft() -> None:
    d = decide(ctx(rule("send_claim_agent_text", 2, "ask"), agent="claims", cents=50_000), TEXT)
    assert (d.verdict, d.policy_row, d.as_review_draft) == ("propose", 8, True)


# ---------------------------------------------------------------- rows 10-13


def test_row10_root_cause_ours_blocks_auto() -> None:
    d = decide(ctx(AUTO_RESUBMIT, root_cause="ours"), RESUBMIT)
    assert (d.verdict, d.policy_row) == ("propose", 10) and "ours" in d.reason


def test_row11_over_rule_cap() -> None:
    r = rule("resubmit_with_attachment", 1, "auto", max_cents=200_000)
    assert verdict(ctx(r, cents=200_000)) == ("execute", 15)  # cap is inclusive
    assert verdict(ctx(r, cents=200_001)) == ("propose", 11)


def test_row11_tier2_practice_cap_and_tier1_exempt() -> None:
    r2 = rule("post_era_line", 2, "auto", signed_by="usr_morgan")
    a = ProposedAction(action="post_era_line", params={"remittance_id": "rem_t"})
    assert verdict(ctx(r2, agent="posting", cents=100_000), a) == ("execute", 15)
    assert verdict(ctx(r2, agent="posting", cents=100_001), a) == ("propose", 11)
    assert verdict(ctx(AUTO_RESUBMIT, cents=10_000_000)) == ("execute", 15)  # tier 1 exempt


def test_row11_demographic_value_not_from_pms() -> None:
    r = rule("fix_demographics_resend", 1, "auto", base_rate=BaseRate(n=25, k=25))
    a = ProposedAction(
        action="fix_demographics_resend",
        params={"claim_id": CLAIM, "field": "subscriber_id", "value": "DD777", "source": "271"},
    )
    assert verdict(ctx(r, agent="claims", expected_values={"271.subscriber_id": "DD777"}), a) == ("propose", 11)


def test_row12_confidence_floor() -> None:
    at_floor = rule("resubmit_with_attachment", 1, "auto", confidence_floor=0.92)  # 23/25 = 92%
    above = rule("resubmit_with_attachment", 1, "auto", confidence_floor=0.93)
    assert verdict(ctx(at_floor)) == ("execute", 15)
    assert verdict(ctx(above)) == ("propose", 12)


def test_row12_no_base_rate_with_floor() -> None:
    thin = rule("resubmit_with_attachment", 1, "auto", confidence_floor=0.5, base_rate=BaseRate(n=4, k=4))
    d = decide(ctx(thin), RESUBMIT)
    assert (d.verdict, d.policy_row) == ("propose", 12)
    assert d.confidence and d.confidence.pct is None and "no base rate" in d.confidence.basis
    no_floor = rule("resubmit_with_attachment", 1, "auto", base_rate=BaseRate(n=4, k=4))
    assert verdict(ctx(no_floor)) == ("execute", 15)


def test_row13_model_and_classifier_disagree() -> None:
    assert verdict(ctx(AUTO_RESUBMIT, model_situation="denied:CO-16:M127:records_request")) == ("propose", 13)
    assert verdict(ctx(AUTO_RESUBMIT, model_situation="denied:CO-16:N29:pa_missing")) == ("execute", 15)


# ---------------------------------------------------------------- row 14 + approval runs

SEND = ProposedAction(action="send_claim_pms_codes", params={"claim_id": CLAIM})


def test_row14_hold_window_closed_refuses_and_offers_corrected_claim() -> None:
    c = ctx(rule("send_claim_pms_codes", 1, "auto"), agent="claims", hold_window_open=False)
    d = decide(c, SEND)
    assert (d.verdict, d.policy_row, d.alternatives) == ("refuse", 14, ("corrected_claim",))
    assert verdict(c.model_copy(update={"hold_window_open": True}), SEND) == ("execute", 15)


def test_approval_runs_recheck_only_rows_0_1_3_14() -> None:
    ask = rule("send_claim_pms_codes", 1, "ask")
    approval = ctx(ask, agent="claims", run_kind="approval", actor_id="usr_dana", actor_role="billing")
    assert verdict(approval, SEND) == ("execute", 15)  # ask row is not re-checked: a person approved
    assert verdict(approval.model_copy(update={"hold_window_open": False}), SEND) == ("refuse", 14)
    assert verdict(approval.model_copy(update={"root_cause": "ours"}), SEND) == ("execute", 15)


def test_hold_claim_is_internal_and_tierless() -> None:
    a = ProposedAction(action="hold_claim", params={"claim_id": CLAIM, "reason": "subscriber_id_invalid"})
    d = decide(ctx(agent="claims"), a)
    assert (d.verdict, d.policy_row) == ("execute", 15) and "internal hold" in d.reason
    bad = ProposedAction(action="hold_claim", params={"claim_id": CLAIM, "reason": "dentist_should_add_notes"})
    assert verdict(ctx(agent="claims"), bad) == ("refuse", 1)


# ---------------------------------------------------------------- rule specificity


def test_most_specific_rule_wins() -> None:
    general = rule("resubmit_with_attachment", 1, "auto", id="r_all")
    by_type = rule("resubmit_with_attachment", 1, "ask", id="r_type", item_type="denied:CO-16:N29:pa_missing")
    by_payer = rule("resubmit_with_attachment", 1, "observe", id="r_payer_type", payer_key="delta_ny",
                    item_type="denied:CO-16:N29:pa_missing")  # fmt: skip
    capped = rule("resubmit_with_attachment", 1, "auto", id="r_capped", payer_key="delta_ny",
                  item_type="denied:CO-16:N29:pa_missing", max_cents=1000)  # fmt: skip
    rules = (general, by_type, by_payer, capped)
    assert match_rule(rules, "resubmit_with_attachment", "delta_ny", "denied:CO-16:N29:pa_missing").id == "r_capped"
    assert (
        match_rule(rules[:3], "resubmit_with_attachment", "delta_ny", "denied:CO-16:N29:pa_missing").id
        == "r_payer_type"
    )
    assert match_rule(rules[:3], "resubmit_with_attachment", "metlife", "denied:CO-16:N29:pa_missing").id == "r_type"
    assert match_rule(rules[:3], "resubmit_with_attachment", "metlife", "pending:status_due").id == "r_all"
    # max_cents is not a filter: an over-cap amount is stopped by row 11, never falls to the broader auto rule
    assert verdict(ctx(*rules, cents=124_000)) == ("propose", 11)


# ---------------------------------------------------------------- invariants (asserts, not rows)


def test_invariant_tier3_rule_must_be_human_only() -> None:
    for mode in ("auto", "ask", "observe"):
        with pytest.raises(PolicyInvariantError, match="human_only"):
            assert_invariants([rule("write_off", 3, mode)])
    assert_invariants([rule("write_off", 3, "human_only")])


def test_invariant_learned_rule_needs_outcome_metric() -> None:
    for metric in (None, "none"):
        with pytest.raises(PolicyInvariantError, match="outcome metric"):
            assert_invariants([rule("records_request", 1, "auto", origin="learned", outcome_metric=metric)])


def test_invariant_tier2_auto_rule_must_be_signed() -> None:
    with pytest.raises(PolicyInvariantError, match="signature"):
        assert_invariants([rule("post_era_line", 2, "auto")])
    assert_invariants([rule("post_era_line", 2, "auto", signed_by="usr_morgan")])
    assert_invariants([rule("post_era_line", 2, "ask")])


def test_invariant_tier_matches_catalog_and_only_tier1_learns() -> None:
    with pytest.raises(PolicyInvariantError, match="catalog tier"):
        assert_invariants([rule("post_era_line", 1, "ask")])
    with pytest.raises(PolicyInvariantError, match="tier-1"):
        assert_invariants([rule("post_era_line", 2, "ask", origin="learned", outcome_metric="balanced")])


def test_policy_constructor_raises_at_load() -> None:
    with pytest.raises(PolicyInvariantError):
        Policy([rule("void_claim", 3, "auto")])


def test_seeded_rules_satisfy_invariants(canonical_world) -> None:  # type: ignore[no-untyped-def]
    from torch.agents.tools.adapters import rule_view
    from torch.domain.entities import Rule

    rules = [rule_view(e) for e in canonical_world.entities.get(Rule, [])]
    assert len(rules) >= 15
    Policy(rules)


def test_root_cause_ours_guard() -> None:
    with pytest.raises(RootCauseGuardError):
        guard_root_cause_ours("ours")
    guard_root_cause_ours("payer")


def test_rule_patch_routing_and_signature_clearing() -> None:
    t3 = rule("formal_appeal", 3, "human_only")
    t2 = rule("post_era_line", 2, "auto", signed_by="usr_morgan")
    t1 = rule("records_request", 1, "auto")
    assert route_rule_patch(t3, "owner") == "human_only"
    assert route_rule_patch(t2, "billing") == "needs_owner_signoff"
    assert route_rule_patch(t2, "owner") == "apply"
    at = datetime.fromisoformat("2026-10-29T10:52:00-04:00")
    with pytest.raises(PolicyInvariantError):
        apply_rule_patch(t2, RulePatch(max_cents=1), "usr_dana", "billing", at)
    signed = apply_rule_patch(t2, RulePatch(max_cents=400_000), "usr_morgan", "owner", at)
    assert signed.signed_by == "usr_morgan" and signed.version == 2
    t1_signed = t1.model_copy(update={"signed_by": "usr_morgan"})
    cleared = apply_rule_patch(t1_signed, RulePatch(max_cents=1000), "usr_dana", "billing", at)
    assert (cleared.signed_by, cleared.mode) == (None, "ask")


# ---------------------------------------------------------------- properties (seeded loops)


def test_property_tier3_never_executes_in_triage() -> None:
    rng = random.Random(7)
    for _ in range(300):
        name = rng.choice(sorted(TIER3_ACTIONS))
        spec = ACTIONS[name]
        params = {"claim_id": CLAIM} if "claim_id" in spec.params.model_fields else {"patient_id": PATIENT}
        for field, info in spec.params.model_fields.items():
            if field not in params and info.is_required():
                params[field] = 100 if "cents" in field else CLAIM
        c = ctx(
            rule(name, 3, rng.choice(["human_only", "auto"])) if rng.random() < 0.5 else rule(name, 3, "human_only"),
            agent=rng.choice(list(AGENT_ACTIONS)),
            root_cause=rng.choice(["ours", "payer", "patient", "unknown"]),
            cents=rng.randint(0, 1_000_000),
            classifier_situation=rng.choice(["unknown", "denied:CO-50:N10:formal_appeal"]),
            expected_values={f"amount.{name}": 100},
        )
        assert decide(c, ProposedAction(action=name, params=params)).verdict != "execute"


def test_property_unknown_or_ours_never_executes() -> None:
    rng = random.Random(11)
    for _ in range(300):
        r = rule(
            "resubmit_with_attachment",
            1,
            "auto",
            confidence_floor=rng.choice([None, 0.5, 0.9]),
            base_rate=BaseRate(n=rng.randint(0, 50), k=0).model_copy(),
            scope=RuleScope(max_cents=rng.choice([None, 10**9])),
        )
        situation = rng.choice(["unknown", "denied:CO-16:N29:pa_missing"])
        cause = "ours" if situation != "unknown" else rng.choice(["ours", "payer"])
        c = ctx(r, classifier_situation=situation, item_type=situation, root_cause=cause, cents=rng.randint(0, 10**6))
        assert decide(c, RESUBMIT).verdict == "propose"
