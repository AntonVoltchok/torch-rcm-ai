"""Claims (07 §2): readiness checks, send / send with narrative / hold."""

from torch_rcm.agents.definitions import AgentDefinition

DEFINITION = AgentDefinition(
    kind="claims",
    label="Claims",
    triggers=("visit.checked_out", "vyne.277ca.A7", "hold.age"),
    actions=(
        "send_claim_pms_codes",
        "fix_demographics_resend",
        "send_claim_agent_text",
        "corrected_claim",
        "cob_order_change",
        "hold_claim",
    ),
    writes_text=("claim_narrative", "remarks"),
    outcome_metric="accepted",
    inbox_kinds=("review_draft", "approve_action"),
    live="yes",
    may_not=("nudge clinical documentation", "hold for a reason outside the HoldReason enum"),
)
