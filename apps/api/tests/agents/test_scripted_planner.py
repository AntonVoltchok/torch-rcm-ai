"""Scripted / recorded planners on the pinned cases of 04-seed.md, after the Thursday 07:10 advance (when the
10/29 denials for #4796, #4797, #3561 and #4800 have arrived). Reads go through the real scope-checked
ToolRegistry over the simulated world."""

from __future__ import annotations

import asyncio

import pytest
from agent_world import World, case_for, plan_case, policy_ctx_for, world  # noqa: F401  (fixture)

from torch.agents.catalog.actions import ACTIONS
from torch.agents.guardrails import guard_draft
from torch.agents.planner.scripted import ScriptedPlanner
from torch.agents.planner.templates import TEMPLATE_DIR, render, structured_facts
from torch.agents.policy import decide
from torch.agents.types import UNKNOWN, CoverageView

# claim, agent, situation key, action, tier, evidence kinds that must be cited
PINNED = [
    ("clm_4821", "followup", "denied:CO-16:N29:pa_missing", "resubmit_with_attachment", 1, {"era_line", "pms_record"}),
    ("clm_4733", "followup", "denied:CO-119:frequency_history_conflict", "reprocessing_request", 1,
     {"era_line", "prior_eob"}),
    ("clm_4705", "followup", "pending:prompt_pay_eligible", "reprocessing_request", 1, {"policy_clause"}),
    ("clm_4796", "appeals", "denied:CO-50:N10:formal_appeal", "formal_appeal", 3, {"era_line"}),
    ("clm_4797", "followup", "denied:CO-16:M127:records_request", "records_request", 1, {"era_line", "pms_record"}),
    ("clm_3561", "appeals", "denied:CO-29:timely_filing_appeal", "formal_appeal", 3, {"era_line"}),
]  # fmt: skip


@pytest.mark.parametrize(("claim_id", "agent", "key", "action", "tier", "kinds"), PINNED, ids=[p[0] for p in PINNED])
def test_pinned_plan(world: World, claim_id, agent, key, action, tier, kinds) -> None:  # type: ignore[no-untyped-def]  # noqa: F811
    case = case_for(world, claim_id, agent)
    assert case.classifier_situation == key
    plan, evidence = plan_case(world, case)
    assert plan.planner == "scripted" and plan.situation_key == key
    assert [a.action for a in plan.actions] == [action]
    proposed = plan.actions[0]
    assert ACTIONS[proposed.action].tier == tier
    by_id = evidence.by_id()
    assert all(e in by_id for e in proposed.evidence_ids), "cites only evidence this run holds"
    assert kinds <= {by_id[e].kind for e in proposed.evidence_ids}
    assert proposed.params.get("claim_id") == claim_id
    d = decide(policy_ctx_for(case, evidence), proposed)
    assert d.verdict in ("propose", "execute"), d.reason
    if tier == 3:
        assert (d.verdict, d.policy_row) == ("propose", 2)


def test_owens_details(world: World) -> None:  # noqa: F811
    case = case_for(world, "clm_4821", "followup")
    assert case.root_cause == "ours"
    plan, evidence = plan_case(world, case)
    a = plan.actions[0]
    assert a.params == {"claim_id": "clm_4821", "image_id": "img_owens_k_1012_pa_19", "attachment_kind": "pa"}
    d = decide(policy_ctx_for(case, evidence), a)
    assert d.verdict == "propose" and d.rule_id == "rule_t1_delta_pa"
    assert d.confidence and d.confidence.pct == 92  # 23 of 25 paid within 30 d
    # root cause ours blocks auto even if the rule were auto
    auto = tuple(
        r.model_copy(update={"mode": "auto"}) if r.id == "rule_t1_delta_pa" else r for r in case.rules_snapshot
    )
    d_auto = decide(policy_ctx_for(case, evidence, rules=auto), a)
    assert (d_auto.verdict, d_auto.policy_row) == ("propose", 10)


def test_webb_attaches_payers_own_prior_eob(world: World) -> None:  # noqa: F811
    plan, evidence = plan_case(world, case_for(world, "clm_4733", "followup"))
    a = plan.actions[0]
    assert a.params["basis"] == "payer_history_error"
    assert a.params["attach"] and all(evidence.by_id()[e].kind == "prior_eob" for e in a.params["attach"])  # type: ignore[union-attr]


def test_castillo_sends_fmx_and_perio_chart(world: World) -> None:  # noqa: F811
    plan, _ = plan_case(world, case_for(world, "clm_4797", "followup"))
    p = plan.actions[0].params
    assert sorted(p["image_ids"]) == ["img_castillo_a_1009_fmx", "img_castillo_a_1009_perio_chart"]  # type: ignore[arg-type]
    assert p["note_visit_ids"] == ["vis_1009_castillo"]


def test_brooks_prompt_pay(world: World) -> None:  # noqa: F811
    plan, _ = plan_case(world, case_for(world, "clm_4705", "followup"))
    assert plan.actions[0].params["basis"] == "ny_prompt_pay"


def test_moreno_cob_single_coverage_needs_a_person(world: World) -> None:  # noqa: F811
    case = case_for(world, "clm_4800", "followup")
    assert case.classifier_situation == "denied:CO-22:cob_order"
    plan, _ = plan_case(world, case)
    assert plan.actions == () and plan.no_action_reason and "card" in plan.no_action_reason


