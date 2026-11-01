"""Job kinds. World kinds are handled here (torch_rcm.scheduler.handlers); agent kinds are enqueued by the world and
the API and handled by torch_rcm.agents, which registers into torch_rcm.scheduler.registry."""

from __future__ import annotations

# world (handled in this package)
FILE_DEPART = "world.file_depart"
ACK_CLEARINGHOUSE = "world.ack_clearinghouse"
ACK_PAYER = "world.ack_payer"
PAYER_IN_PROCESS = "world.payer_in_process"
ERA_ARRIVE = "world.era_arrive"
VISIT_CHECKOUT = "world.visit_checkout"
HOLD_AGE = "hold.age"
SNOOZE_WAKE = "inbox.snooze_wake"

# agents (enqueued here, handled by torch_rcm.agents)
RUN_START = "run.start"  # {run_id}: approval / manual triage runs created by the API
RUN_EXECUTE = "run.execute"  # agents-internal
CLAIM_REJECTED = "claim.rejected"  # {claim_id, ack_id, code}
ERA_ARRIVED = "era.arrived"  # {remittance_id}
STATUS_CHECK_DUE = "claim.status_check_due"  # {claim_id, n}
VISIT_CHECKED_OUT = "visit.checked_out"  # {visit_id, appointment_id}
HOLD_ESCALATE = "hold.escalate"  # {hold_id, threshold_days}
ELIGIBILITY_SWEEP = "eligibility.sweep"  # {for_date}
PROMPT_PAY_DUE = "prompt_pay.due"  # {claim_id}
TRIAGE = "triage"  # {claim_id, agent?, parent_run_id?}: agent-started triage (overnight 835 denials, retries)

AGENT_KINDS = frozenset(
    {
        RUN_START,
        RUN_EXECUTE,
        CLAIM_REJECTED,
        ERA_ARRIVED,
        STATUS_CHECK_DUE,
        VISIT_CHECKED_OUT,
        HOLD_ESCALATE,
        ELIGIBILITY_SWEEP,
        PROMPT_PAY_DUE,
        TRIAGE,
    }
)

#: Lower runs first at the same instant: world facts land before the agent runs that react to them.
PRIORITY = {
    FILE_DEPART: 10,
    ACK_CLEARINGHOUSE: 15,
    ACK_PAYER: 20,
    PAYER_IN_PROCESS: 25,
    ERA_ARRIVE: 30,
    VISIT_CHECKOUT: 35,
    SNOOZE_WAKE: 40,
    HOLD_AGE: 45,
    RUN_START: 50,
    RUN_EXECUTE: 50,
}
