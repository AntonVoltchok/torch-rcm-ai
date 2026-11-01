"""Claims scripts: clean sends, and the subscriber-id reject. The value for a demographic fix must equal a
field on file (PMS or a 271 the payer returned) — never text the agent typed (policy row 1)."""

from __future__ import annotations

from torch_rcm.agents.planner.base import EvidenceSet
from torch_rcm.agents.planner.scripted import Decided, ScriptedPlan, act, read, script
from torch_rcm.agents.types import CaseFile


@script("claims", "checkout:clean")
def clean(case: CaseFile) -> ScriptedPlan:
    assert case.claim is not None
    claim = case.claim

    def decide(c: CaseFile, ev: EvidenceSet) -> Decided:
        return Decided(
            [act("send_claim_pms_codes", [], "readiness checks pass", claim_id=claim.id)],
            "Send with the PMS codes and the rule-named attachments in the next payer file.",
        )

    return ScriptedPlan(reads=[], decide=decide)


@script("claims", "rejected:A7:164:subscriber_id")
def subscriber_id(case: CaseFile) -> ScriptedPlan:
    assert case.claim is not None
    claim = case.claim

    def decide(c: CaseFile, ev: EvidenceSet) -> Decided:
        verified = c.expected_values.get("271.subscriber_id")
        on_file = c.expected_values.get("pms.subscriber_id")
        if isinstance(verified, str) and verified != on_file:
            return Decided(
                [
                    act(
                        "fix_demographics_resend",
                        [*ev.ids("portal_screenshot"), *ev.ids("pms_record")],
                        "the 271 has a different subscriber id than the PMS",
                        claim_id=claim.id,
                        field="subscriber_id",
                        value=verified,
                        source="271",
                    )
                ],
                f"Subscriber ID not found; the 271 has {verified}. Update the PMS and resend in the next file.",
            )
        return Decided(
            [
                act(
                    "hold_claim",
                    ev.ids("pms_record"),
                    "no verified id to resend",
                    claim_id=claim.id,
                    reason="subscriber_id_invalid",
                )
            ],
            "Hold the claim until the front desk verifies the subscriber id from the card.",
        )

    return ScriptedPlan(
        reads=[
            read("pms_get_coverage", patient_id=claim.patient_id),
            read("claim_get_history", claim_id=claim.id, include=["acks"]),
        ],
        decide=decide,
    )