def test_moreno_cob_with_other_coverage_is_tier2_no_rule(world: World) -> None:  # noqa: F811
    case = case_for(world, "clm_4800", "followup")
    assert case.patient is not None
    other = CoverageView(
        id="cov_moreno_other", patient_id=case.patient.id, payer_key="cigna", order="secondary",
        subscriber_id="X", group_no="G",
    )  # fmt: skip
    case = case.model_copy(update={"coverages": (*case.coverages, other)})
    plan, evidence = plan_case(world, case)
    a = plan.actions[0]
    assert a.action == "cob_order_change" and ACTIONS[a.action].tier == 2
    assert a.params["new_primary_coverage_id"] == "cov_moreno_other"
    d = decide(policy_ctx_for(case, evidence), a)
    assert (d.verdict, d.policy_row, d.reason) == ("propose", 6, "no rule")


@pytest.mark.parametrize(("claim_id", "agent"), [("clm_4611", "followup"), ("clm_4772", "followup")])
def test_patient_responsibility_denials_need_a_person(world: World, claim_id: str, agent: str) -> None:  # noqa: F811
    """PR-119 (annual max) and PR-1 close in Payments, not in an agent; with no reviewed plan → needs a person."""
    case = case_for(world, claim_id, agent)  # type: ignore[arg-type]
    assert case.classifier_situation == UNKNOWN and case.root_cause == "patient"
    plan, _ = plan_case(world, case)
    assert plan.actions == () and plan.no_action_reason and plan.no_action_reason.startswith("Needs a person")


@pytest.mark.xfail(
    strict=True,
    reason="gap: case._remittance_case classifies by arithmetic balance only, so Foster's PR-1 'deductible applied "
    "though met 05/12' line balances and posts; 04-seed expects a `variance` held for reprocessing",
)
def test_foster_remittance_is_a_variance(world: World) -> None:  # noqa: F811
    case = case_for(world, "rem_cigna_1028", "posting", kind="remittance")
    assert case.classifier_situation == "era:variance"


def test_paper_eob_posting_is_proposed(world: World) -> None:  # noqa: F811
    case = case_for(world, "rem_guardian_208841", "posting", kind="remittance")
    assert case.paper_eob
    plan, evidence = plan_case(world, case)
    d = decide(policy_ctx_for(case, evidence), plan.actions[0])
    assert (d.verdict, d.policy_row) == ("propose", 4)


# ---------------------------------------------------------------- the three seeded unknowns (07 §2.1)

ENVELOPES = {
    "clm_4744": {"records_request", "payer_rep_call"},
    "clm_4709": {"send_claim_agent_text", "records_request", "payer_rep_call"},
    "clm_4731": {"request_835"},
}


@pytest.mark.parametrize("claim_id", sorted(ENVELOPES))
def test_unknown_recorded_plan_within_envelope(world: World, claim_id: str) -> None:  # noqa: F811
    case = case_for(world, claim_id, "followup")
    assert case.classifier_situation == UNKNOWN
    plan, evidence = plan_case(world, case)
    assert plan.planner == "recorded_plan" and plan.situation_key == UNKNOWN and plan.situation_description
    if not plan.actions:
        assert plan.no_action_reason
        return
    assert {a.action for a in plan.actions} <= ENVELOPES[claim_id]
    for a in plan.actions:
        assert a.evidence_ids and all(e in evidence for e in a.evidence_ids)
        d = decide(policy_ctx_for(case, evidence), a)
        assert (d.verdict, d.policy_row) == ("propose", 5), "unknown never executes"


def test_hale_records_request_cites_2019_note(world: World) -> None:  # noqa: F811
    plan, evidence = plan_case(world, case_for(world, "clm_4744", "followup"))
    a = plan.actions[0]
    assert a.params["note_visit_ids"] == ["vis_0302_hale"]
    assert "note_excerpt" in {evidence.by_id()[e].kind for e in a.evidence_ids}


def test_unknown_without_recording_needs_a_person(world: World) -> None:  # noqa: F811
    case = case_for(world, "clm_4611", "followup")
    plan = asyncio.run(ScriptedPlanner().plan(case, None, None))  # type: ignore[arg-type]  # no reads attempted
    assert plan.actions == () and plan.no_action_reason == "Needs a person: Torch couldn't classify this"


# ---------------------------------------------------------------- templates

TEMPLATE_CASES = {
    ("followup", "denied:CO-119:frequency_history_conflict", "reconsideration_note"): "clm_4733",
    ("appeals", "denied:CO-50:N10:formal_appeal", "appeal_letter"): "clm_4796",
    ("appeals", "denied:CO-29:timely_filing_appeal", "appeal_letter"): "clm_3561",
}


def test_every_template_has_a_case() -> None:
    found = {(p.parent.name, p.name.split(".")[0], p.name.split(".")[1]) for p in TEMPLATE_DIR.rglob("*.tmpl")}
    expected = {(a, s.replace(":", "_"), k) for a, s, k in TEMPLATE_CASES}
    assert found == expected


@pytest.mark.parametrize(("agent", "key", "kind"), list(TEMPLATE_CASES), ids=[k[1] for k in TEMPLATE_CASES])
def test_templates_fill_every_slot(world: World, agent: str, key: str, kind: str) -> None:  # noqa: F811
    case = case_for(world, TEMPLATE_CASES[(agent, key, kind)], agent)  # type: ignore[arg-type]
    _, evidence = plan_case(world, case)
    draft = render(case, agent, key, kind, evidence)  # type: ignore[arg-type]
    assert draft.segments and draft.source == "template"
    for seg in draft.segments:
        assert "{" not in seg.text and "}" not in seg.text and "${" not in seg.text, seg.text
        assert all(e in evidence for e in seg.evidence_ids)
    guard = guard_draft(draft, evidence.by_id(), structured_facts(case), case.patient.id if case.patient else None)
    # template drafts pass the text guard on the canonical cases (attestation is a placeholder for a person)
    assert guard.ok, guard.errors
    if agent == "appeals":
        assert draft.human_must_complete, "appeal letters leave attestation for the dentist"
