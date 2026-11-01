"""Appeals (07 §2): prepares formal appeals; never files (tier 3 is human only)."""

from torch_rcm.agents.definitions import AgentDefinition

DEFINITION = AgentDefinition(
    kind="appeals",
    label="Appeals",
    triggers=("router.formal_appeal", "appeal_window.t_minus_14d"),
    actions=(),
    prepares_only=("formal_appeal",),
    writes_text=("appeal_letter",),
    outcome_metric="none",  # "overturned" is tracked in Cash only; tier 3 never learns
    inbox_kinds=("review_draft",),
    live="drafting_only",
    may_not=("file an appeal", "fill attestation placeholders"),
)
