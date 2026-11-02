"""Follow-up scripts: one function per situation key (07 §4). Reads first, then actions from their evidence."""

from __future__ import annotations

from datetime import timedelta

from torch_rcm.agents.planner.base import EvidenceSet
from torch_rcm.agents.planner.scripted import Decided, ScriptedPlan, act, read, script
from torch_rcm.agents.types import CaseFile


def _claim(case: CaseFile):  # type: ignore[no-untyped-def]
    assert case.claim is not None and case.patient is not None
    return case.claim


@script("followup", "denied:CO-16:N29:pa_missing")
def pa_missing(case: CaseFile) -> ScriptedPlan:
    claim = _claim(case)
    tooth = claim.lines[0].tooth

    def decide(c: CaseFile, ev: EvidenceSet) -> Decided:
        img = ev.first("pms_record", kind="pa", tooth=tooth) or ev.first("pms_record", kind="pa")
        if img is None:
            return Decided([], "No PA of the tooth is on file in PMS imaging.", "Take or locate a PA, then resubmit.")
        return Decided(
            [
                act(
                    "resubmit_with_attachment",
                    [*ev.ids("era_line"), img.id, *ev.ids("portal_screenshot")],
                    "the payer requires a pre-operative PA for this code; the PMS has one from the date of service",
                    claim_id=claim.id,
                    image_id=str(img.data["image_id"]),
                    attachment_kind="pa",
                )
            ],
            f"Attach the {claim.dos:%m/%d} PA of #{tooth} via NEA and resubmit "
            f"in the next {c.payer.short if c.payer else ''} file.",
        )

    return ScriptedPlan(
        reads=[
            read(
                "pms_find_images",
                patient_id=claim.patient_id,
                on_or_before=claim.dos.isoformat(),
                kinds=["pa"],
                tooth=tooth,
            )
        ],
        decide=decide,
    )


@script("followup", "denied:CO-16:M127:records_request")
def records_request(case: CaseFile) -> ScriptedPlan:
    claim = _claim(case)

    def decide(c: CaseFile, ev: EvidenceSet) -> Decided:
        floor = claim.dos - timedelta(days=183)
        images = [
            e
            for e in ev.of("pms_record")
            if e.data.get("image_id") and str(e.data.get("kind")) in ("fmx", "perio_chart", "pa")
        ]
        images = [e for e in images if str(e.data.get("taken_on", "")) >= floor.isoformat()]
        return Decided(
            [
                act(
                    "records_request",
                    [*ev.ids("era_line"), *(e.id for e in images), *ev.ids("note_excerpt")],
                    "the payer asked for records; send the chart and images from the date of service",
                    claim_id=claim.id,
                    image_ids=[str(e.data["image_id"]) for e in images],
                    note_visit_ids=[claim.visit_id],
                )
            ],
            f"Send the {claim.dos:%m/%d} chart and images via NEA in reply to the records request.",
        )

    return ScriptedPlan(
        reads=[
            read("claim_get_history", claim_id=claim.id, include=["remits"]),
            read(
                "pms_find_images",
                patient_id=claim.patient_id,
                on_or_before=claim.dos.isoformat(),
                kinds=["fmx", "perio_chart", "pa"],
                tooth=None,
            ),
            read("pms_get_visit", visit_id=claim.visit_id),
        ],
        decide=decide,
    )


@script("followup", "denied:CO-119:frequency_history_conflict")
def frequency(case: CaseFile) -> ScriptedPlan:
    claim = _claim(case)

    def decide(c: CaseFile, ev: EvidenceSet) -> Decided:
        return Decided(
            [
                act(
                    "reprocessing_request",
                    [*ev.ids("era_line"), *ev.ids("prior_eob"), *ev.ids("pms_record")],
                    "the payer's tooth history conflicts with the PMS history; ask them to correct it",
                    claim_id=claim.id,
                    basis="payer_history_error",
                    attach=[*ev.ids("prior_eob")],
                )
            ],
            "Send a claim inquiry with the payer's own prior EOB so they correct the tooth history.",
        )

    return ScriptedPlan(
        reads=[read("claim_get_history", claim_id=claim.id, include=["remits", "payer_tooth_history", "prior_eobs"])],
        decide=decide,
        draft="reconsideration_note",
    )


@script("followup", "denied:CO-22:cob_order")
def cob_order(case: CaseFile) -> ScriptedPlan:
    claim = _claim(case)

    def decide(c: CaseFile, ev: EvidenceSet) -> Decided:
        others = [cov for cov in c.coverages if cov.id != claim.coverage_id]
        if not others:
            return Decided(
                [],
                f"{c.payer.short if c.payer else 'The payer'} says another plan is primary; "
                "no other coverage is on file.",
                "Ask the patient for the other plan's card and enter it in the PMS; Torch will then change the "
                "coverage order and resubmit (tier 2).",
            )
        return Decided(
            [
                act(
                    "cob_order_change",
                    [*ev.ids("era_line"), *ev.ids("pms_record")],
                    "the payer says the other plan is primary",
                    patient_id=claim.patient_id,
                    new_primary_coverage_id=others[0].id,
                )
            ],
            "Make the other plan primary in the PMS and resubmit to it.",
        )

    return ScriptedPlan(
        reads=[
            read("pms_get_coverage", patient_id=claim.patient_id),
            read("claim_get_history", claim_id=claim.id, include=["remits"]),
        ],
        decide=decide,
    )


@script("followup", "pending:status_due")
def status_due(case: CaseFile) -> ScriptedPlan:
    claim = _claim(case)
    age = (case.now.date() - claim.sent_at.date()).days if claim.sent_at else 0

    def decide(c: CaseFile, ev: EvidenceSet) -> Decided:
        return Decided(
            [act("status_check", [], f"day {age} status check", claim_id=claim.id, channel="portal")],
            f"Day-{age} status check on the {c.payer.short if c.payer else 'payer'} portal.",
        )

    return ScriptedPlan(reads=[], decide=decide)


@script("followup", "pending:prompt_pay_eligible")
def prompt_pay(case: CaseFile) -> ScriptedPlan:
    claim = _claim(case)
    age = (case.now.date() - claim.sent_at.date()).days if claim.sent_at else 0

    def decide(c: CaseFile, ev: EvidenceSet) -> Decided:
        return Decided(
            [
                act(
                    "reprocessing_request",
                    [*ev.ids("portal_screenshot"), *ev.ids("policy_clause")],
                    "clean claim past the prompt-pay window on an insured plan",
                    claim_id=claim.id,
                    basis="ny_prompt_pay",
                )
            ],
            f"Clean claim, {age} days, no request for information. Send the NY prompt-pay reprocessing request.",
        )

    return ScriptedPlan(
        reads=[
            read(
                "payer_rulebook_lookup",
                payer_key=claim.payer_key,
                topic="prompt_pay",
                cdt_codes=[line.cdt for line in claim.lines],
            )
        ],
        decide=decide,
    )


@script("followup", "pending:adjudicated_no_835")
def no_835(case: CaseFile) -> ScriptedPlan:
    claim = _claim(case)

    def decide(c: CaseFile, ev: EvidenceSet) -> Decided:
        return Decided(
            [
                act(
                    "request_835",
                    ev.ids("portal_screenshot"),
                    "adjudicated with no remittance on file",
                    claim_id=claim.id,
                )
            ],
            "The payer shows the claim adjudicated; request the 835 so it can be posted.",
        )

    return ScriptedPlan(reads=[read("claim_get_history", claim_id=claim.id, include=["correspondence"])], decide=decide)
