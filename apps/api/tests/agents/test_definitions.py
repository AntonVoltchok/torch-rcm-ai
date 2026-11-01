"""Agent definitions (07 §2) agree with the catalog and can never propose a tier-3 action to run."""

from __future__ import annotations

import pytest

from torch.agents.catalog.actions import ACTIONS, AGENT_ACTIONS
from torch.agents.definitions import AgentDefinition, DefinitionError, assert_definition, registry
from torch.agents.tools.registry import READS, ToolRegistry
from torch.agents.types import AGENT_KINDS


def test_registry_has_all_five() -> None:
    defs = registry()
    assert tuple(defs) == AGENT_KINDS
    assert all(d.kind == k for k, d in defs.items())


def test_actions_exist_with_catalog_tiers_and_no_tier3() -> None:
    for d in registry().values():
        for name, tier in d.proposable.items():
            assert name in ACTIONS and ACTIONS[name].tier == tier
            assert tier != 3, f"{d.kind} can propose tier-3 {name}"
        assert set(d.actions) | set(d.prepares_only) == set(AGENT_ACTIONS[d.kind])
        assert all(ACTIONS[a].tier == 3 for a in d.prepares_only)


def test_reads_come_from_tool_registry() -> None:
    for d in registry().values():
        assert d.reads == ToolRegistry.allowed(d.kind)
        assert all(r in READS for r in d.reads)
    assert registry()["appeals"].reads, "07 §2: Appeals reads all claim reads"


def test_spec_rows() -> None:
    defs = registry()
    assert {k: d.outcome_metric for k, d in defs.items()} == {
        "eligibility": "none", "claims": "accepted", "followup": "paid_30d", "appeals": "none", "posting": "balanced",
    }  # fmt: skip
    assert {k: d.live for k, d in defs.items()} == {
        "eligibility": "no", "claims": "yes", "followup": "yes", "appeals": "drafting_only", "posting": "no",
    }  # fmt: skip
    assert defs["appeals"].prepares_only == ("formal_appeal",) and defs["appeals"].actions == ()
    assert "eligibility_flag" in defs["eligibility"].inbox_kinds and "variance" in defs["posting"].inbox_kinds
    assert all(d.failure.max_run_failed_items == 1 for d in defs.values())


def test_definition_proposing_tier3_is_rejected() -> None:
    bad = AgentDefinition(
        kind="appeals",
        label="x",
        triggers=(),
        actions=("formal_appeal",),
        writes_text=(),
        outcome_metric="none",
        inbox_kinds=(),
        live="no",
    )
    with pytest.raises(DefinitionError, match="tier-3"):
        assert_definition(bad)
    unknown = AgentDefinition(
        kind="followup", label="x", triggers=(), actions=("void_everything",), writes_text=(),
        outcome_metric="none", inbox_kinds=(), live="no",
    )  # fmt: skip
    with pytest.raises(DefinitionError, match="unknown action"):
        assert_definition(unknown)
