"""Eligibility (07 §2): always scripted; owner-authored rules only, never learned."""

from torch.agents.definitions import AgentDefinition

DEFINITION = AgentDefinition(
    kind="eligibility",
    label="Eligibility",
    triggers=("eligibility.sweep@17:00 next business day", "eligibility.recheck@07:00", "manual"),
    actions=("eligibility_check", "update_pms_benefits"),
    writes_text=("internal_flag",),
    outcome_metric="none",
    inbox_kinds=("eligibility_flag", "approve_action"),
    live="no",
)
