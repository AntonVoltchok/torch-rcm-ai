"""CaseBuilder: everything code knows about a run's subject, computed before any planner runs.

Principle: the model proposes; code gates and executes. Situation key, root cause, deadlines, expected
param values and scope come from structured data here and are never model outputs. The case file is the
first user message of a live conversation (as CASE FACTS) and the input of every script.
"""

from __future__ import annotations

import re
from datetime import datetime

from torch_rcm.agents.catalog.situations import classify, deadlines, item_type_for, root_cause
from torch_rcm.agents.tools.adapters import StoreDomain
from torch_rcm.agents.types import UNKNOWN, AgentKind, CaseFile, Evidence, JsonValue, RootCause, Subject

_SUBSCRIBER = re.compile(r"subscriber id\s+([A-Z0-9]+)", re.I)


def build_case(
    dom: StoreDomain,
    *,
    run_id: str,
    agent: AgentKind,
    subject: Subject,
    now: datetime,
    trigger_kind: str = "manual",
) -> CaseFile:
    practice = dom.practice()
    rules = tuple(dom.rules())
    if subject.kind == "remittance":
        return _remittance_case(dom, run_id, agent, subject, now, trigger_kind, practice.id, rules)
    if subject.kind != "claim":
        situation = classify(agent, None, (), (), now.date())
        patient_id = dom.appointment_patient(subject.id) if subject.kind == "appointment" else None
        return CaseFile(
            run_id=run_id,
            practice_id=practice.id,
            agent=agent,
            subject=subject,
            now=now,
            patient=dom.patient(patient_id) if patient_id else None,
            coverages=tuple(dom.coverages(patient_id)) if patient_id else (),
            rules_snapshot=rules,
            classifier_situation=situation,
            item_type=item_type_for(agent, situation),
            related_ids=tuple(x for x in (subject.id, patient_id) if x),
            trigger_kind=trigger_kind,
        )
    claim = dom.claim_view(subject.id)
    entity = dom.claim_entity(subject.id)
    coverages = tuple(dom.coverages(claim.patient_id))
    payer = dom.payer(claim.payer_key)
    payer_rules = tuple(dom.payer_rules(claim.payer_key))
    provenance = dom.provenance(claim.id)
    self_funded = any(c.plan_type == "self_funded_erisa" for c in coverages if c.id == claim.coverage_id)
    situation = classify(
        agent, claim, coverages, payer_rules, now.date(), trigger_kind=trigger_kind, self_funded=self_funded
    )
    computed: RootCause = root_cause(claim, payer_rules, provenance)
    stored = dom.stored_root_cause(claim.id)
    cause: RootCause = (
        "ours" if "ours" in (computed, stored) else (computed if computed != "unknown" else stored or "unknown")
    )  # type: ignore[assignment]
    evidence = tuple(dom.on_file_evidence(claim.id))
    prior = tuple(dom.prior_procedures(claim.patient_id, claim.dos))
    related = (
        claim.visit_id,
        *{p.visit_id for p in prior},
        *dom.image_ids(claim.patient_id),
        *dom.remittance_ids(claim.id),
    )
    return CaseFile(
        run_id=run_id,
        practice_id=practice.id,
        agent=agent,
        subject=subject,
        now=now,
        claim=claim,
        patient=dom.patient(claim.patient_id),
        coverages=coverages,
        payer=payer,
        denial=claim.denial,
        root_cause=cause,
        deadlines=deadlines(claim, payer),
        payer_rules=payer_rules,
        rules_snapshot=rules,
        evidence=evidence,
        classifier_situation=situation,
        item_type=item_type_for(agent, situation),
        related_ids=tuple(sorted(set(related))),
        prior_procedures=prior,
        trigger_kind=trigger_kind,
        expected_values=_expected_values(claim.coverage_id, coverages, evidence, entity),
        rendering_dentist_id=claim.rendering_provider_id,
        self_funded=self_funded,
        cents=claim.billed_cents,
    )


def _remittance_case(
    dom: StoreDomain,
    run_id: str,
    agent: AgentKind,
    subject: Subject,
    now: datetime,
    trigger_kind: str,
    practice_id: str,
    rules: tuple,  # type: ignore[type-arg]
) -> CaseFile:
    remit = dom.remittance(subject.id)
    balanced = all(
        line.billed == line.paid + sum(a.cents for a in line.adj) + line.patient_cents for line in remit.lines
    )
    reasons = tuple(_benefit_variances(dom, remit))
    situation = "era:balanced" if balanced and not reasons else "era:variance"
    claim_ids = sorted({line.claim_id for line in remit.lines if line.claim_id})
    return CaseFile(
        run_id=run_id,
        practice_id=practice_id,
        agent=agent,
        subject=subject,
        now=now,
        payer=dom.payer(remit.payer_key.value),
        rules_snapshot=rules,
        classifier_situation=situation,
        item_type=situation,
        related_ids=(remit.id, *claim_ids),
        trigger_kind=trigger_kind,
        paper_eob=remit.kind.value == "paper_eob",
        variance_reasons=reasons,
        cents=remit.amount_cents,
    )


def _benefit_variances(dom: StoreDomain, remit: object) -> list[str]:
    """Lines that balance arithmetically but disagree with tracked benefits: a PR-1 (deductible) applied to a
    claim whose coverage the PMS tracks as having met its deductible before the date of service. Structured
    fields only (`PlanBenefits.deductible_met_cents` / `deductible_met_on`), never the EOB's text."""
    out: list[str] = []
    for line in getattr(remit, "lines", ()):
        pr1 = sum(a.cents for a in line.patient_adj if a.group.value == "PR" and a.code == "1")
        if not pr1 or not line.claim_id:
            continue
        claim = dom.claim_entity(line.claim_id)
        cov = dom.coverage_entity(claim.coverage_id)
        plan = cov.plan if cov is not None else None
        if plan is None or plan.deductible_met_on is None:
            continue
        if plan.deductible_met_cents >= plan.deductible_cents and plan.deductible_met_on < claim.dos:
            out.append(
                f"#{claim.number} {line.cdt}: deductible applied though met {plan.deductible_met_on:%m/%d}"
                f" (PR-1 ${pr1 / 100:,.2f})"
            )
    return out


def _expected_values(
    coverage_id: str, coverages: tuple, evidence: tuple[Evidence, ...], entity: object
) -> dict[str, JsonValue]:  # type: ignore[type-arg]
    """Values a demographic or amount param must equal (07 §5.1 row 1). Sourced from the PMS, a 271 on file
    or the claim's own adjudicated numbers — never from model text."""
    out: dict[str, JsonValue] = {}
    cov = next((c for c in coverages if c.id == coverage_id), None)
    if cov is not None:
        out["pms.subscriber_id"] = cov.subscriber_id
        out["pms.group_no"] = cov.group_no
    for ev in evidence:
        if "271" in ev.title or (ev.reference or "").startswith("271"):
            m = _SUBSCRIBER.search(ev.excerpt)
            if m:
                out["271.subscriber_id"] = m.group(1)
    patient_resp = getattr(entity, "patient_resp_cents", None)
    billed = getattr(entity, "billed_cents", 0)
    paid = getattr(entity, "paid_cents", None) or 0
    if patient_resp is not None:
        # a write-off is the billed amount the payer did not pay and the patient does not owe
        out["amount.write_off"] = billed - paid - patient_resp
    return out


def is_unknown(case: CaseFile) -> bool:
    return case.classifier_situation == UNKNOWN
