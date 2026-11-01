"""Appeals scripts. A formal appeal is tier 3: the agent prepares the packet and the letter draft; the
rendering dentist (or the owner) signs and files. Policy row 2 keeps every one of these a proposal."""

from __future__ import annotations

from torch_rcm.agents.planner.base import EvidenceSet
from torch_rcm.agents.planner.scripted import Decided, ScriptedPlan, act, read, script
from torch_rcm.agents.types import CaseFile


@script("appeals", "denied:CO-50:N10:formal_appeal")
def medical_necessity(case: CaseFile) -> ScriptedPlan:
    assert case.claim is not None
    claim = case.claim

    def decide(c: CaseFile, ev: EvidenceSet) -> Decided:
        return Decided(
            [
                act(
                    "formal_appeal",
                    [*ev.ids("era_line"), *ev.ids("note_excerpt"), *ev.ids("pms_record"), *ev.ids("portal_screenshot")],
                    "consultant denied SRP as not medically necessary; the chart is the evidence",
                    claim_id=claim.id,
                    level=1,
                )
            ],
            "Formal appeal with the perio chart and the signed note; the rendering dentist attests and signs.",
        )

    return ScriptedPlan(
        reads=[
            read("claim_get_history", claim_id=claim.id, include=["remits", "correspondence"]),
            read("pms_get_visit", visit_id=claim.visit_id),
            read(
                "pms_find_images",
                patient_id=claim.patient_id,
                on_or_before=claim.dos.isoformat(),
                kinds=["perio_chart"],
                tooth=None,
            ),
        ],
        decide=decide,
        draft="appeal_letter",
    )


@script("appeals", "denied:CO-29:timely_filing_appeal")
def timely_filing(case: CaseFile) -> ScriptedPlan:
    assert case.claim is not None
    claim = case.claim

    def decide(c: CaseFile, ev: EvidenceSet) -> Decided:
        return Decided(
            [
                act(
                    "formal_appeal",
                    [*ev.ids("era_line"), *ev.ids("pms_record")],
                    "the payer's own 277CA proves timely receipt",
                    claim_id=claim.id,
                    level=1,
                )
            ],
            "Timely-filing appeal with the payer's 277CA as proof of receipt; if upheld it is a non-contractual "
            "write-off and the patient cannot be billed.",
        )

    return ScriptedPlan(
        reads=[read("claim_get_history", claim_id=claim.id, include=["acks", "remits"])],
        decide=decide,
        draft="appeal_letter",
    )
