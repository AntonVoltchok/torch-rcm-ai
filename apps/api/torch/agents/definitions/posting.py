"""Posting (07 §2): always scripted; balanced lines under an owner-signed tier-2 rule."""

from torch.agents.definitions import AgentDefinition

DEFINITION = AgentDefinition(
    kind="posting",
    label="Posting",
    triggers=("era.arrived", "paper_eob.received", "deposit.unmatched"),
    actions=("post_era_line", "patient_transfer", "mechanical_refund", "request_835", "reprocessing_request"),
    writes_text=("internal_variance_note",),
    outcome_metric="balanced",
    inbox_kinds=("variance", "approve_action"),
    live="no",
    may_not=("auto-post a paper EOB", "write anything off"),
)
