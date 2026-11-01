"""Catalog closure: every action has a tier decision and a recipe (tier 1/2) or none (tier 3); every situation
key has a script or is `unknown`; no recipe step performs a tier-3 action."""

from __future__ import annotations

from torch_rcm.agents.catalog.actions import ACTIONS, AGENT_ACTIONS, TIER3_ACTIONS, TIER3_ROLES
from torch_rcm.agents.catalog.recipes import RECIPES, recipe_for
from torch_rcm.agents.catalog.situations import SITUATIONS, situation_keys
from torch_rcm.agents.planner.scripted import SCRIPTS, has_script
from torch_rcm.agents.types import AGENT_KINDS, UNKNOWN

SPEC_TIERS = {  # 07 §2 table + §5 (tier 3 human-only)
    "eligibility_check": 1, "update_pms_benefits": 2, "send_claim_pms_codes": 1, "fix_demographics_resend": 1,
    "send_claim_agent_text": 2, "corrected_claim": 2, "cob_order_change": 2, "hold_claim": None,
    "status_check": 1, "payer_rep_call": 1, "records_request": 1, "resubmit_with_attachment": 1,
    "reprocessing_request": 1, "request_835": 1, "post_era_line": 2, "patient_transfer": 2,
    "mechanical_refund": 2, "formal_appeal": 3, "write_off": 3, "void_claim": 3,
}  # fmt: skip


def test_tiers_match_spec() -> None:
    for name, tier in SPEC_TIERS.items():
        assert ACTIONS[name].tier == tier, name


def test_every_action_has_a_recipe_unless_tier3() -> None:
    for name, spec in ACTIONS.items():
        assert spec.tier in (1, 2, 3, None)
        if spec.tier == 3:
            assert recipe_for(name) is None, f"tier-3 {name} must have no recipe"
            assert TIER3_ROLES[name], name
        else:
            assert recipe_for(name), f"{name} has no recipe"


def test_recipes_never_include_a_tier3_action() -> None:
    for name, steps in RECIPES.items():
        assert name not in TIER3_ACTIONS
        for step in steps:
            text = f"{step.name} {step.op}"
            assert not any(t in text for t in TIER3_ACTIONS), f"{name}: step {step.name} ({step.op})"
            assert not any(w in step.op for w in ("void", "write_off", "writeoff", "collections", "waiver")), step.op


def test_agent_catalogs_reference_real_actions() -> None:
    assert set(AGENT_ACTIONS) == set(AGENT_KINDS)
    for agent, actions in AGENT_ACTIONS.items():
        assert actions and all(a in ACTIONS for a in actions), agent
        t3 = [a for a in actions if ACTIONS[a].tier == 3]
        assert agent == "appeals" or not t3, f"{agent} lists tier-3 {t3}"


def test_text_actions_are_tier2_or_3() -> None:
    for name, spec in ACTIONS.items():
        if spec.carries_text:
            assert spec.tier in (2, 3), name


def test_every_situation_has_a_script_or_is_unknown() -> None:
    for agent, situations in SITUATIONS.items():
        keys = situation_keys(agent)
        assert keys[-1] == UNKNOWN and UNKNOWN not in keys[:-1]
        for s in situations:
            assert has_script(agent, s.key), f"{agent}: {s.key} has no script"
    for agent, key in SCRIPTS:
        assert key in situation_keys(agent), f"script for unregistered situation {agent} {key}"


def test_situation_keys_unique_per_agent() -> None:
    for agent, situations in SITUATIONS.items():
        keys = [s.key for s in situations]
        assert len(keys) == len(set(keys)), agent
