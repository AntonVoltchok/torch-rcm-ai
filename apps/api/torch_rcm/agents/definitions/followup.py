"""Follow-up (07 §2): status checks, reconsiderations, prompt pay."""

from torch_rcm.agents.definitions import AgentDefinition

DEFINITION = AgentDefinition(
    kind="followup",
    label="Follow-up",
    triggers=("claim.status_check_due", "router.reconsideration", "prompt_pay.due", "manual"),
    actions=(
        "status_check",
        "payer_rep_call",
        "records_request",
        "resubmit_with_attachment",
        "reprocessing_request",
        "request_835",
        "cob_order_change",
    ),
    writes_text=("reconsideration_note",),
    outcome_metric="paid_30d",
    inbox_kinds=("approve_action",),
    live="yes",
)
