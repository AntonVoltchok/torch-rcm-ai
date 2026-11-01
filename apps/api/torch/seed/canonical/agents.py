"""Agent-side seed state: the 19 rules and their change log, proposals, this week's runs (53 decisions), the 12
open inbox items with their evidence and world-call provenance, appointments and estimates."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from torch.domain.entities import (
    Appointment,
    AuditEvent,
    Claim,
    Coverage,
    Estimate,
    Evidence,
    InboxItem,
    Patient,
    PlannedProcedure,
    Remittance,
    Rule,
    RuleChange,
    RuleProposal,
    Run,
    RunStep,
    SavedView,
    WorldCallLog,
)
from torch.domain.enums import (
    AgentKind,
    ClaimStatus,
    EligibilityStatus,
    EvidenceKind,
    GatheredBy,
    InboxItemKind,
    InboxItemState,
    OutcomeMetric,
    PayerKey,
    PlannerKind,
    PolicyVerdict,
    ProposalState,
    ReversesIn,
    Role,
    RuleAction,
    RuleMode,
    RunStatus,
    RunTrigger,
    StepStatus,
    Tier,
    VerifiedVia,
    tier_of,
)
from torch.domain.values import BaseRate, Confidence, ProposalEvidence, ProposedAction, RuleScope
from torch.seed import targets as T
from torch.seed.builder import Builder, dt
from torch.seed.canonical.people import PRV_LEE, PRV_MORGAN, USR_DANA, USR_LEE, USR_MORGAN, USR_TASHA
from torch.seed.canonical.pinned import Pinned

A = RuleAction
AG = AgentKind
TODAY = T.TODAY
DELTA_PA_SLICE = "denied:CO-16:N29:pa_missing"

ACTION_LABEL: dict[RuleAction, str] = {
    A.STATUS_CHECK: "Status check",
    A.PAYER_REP_CALL: "Payer rep call",
    A.RECORDS_REQUEST: "Records request via NEA",
    A.RESUBMIT_WITH_ATTACHMENT: "Resubmit with attachment",
    A.REPROCESSING_REQUEST: "Reprocessing request",
    A.REQUEST_835: "Request 835",
    A.SEND_CLAIM_PMS_CODES: "Send claim · PMS codes",
    A.FIX_DEMOGRAPHICS_RESEND: "Fix demographics, resend",
    A.ELIGIBILITY_CHECK: "Eligibility check",
    A.POST_ERA_LINE: "Post ERA line",
    A.UPDATE_PMS_BENEFITS: "Update PMS benefits",
    A.SEND_CLAIM_AGENT_TEXT: "Send claim · agent text",
    A.CORRECTED_CLAIM: "Corrected claim (frequency 7)",
    A.PATIENT_TRANSFER: "Patient-responsibility transfer",
    A.SEND_STATEMENT: "Send statement",
    A.MECHANICAL_REFUND: "Mechanical refund to original tender",
    A.COB_ORDER_CHANGE: "Coverage-order change",
    A.WRITE_OFF: "Write-off",
    A.FORMAL_APPEAL: "Formal appeal",
    A.VOID_CLAIM: "Void claim (frequency 8)",
    A.DISCRETIONARY_REFUND: "Discretionary refund",
    A.COLLECTIONS_REFERRAL: "Collections referral",
    A.WAIVER: "Waiver",
}
AGENT_LABEL = {
    AG.ELIGIBILITY: "Eligibility",
    AG.CLAIMS: "Claims",
    AG.FOLLOWUP: "Follow-up",
    AG.APPEALS: "Appeals",
    AG.POSTING: "Posting",
}

#: Recipes (step names) per action, shared with torch.agents (07-agents §1: approval runs skip planning).
RECIPES: dict[RuleAction, tuple[tuple[str, str], ...]] = {
    A.RESUBMIT_WITH_ATTACHMENT: (
        ("fetch_image", "Fetch PA from PMS imaging"),
        ("nea_upload", "Upload to NEA"),
        ("write_remarks", "Write NEA# to remarks"),
        ("queue_for_file", "Queue for the next payer file"),
    ),
    A.RECORDS_REQUEST: (
        ("fetch_records", "Fetch chart and images from the PMS"),
        ("nea_upload", "Upload to NEA"),
        ("payer_submit", "Send records to the payer"),
    ),
    A.REPROCESSING_REQUEST: (
        ("render_request", "Fill the payer's reprocessing form"),
        ("payer_submit", "Submit to the payer"),
    ),
    A.SEND_CLAIM_PMS_CODES: (
        ("readiness", "Run 13 readiness checks"),
        ("queue_for_file", "Queue for the next payer file"),
    ),
    A.SEND_CLAIM_AGENT_TEXT: (
        ("readiness", "Run 13 readiness checks"),
        ("draft_text", "Draft narrative (text guard)"),
        ("queue_for_file", "Queue for the next payer file"),
    ),
    A.FIX_DEMOGRAPHICS_RESEND: (
        ("compare_pms", "Compare claim with the PMS record"),
        ("patch_claim", "Correct the field to the PMS value"),
        ("queue_for_file", "Queue for the next payer file"),
    ),
    A.POST_ERA_LINE: (
        ("match_lines", "Match remit lines to claim lines"),
        ("balance_check", "Check balance and patient share"),
        ("pms_post", "Post to the PMS ledger"),
    ),
    A.UPDATE_PMS_BENEFITS: (
        ("eligibility_check", "Portal / 271 eligibility"),
        ("diff_pms", "Compare with PMS benefits"),
        ("pms_update", "Update PMS benefits"),
    ),
    A.STATUS_CHECK: (("payer_contact", "Check status (portal → IVR → 276)"),),
    A.PAYER_REP_CALL: (("payer_contact", "Call the payer (bounded asks)"),),
}


def _steps(
    start: datetime,
    names: list[tuple[str, str]],
    *,
    verdict: PolicyVerdict,
    skipped: bool = False,
    outputs: dict[str, str] | None = None,
    evidence: dict[str, list[str]] | None = None,
) -> list[RunStep]:
    outputs = outputs or {}
    evidence = evidence or {}
    steps: list[RunStep] = []
    t = start
    for idx, (name, label) in enumerate(names):
        nxt = t + timedelta(seconds=2 + idx % 3)
        status = StepStatus.SKIPPED if skipped and name.startswith("act:") else StepStatus.OK
        steps.append(
            RunStep(
                idx=idx,
                name=name,
                label=label,
                status=status,
                started_at=t,
                finished_at=nxt,
                tool=name.split(":")[0],
                output_summary=outputs.get(name, "ok"),
                policy_verdict=verdict if name == "decide" else None,
                evidence_ids=evidence.get(name, []),
            )
        )
        t = nxt
    return steps


@dataclass
class Ctx:
    b: Builder
    pinned: Pinned

    @property
    def claims(self) -> dict[int, Claim]:
        return {c.number: c for c in self.b.w.of(Claim)}

    def patient(self, pid: str) -> Patient:
        return self.b.w.index(Patient)[pid]


class AgentSeed:
    def __init__(self, b: Builder, pinned: Pinned) -> None:
        self.b = b
        self.pinned = pinned
        self.claims = {c.number: c for c in b.w.of(Claim)}
        self.patients = b.w.index(Patient)
        self._ev = 0
        self._wc = 0
        self._run = 0

    def build(self) -> None:
        self.rules()
        self.proposals()
        self.saved_views()
        self.eligibility()
        self.inbox()
        self.ran_without_review()
        self.routine_runs()
        self.audit()

    # ── rules ──────────────────────────────────────────────────────────────────────────────────────────────

    def rule(
        self,
        rid: str,
        label: str,
        tier: Tier,
        agent: AgentKind,
        action: RuleAction,
        mode: RuleMode,
        **kw: Any,
    ) -> Rule:
        r = Rule(
            id=rid,
            label=label,
            tier=tier,
            agent=agent,
            action=action,
            mode=mode,
            requires_owner_signoff=tier is Tier.TWO,
            changed_by=kw.pop("changed_by", USR_DANA),
            changed_at=kw.pop("changed_at", dt(date(2026, 6, 3), "09:00")),
            **kw,
        )
        self.b.w.add(r)
        return r

    def rules(self) -> None:
        signed = {"signed_by": USR_MORGAN, "changed_by": USR_MORGAN}
        delta = PayerKey.DELTA_NY
        rows: list[tuple[str, str, Tier, AgentKind, RuleAction, RuleMode, dict[str, Any]]] = [
            (
                "rule_t1_status_check",
                "Status check · day 30, then every 15 d",
                Tier.ONE,
                AG.FOLLOWUP,
                A.STATUS_CHECK,
                RuleMode.ASK,
                {
                    "outcome_metric": OutcomeMetric.NONE,
                    "base_rate": BaseRate(n=142, k=139),
                    "description": "Portal → IVR → 276 status inquiry on accepted claims.",
                },
            ),
            (
                "rule_t1_records_request",
                "Payer records request → send via NEA",
                Tier.ONE,
                AG.FOLLOWUP,
                A.RECORDS_REQUEST,
                RuleMode.AUTO,
                {
                    "scope": RuleScope(max_cents=200_000),
                    "confidence_floor": 0.9,
                    "outcome_metric": OutcomeMetric.PAID_30D,
                    "base_rate": BaseRate(n=97, k=91),
                    "changed_at": dt(date(2026, 5, 22), "10:00"),
                },
            ),
            (
                "rule_t1_delta_pa",
                "Missing PA x-ray (CO-16 · N29) → attach, resubmit",
                Tier.ONE,
                AG.FOLLOWUP,
                A.RESUBMIT_WITH_ATTACHMENT,
                RuleMode.ASK,
                {
                    "scope": RuleScope(payer_key=delta, item_type=DELTA_PA_SLICE),
                    "outcome_metric": OutcomeMetric.PAID_30D,
                    "base_rate": BaseRate(n=25, k=23),
                    "changed_at": dt(date(2026, 10, 26), "10:02"),
                },
            ),
            (
                "rule_t1_reprocessing",
                "Prompt-pay reprocessing request (NY §3224-a)",
                Tier.ONE,
                AG.FOLLOWUP,
                A.REPROCESSING_REQUEST,
                RuleMode.ASK,
                {
                    "outcome_metric": OutcomeMetric.PAID_30D,
                    "base_rate": BaseRate(n=25, k=22),
                    "changed_at": dt(date(2026, 7, 1), "09:00"),
                },
            ),
            (
                "rule_t1_request_835",
                "Request 835 for an unmatched deposit",
                Tier.ONE,
                AG.POSTING,
                A.REQUEST_835,
                RuleMode.AUTO,
                {"outcome_metric": OutcomeMetric.NONE, "base_rate": BaseRate(n=14, k=14)},
            ),
            (
                "rule_t1_send_claim",
                "Send claim · PMS codes and rule-named attachments",
                Tier.ONE,
                AG.CLAIMS,
                A.SEND_CLAIM_PMS_CODES,
                RuleMode.AUTO,
                {
                    "outcome_metric": OutcomeMetric.ACCEPTED,
                    "reverses_in": ReversesIn.UNTIL_FILE_LEAVES,
                    "base_rate": BaseRate(n=388, k=376),
                    "version": 3,
                    "changed_at": dt(date(2026, 10, 26), "10:02"),
                },
            ),
            (
                "rule_t1_fix_demographics",
                "Clearinghouse reject → fix demographics to the PMS value, resend",
                Tier.ONE,
                AG.CLAIMS,
                A.FIX_DEMOGRAPHICS_RESEND,
                RuleMode.AUTO,
                {
                    "scope": RuleScope(max_cents=200_000),
                    "confidence_floor": 0.9,
                    "outcome_metric": OutcomeMetric.ACCEPTED,
                    "reverses_in": ReversesIn.UNTIL_FILE_LEAVES,
                    "base_rate": BaseRate(n=19, k=16),
                    "changed_at": dt(date(2026, 5, 14), "11:00"),
                },
            ),
            (
                "rule_t1_eligibility_check",
                "Eligibility check · portal → 271 → IVR",
                Tier.ONE,
                AG.ELIGIBILITY,
                A.ELIGIBILITY_CHECK,
                RuleMode.AUTO,
                {"outcome_metric": OutcomeMetric.NONE},
            ),
            (
                "rule_t1_payer_rep_call",
                "Payer rep call (bounded asks)",
                Tier.ONE,
                AG.FOLLOWUP,
                A.PAYER_REP_CALL,
                RuleMode.AUTO,
                {
                    "outcome_metric": OutcomeMetric.NONE,
                    "base_rate": BaseRate(n=9, k=9),
                    "changed_at": dt(date(2026, 5, 20), "09:30"),
                },
            ),
            (
                "rule_t2_post_era",
                "Post ERA line · balanced and patient share matches tracked benefits",
                Tier.TWO,
                AG.POSTING,
                A.POST_ERA_LINE,
                RuleMode.AUTO,
                {
                    **signed,
                    "signed_at": dt(date(2026, 6, 11), "16:00"),
                    "scope": RuleScope(max_cents=500_000),
                    "outcome_metric": OutcomeMetric.BALANCED,
                    "reverses_in": ReversesIn.UNTIL_DAY_CLOSE,
                    "base_rate": BaseRate(n=92, k=90),
                    "changed_at": dt(date(2026, 6, 11), "16:00"),
                },
            ),
            (
                "rule_t2_update_benefits",
                "Plan change found on 271 → update PMS benefits",
                Tier.TWO,
                AG.ELIGIBILITY,
                A.UPDATE_PMS_BENEFITS,
                RuleMode.AUTO,
                {
                    **signed,
                    "signed_at": dt(date(2026, 6, 3), "09:00"),
                    "confidence_floor": 0.95,
                    "outcome_metric": OutcomeMetric.NONE,
                    "reverses_in": ReversesIn.UNTIL_DAY_CLOSE,
                    "base_rate": BaseRate(n=212, k=211),
                },
            ),
            (
                "rule_t2_agent_text_delta_crowns",
                "Send claim · agent text · Delta × crowns",
                Tier.TWO,
                AG.CLAIMS,
                A.SEND_CLAIM_AGENT_TEXT,
                RuleMode.AUTO,
                {
                    **signed,
                    "signed_at": dt(date(2026, 9, 14), "12:10"),
                    "scope": RuleScope(payer_key=delta, item_type="crown_narrative"),
                    "outcome_metric": OutcomeMetric.ACCEPTED,
                    "reverses_in": ReversesIn.UNTIL_FILE_LEAVES,
                    "base_rate": BaseRate(n=31, k=30),
                    "changed_at": dt(date(2026, 9, 14), "12:10"),
                },
            ),
            (
                "rule_t2_corrected_claim",
                "Corrected claim (frequency 7) for a data error",
                Tier.TWO,
                AG.CLAIMS,
                A.CORRECTED_CLAIM,
                RuleMode.ASK,
                {
                    "scope": RuleScope(max_cents=50_000),
                    "outcome_metric": OutcomeMetric.ACCEPTED,
                    "reverses_in": ReversesIn.VOID_ONLY,
                    "changed_by": USR_MORGAN,
                    "changed_at": dt(date(2026, 5, 28), "10:00"),
                },
            ),
            (
                "rule_t2_patient_transfer",
                "Patient-responsibility transfer (max met, alternate benefit)",
                Tier.TWO,
                AG.POSTING,
                A.PATIENT_TRANSFER,
                RuleMode.ASK,
                {"outcome_metric": OutcomeMetric.NONE},
            ),
            (
                "rule_t2_send_statement",
                "Send statement",
                Tier.TWO,
                AG.POSTING,
                A.SEND_STATEMENT,
                RuleMode.ASK,
                {"outcome_metric": OutcomeMetric.NONE},
            ),
            (
                "rule_t2_mechanical_refund",
                "Mechanical overpayment refund to the original tender ≤ $100",
                Tier.TWO,
                AG.POSTING,
                A.MECHANICAL_REFUND,
                RuleMode.AUTO,
                {
                    **signed,
                    "signed_at": dt(date(2026, 10, 27), "17:05"),
                    "scope": RuleScope(max_cents=10_000),
                    "outcome_metric": OutcomeMetric.NONE,
                    "changed_at": dt(date(2026, 10, 27), "17:05"),
                },
            ),
            (
                "rule_t3_writeoff_void",
                "Write-off, void",
                Tier.THREE,
                AG.POSTING,
                A.WRITE_OFF,
                RuleMode.HUMAN_ONLY,
                {"changed_by": USR_MORGAN, "description": "Also covers void_claim (frequency 8)."},
            ),
            (
                "rule_t3_formal_appeal",
                "Formal appeal · the rendering dentist signs",
                Tier.THREE,
                AG.APPEALS,
                A.FORMAL_APPEAL,
                RuleMode.HUMAN_ONLY,
                {"changed_by": USR_MORGAN},
            ),
            (
                "rule_t3_refund_waiver_collections",
                "Discretionary refund, waiver, collections referral",
                Tier.THREE,
                AG.POSTING,
                A.DISCRETIONARY_REFUND,
                RuleMode.HUMAN_ONLY,
                {"changed_by": USR_MORGAN, "description": "Also covers waiver and collections_referral."},
            ),
        ]
        for sort, (rid, label, tier, agent, action, mode, kw) in enumerate(rows):
            self.rule(rid, label, tier, agent, action, mode, sort=sort, **kw)
        changes = [
            (
                "rch_5",
                "rule_t1_send_claim",
                dt(date(2026, 10, 26), "10:02"),
                USR_DANA,
                {"attachment_rule": "Delta D27xx → BWX"},
                {"attachment_rule": "Delta D27xx → PA, not BWX"},
                2,
                "Delta D27xx crowns → attach the PA, not the BWX (found 2 more)",
            ),
            (
                "rch_4",
                "rule_t2_mechanical_refund",
                dt(date(2026, 10, 27), "17:05"),
                USR_MORGAN,
                {"mode": "ask"},
                {"mode": "auto", "signed_by": USR_MORGAN},
                0,
                "Signed: mechanical refund to the original tender ≤ $100",
            ),
            (
                "rch_3",
                "rule_t2_agent_text_delta_crowns",
                dt(date(2026, 9, 14), "12:10"),
                USR_MORGAN,
                {"mode": "ask"},
                {"mode": "auto", "signed_by": USR_MORGAN},
                14,
                "Signed: agent-written narratives on Delta crown claims",
            ),
            (
                "rch_2",
                "rule_t2_post_era",
                dt(date(2026, 6, 11), "16:00"),
                USR_MORGAN,
                {"mode": "ask"},
                {"mode": "auto", "signed_by": USR_MORGAN},
                61,
                "Signed: post balanced ERA lines on contract",
            ),
            (
                "rch_1",
                "rule_t2_update_benefits",
                dt(date(2026, 6, 3), "09:00"),
                USR_MORGAN,
                {"mode": "ask"},
                {"mode": "auto", "signed_by": USR_MORGAN},
                40,
                "Signed: update PMS benefits from a 271 plan change",
            ),
        ]
        for cid, rid, at, by, before, after, n, summary in changes:
            self.b.w.add(
                RuleChange(
                    id=cid,
                    rule_id=rid,
                    at=at,
                    by=by,
                    before=before,
                    after=after,
                    items_affected_since=n,
                    summary=summary,
                )
            )

    def proposals(self) -> None:
        draft = {
            "rule_id": "rule_t1_delta_pa",
            "action": "resubmit_with_attachment",
            "tier": 1,
            "mode": "auto",
            "scope": {"payer_key": "delta_ny", "item_type": DELTA_PA_SLICE, "max_cents": 200_000},
            "confidence_floor": 0.9,
            "outcome_metric": "paid_30d",
        }
        self.b.w.add(
            RuleProposal(
                id="prop_delta_pa",
                title="Delta · missing PA x-ray · resubmits under $2,000",
                rule_draft={**draft, "root_cause_class": "payer"},
                evidence=ProposalEvidence(approved=24, total=25, outcome_k=23, outcome_n=25),
                root_cause_guard=False,
                state=ProposalState.OPEN,
                created_at=dt(TODAY, "06:15"),
                note="You approved 24 of 25 Delta CO-16 · N29 resubmissions under $2,000 in 12 months; 23 were paid within 30 days.",
            ),
            RuleProposal(
                id="prop_delta_pa_ours",
                title="Delta · missing PA x-ray · when our Claims agent attached the wrong image",
                rule_draft={**draft, "root_cause_class": "ours"},
                evidence=ProposalEvidence(approved=3, total=3, outcome_k=0, outcome_n=0),
                root_cause_guard=True,
                state=ProposalState.OPEN,
                created_at=dt(TODAY, "06:15"),
                note="Root cause: ours. Fix the upstream rule (done 10/26); this slice can never run without review.",
            ),
            RuleProposal(
                id="prop_guardian_5mm",
                title="Guardian · SRP with ≥ 5 mm pockets · send chart up front",
                rule_draft={
                    "action": "send_claim_pms_codes",
                    "scope": {"payer_key": "guardian", "item_type": "srp_chart_attached"},
                    "mode": "auto",
                },
                evidence=ProposalEvidence(approved=1, total=1, outcome_k=0, outcome_n=0),
                root_cause_guard=False,
                state=ProposalState.OPEN,
                created_at=dt(date(2026, 10, 22), "02:00"),
                watching=True,
                note="Watching · n = 1. Shown so you can see it coming; not acceptable until n ≥ 20.",
            ),
        )

    def saved_views(self) -> None:
        views: list[tuple[str, str, dict[str, Any]]] = [
            ("view_needs_action", "Needs action", {"flag": True}),
            ("view_pending_30", "Pending > 30 d", {"status": ["pending"], "age": "31_60"}),
            ("view_denied", "Denied", {"status": ["denied"]}),
            ("view_paid_oct", "Paid · Oct", {"status": ["paid"]}),
        ]
        for vid, name, params in views:
            self.b.w.add(
                SavedView(
                    id=vid,
                    name=name,
                    search_params=params,
                    owner_user_id=None,
                    created_at=dt(date(2026, 6, 1), "09:00"),
                    builtin=True,
                )
            )

    # ── evidence & world calls ─────────────────────────────────────────────────────────────────────────────

    def world_call(
        self,
        system: str,
        op: str,
        at: datetime,
        claim: Claim | None,
        run_id: str | None,
        response: dict[str, Any],
        *,
        mutation: bool = False,
    ) -> WorldCallLog:
        self._wc += 1
        call = WorldCallLog(
            id=f"wc_{self._wc:05d}",
            system=system,
            operation=op,
            at=at,
            idempotency_key=f"seed:{system}:{op}:{claim.id if claim else '-'}:{at.isoformat()}:{self._wc}",
            run_id=run_id,
            claim_id=claim.id if claim else None,
            mutation=mutation,
            response=response,
        )
        self.b.w.add(call)
        return call

    def evidence(
        self,
        eid: str,
        kind: EvidenceKind,
        title: str,
        excerpt: str,
        at: datetime,
        *,
        claim: Claim | None = None,
        reference: str | None = None,
        run_id: str | None = None,
        system: str = "",
        op: str = "",
        data: dict[str, Any] | None = None,
    ) -> str:
        call = (
            self.world_call(system or "pms", op or kind.value, at, claim, run_id, {"excerpt": excerpt[:200]})
            if system or kind is not EvidenceKind.ERA_LINE
            else None
        )
        self.b.w.add(
            Evidence(
                id=eid,
                kind=kind,
                title=title,
                excerpt=excerpt,
                captured_at=at,
                reference=reference,
                gathered_by=GatheredBy.CODE,
                claim_id=claim.id if claim else None,
                run_id=run_id,
                world_call_id=call.id if call else None,
                source=system,
                data=data or {},
            )
        )
        return eid

    # ── runs ───────────────────────────────────────────────────────────────────────────────────────────────

    def run(
        self,
        rid: str,
        agent: AgentKind,
        action: RuleAction | None,
        at: datetime,
        *,
        claim: Claim | None = None,
        patient_id: str | None = None,
        rule_id: str | None = None,
        verdict: PolicyVerdict,
        situation: str | None = None,
        outcome: str,
        summary: str,
        audit: str,
        item_id: str | None = None,
        evidence: list[str] | None = None,
        status: RunStatus = RunStatus.SUCCEEDED,
        trigger: RunTrigger = RunTrigger.RULE,
        tier: Tier | None = None,
        remittance_id: str | None = None,
    ) -> Run:
        names: list[tuple[str, str]] = [
            ("gather_case", "Gather the case"),
            ("investigate", "Investigate"),
            ("decide", "Decide"),
        ]
        if verdict is PolicyVerdict.EXECUTE and action in RECIPES:
            names += [(f"act:{n}", label) for n, label in RECIPES[action]]
        names.append(("report", "Report"))
        steps = _steps(
            at,
            names,
            verdict=verdict,
            evidence={"investigate": evidence or []},
            outputs={"decide": f"{verdict.value}: {ACTION_LABEL[action] if action else 'no action'}"},
        )
        if status is RunStatus.RUNNING:
            steps = steps[:2]
            steps[-1].status = StepStatus.RUNNING
            steps[-1].finished_at = None
        r = Run(
            id=rid,
            agent=agent,
            trigger=trigger,
            rule_id=rule_id,
            rule_version=1 if rule_id else None,
            inbox_item_id=item_id,
            claim_id=claim.id if claim else None,
            patient_id=patient_id or (claim.patient_id if claim else None),
            remittance_id=remittance_id,
            idempotency_key=f"seed:{rid}",
            status=status,
            planner=PlannerKind.SCRIPTED,
            situation_key=situation,
            action=action,
            action_label=ACTION_LABEL[action] if action else "",
            tier=tier if tier is not None else (tier_of(action) if action else None),
            verdict=verdict,
            started_at=at,
            finished_at=None if status is RunStatus.RUNNING else steps[-1].finished_at,
            steps=steps,
            result_summary=summary,
            audit_line=audit,
            outcome=outcome,
        )
        self.b.w.add(r)
        return r

    def audit_line(
        self, agent: AgentKind, action: RuleAction | None, claim: Claim | None, extra: str, rule: str
    ) -> str:
        if claim is None:
            return f"{AGENT_LABEL[agent]} · {ACTION_LABEL[action] if action else 'flag'} · {extra} · {rule}"
        patient = self.patients[claim.patient_id]
        payer = {
            "delta_ny": "Delta",
            "metlife": "MetLife",
            "cigna": "Cigna",
            "aetna": "Aetna",
            "guardian": "Guardian",
            "ny_medicaid": "NY Medicaid",
        }[claim.payer_key.value]
        return f"{AGENT_LABEL[agent]} · {ACTION_LABEL[action] if action else 'flag'} · #{claim.number} {patient.display_name} · {payer} · ${claim.billed_cents / 100:,.0f} · {extra} · {rule}"

    # ── the 12 open inbox items ────────────────────────────────────────────────────────────────────────────

    def item(
        self,
        iid: str,
        kind: InboxItemKind,
        agent: AgentKind,
        title: str,
        recommendation: str,
        *,
        claim: Claim | None = None,
        tier: Tier | None,
        cents: int,
        created: datetime,
        **kw: Any,
    ) -> InboxItem:
        item = InboxItem(
            id=iid,
            kind=kind,
            state=InboxItemState.OPEN,
            claim_id=claim.id if claim else kw.pop("claim_id", None),
            patient_id=claim.patient_id if claim else kw.pop("patient_id", None),
            agent=agent,
            title=title,
            recommendation=recommendation,
            tier=tier,
            cents=cents,
            created_at=created,
            **kw,
        )
        self.b.w.add(item)
        return item

    def inbox(self) -> None:
        self.delta_group_items()
        self.claim_items()
        self.posting_items()
        self.eligibility_items()

    def delta_group_items(self) -> None:
        group = [(4821, "owens_k_pa"), (4836, "grant_l_pa"), (4840, "diaz_f_pa")]
        imgs = self.pinned.images
        for number, img_key in group:
            claim = self.claims[number]
            image_id = imgs["owens_pa" if number == 4821 else img_key]
            tooth = claim.lines[0].tooth
            ev = [
                self.evidence(
                    f"ev_{number}_portal",
                    EvidenceKind.PORTAL_SCREENSHOT,
                    "Delta portal · claim status",
                    f"Claim {claim.icn} · Denied 10/26/2026 · CO-16 N29 · Paid $0.00 · Pre-operative radiograph required for D2740/D2750.",
                    dt(date(2026, 10, 27), "16:00"),
                    claim=claim,
                    reference=claim.icn,
                    system="payer:delta_ny",
                    op="portal.check_status",
                ),
                self.evidence(
                    f"ev_{number}_pa",
                    EvidenceKind.PMS_RECORD,
                    f"PA x-ray, tooth #{tooth}",
                    f"PMS imaging · periapical #{tooth} · taken {claim.dos:%m/%d} · not sent with the claim",
                    dt(TODAY, "06:14"),
                    claim=claim,
                    reference=image_id,
                    system="pms",
                    op="pms.find_images",
                    data={"image_id": image_id},
                ),
                self.evidence(
                    f"ev_{number}_era",
                    EvidenceKind.ERA_LINE,
                    "Delta 835 · 10/26 · denial line",
                    f"{claim.lines[0].cdt} #{tooth} · billed ${claim.lines[0].fee_cents / 100:,.2f} · CO-16 · N29: claim lacks information — pre-operative radiograph required.",
                    dt(date(2026, 10, 26), "05:40"),
                    claim=claim,
                    reference="rem_delta_1026",
                ),
            ]
            if number == 4821:
                ev.append(
                    self.evidence(
                        "ev_4821_ivr",
                        EvidenceKind.IVR_TRANSCRIPT,
                        "Delta IVR · status check",
                        "16:02:11 IVR: Claim 26299-041833 for date of service October 12 was denied on October 26. Amount paid: zero dollars. Reason: additional information required.",
                        dt(date(2026, 10, 27), "16:02"),
                        claim=claim,
                        reference="IVR-1027-1602",
                        system="payer:delta_ny",
                        op="ivr.check_status",
                    )
                )
                ev.append(
                    self.evidence(
                        "ev_4821_rep",
                        EvidenceKind.REP_CALL,
                        "Delta rep call · ref DD-1027-88412",
                        "16:20 Rep: …send the PA through FastAttach and resubmit with the claim number. No appeal needed for a missing x-ray. (6 m 12 s)",
                        dt(date(2026, 10, 27), "16:20"),
                        claim=claim,
                        reference="DD-1027-88412",
                        system="payer:delta_ny",
                        op="call_rep",
                    )
                )
            run = self.run(
                f"run_followup_{number}_1028",
                AG.FOLLOWUP,
                A.RESUBMIT_WITH_ATTACHMENT,
                dt(TODAY, "06:15"),
                claim=claim,
                rule_id="rule_t1_delta_pa",
                verdict=PolicyVerdict.PROPOSE,
                situation=DELTA_PA_SLICE,
                outcome="Awaiting you",
                summary=f"Matched the PA of #{tooth} in PMS imaging; rule is Ask → proposed.",
                audit=self.audit_line(
                    AG.FOLLOWUP, A.RESUBMIT_WITH_ATTACHMENT, claim, "proposed", "rule Missing PA v1 (ask)"
                ),
                item_id=f"itm_{number}",
                evidence=ev,
            )
            self.item(
                f"itm_{number}",
                InboxItemKind.APPROVE_ACTION,
                AG.FOLLOWUP,
                f"Denial · Delta Dental · missing PA x-ray · #{number}",
                f"Upload the {claim.dos:%m/%d} PA of #{tooth} to NEA; resubmit with the NEA# and the original claim # in the next Delta file.",
                claim=claim,
                tier=Tier.ONE,
                cents=claim.billed_cents,
                created=dt(TODAY, "06:15"),
                summary=f"Denied 10/26, CO-16 · N29: pre-operative radiograph required. Our Claims agent sent the BWX, not the PA of #{tooth}; rule fixed 10/26.",
                plan_steps=[
                    f"Upload PA #{tooth} (PMS imaging, {claim.dos:%m/%d}) to NEA FastAttach",
                    "Resubmit: NEA# in the attachment field, note cites the ICN",
                    "Send in the next Delta file via Vyne",
                    "Keep the day-30 status check",
                ],
                confidence=Confidence(
                    pct=92,
                    basis="23 of 25 Delta CO-16 · N29 denials paid within 30 d after a PA resubmit (12 mo)",
                ),
                evidence=ev,
                proposed_action=ProposedAction(
                    action=A.RESUBMIT_WITH_ATTACHMENT,
                    params={"claim_id": claim.id, "image_id": image_id, "attachment_kind": "pa"},
                    cents=claim.billed_cents,
                ),
                group_key=f"delta_ny:{DELTA_PA_SLICE}",
                group_title="Delta Dental · missing PA x-ray",
                rule_id="rule_t1_delta_pa",
                audit_note="root cause: ours — Claims agent attached BWX; rule updated 10/26",
                deadline_on=claim.deadline.due_on,
                run_id=run.id,
                payload={"root_cause": "ours", "situation_key": DELTA_PA_SLICE},
            )

    def claim_items(self) -> None:
        webb = self.claims[4733]
        ev = [
            self.evidence(
                "ev_4733_prior_eob",
                EvidenceKind.PRIOR_EOB,
                "Delta EOB · 03/2022",
                "03/08/2022 · D2740 crown · tooth #31 · paid. (Delta's tooth history records this crown on #30.)",
                dt(TODAY, "06:38"),
                claim=webb,
                reference="EOB-2022-0308",
                system="pms",
                op="pms.get_documents",
            ),
            self.evidence(
                "ev_4733_pms",
                EvidenceKind.PMS_RECORD,
                "PMS history · tooth #30",
                "2019-08-14 crown seated #30; replaced 09/21/2026 for fracture (signed note). #31 crown 03/2022.",
                dt(TODAY, "06:38"),
                claim=webb,
                system="pms",
                op="pms.get_visit",
            ),
            self.evidence(
                "ev_4733_era",
                EvidenceKind.ERA_LINE,
                "Delta 835 · 10/22 · denial line",
                "D2740 #30 · CO-119: benefit frequency for this period reached (payer tooth history: crown #30 03/2022).",
                dt(date(2026, 10, 22), "05:35"),
                claim=webb,
                reference="rem_delta_1022",
            ),
        ]
        run = self.run(
            "run_appeals_4733_1028",
            AG.APPEALS,
            A.REPROCESSING_REQUEST,
            dt(TODAY, "06:40"),
            claim=webb,
            verdict=PolicyVerdict.PROPOSE,
            situation="denied:CO-119:frequency_history_conflict",
            outcome="Awaiting you",
            summary="Drafted a claim inquiry citing Delta's own 03/2022 EOB (tooth #31).",
            audit=self.audit_line(
                AG.APPEALS,
                A.REPROCESSING_REQUEST,
                webb,
                "draft for review",
                "agent-written payer text → tier 2",
            ),
            item_id="itm_4733",
            evidence=ev,
            tier=Tier.TWO,
        )
        self.item(
            "itm_4733",
            InboxItemKind.REVIEW_DRAFT,
            AG.APPEALS,
            "Reconsideration · Delta Dental · frequency (CO-119) · #4733",
            "Send a claim inquiry with Delta's own 03/2022 EOB: the 2022 crown was #31, not #30.",
            claim=webb,
            tier=Tier.TWO,
            cents=webb.billed_cents,
            created=dt(TODAY, "06:40"),
            summary="Frequency denial (CO-119): payer tooth-number error. Real prior #30 crown seated 2019-08-14, replaced for fracture.",
            confidence=Confidence(pct=82, basis="9 of 11 tooth-history reconsiderations paid (12 mo)"),
            evidence=ev,
            proposed_action=ProposedAction(
                action=A.REPROCESSING_REQUEST,
                params={"claim_id": webb.id, "basis": "payer_history_error", "attach": ["ev_4733_prior_eob"]},
                cents=webb.billed_cents,
            ),
            deadline_on=webb.deadline.due_on,
            run_id=run.id,
            payload={
                "draft": {
                    "kind": "reconsideration_note",
                    "segments": [
                        {
                            "text": "Claim 26265-030412 (DOS 09/21/2026, D2740 #30) was denied CO-119.",
                            "fact_type": "administrative",
                            "evidence_ids": ["ev_4733_era"],
                        },
                        {
                            "text": "Delta's 03/08/2022 EOB shows the prior crown on tooth #31.",
                            "fact_type": "clinical",
                            "evidence_ids": ["ev_4733_prior_eob"],
                        },
                        {
                            "text": "The prior crown on #30 was seated 08/14/2019 and replaced on 09/21/2026 after a fracture.",
                            "fact_type": "clinical",
                            "evidence_ids": ["ev_4733_pms"],
                        },
                        {
                            "text": "Please correct the tooth history and reprocess.",
                            "fact_type": "none",
                            "evidence_ids": [],
                        },
                    ],
                }
            },
        )

        brooks = self.claims[4705]
        ev = [
            self.evidence(
                "ev_4705_portal",
                EvidenceKind.PORTAL_SCREENSHOT,
                "MetLife portal · claim status",
                "Claim ML2608260417 · In process · No additional information requested · Received 08/26/2026.",
                dt(date(2026, 10, 26), "14:30"),
                claim=brooks,
                reference="ML2608260417",
                system="payer:metlife",
                op="portal.check_status",
            ),
            self.evidence(
                "ev_4705_law",
                EvidenceKind.POLICY_CLAUSE,
                "NY Insurance Law §3224-a",
                "Insurers must pay undisputed electronic claims within 30 days of receipt; insured (not self-funded) plans.",
                dt(TODAY, "06:30"),
                claim=brooks,
                system="rulebook",
                op="payer_rulebook_lookup",
            ),
        ]
        run = self.run(
            "run_followup_4705_1028",
            AG.FOLLOWUP,
            A.REPROCESSING_REQUEST,
            dt(TODAY, "06:30"),
            claim=brooks,
            rule_id="rule_t1_reprocessing",
            verdict=PolicyVerdict.PROPOSE,
            situation="pending:prompt_pay_eligible",
            outcome="Awaiting you",
            summary="Clean claim, day 64, insured plan → prompt-pay reprocessing request.",
            audit=self.audit_line(AG.FOLLOWUP, A.REPROCESSING_REQUEST, brooks, "proposed", "rule Prompt-pay v1 (ask)"),
            item_id="itm_4705",
            evidence=ev,
        )
        self.item(
            "itm_4705",
            InboxItemKind.APPROVE_ACTION,
            AG.FOLLOWUP,
            "Follow-up · MetLife · day 64 · #4705",
            "Clean claim, 64 days, no request for information. Send the NY prompt-pay reprocessing request.",
            claim=brooks,
            tier=Tier.ONE,
            cents=brooks.billed_cents,
            created=dt(TODAY, "06:30"),
            confidence=Confidence(pct=88, basis="22 of 25 prompt-pay requests paid within 30 d"),
            evidence=ev,
            proposed_action=ProposedAction(
                action=A.REPROCESSING_REQUEST,
                params={"claim_id": brooks.id, "basis": "ny_prompt_pay"},
                cents=brooks.billed_cents,
            ),
            rule_id="rule_t1_reprocessing",
            run_id=run.id,
        )

        moreau = self.claims[4851]
        ev = [
            self.evidence(
                "ev_4851_ack",
                EvidenceKind.PORTAL_SCREENSHOT,
                "Cigna 277CA · A7:164",
                "Subscriber/insured not found · U48213307.",
                dt(TODAY, "07:02"),
                claim=moreau,
                reference="A7:164",
                system="vyne",
                op="277ca",
            ),
            self.evidence(
                "ev_4851_271",
                EvidenceKind.PORTAL_SCREENSHOT,
                "Cigna 271 eligibility response",
                "Member found · subscriber id U48213370 · DPPO · active 01/01/2026.",
                dt(TODAY, "07:03"),
                claim=moreau,
                reference="271-1028-0703",
                system="payer:cigna",
                op="eligibility_271",
            ),
            self.evidence(
                "ev_4851_pms",
                EvidenceKind.PMS_RECORD,
                "PMS coverage · Moreau",
                "Subscriber id on file: U48213307 (intake 10/27, typed from card).",
                dt(TODAY, "07:03"),
                claim=moreau,
                system="pms",
                op="pms.get_coverage",
            ),
        ]
        run = self.run(
            "run_claims_4851_1028",
            AG.CLAIMS,
            A.FIX_DEMOGRAPHICS_RESEND,
            dt(TODAY, "07:02"),
            claim=moreau,
            rule_id="rule_t1_fix_demographics",
            verdict=PolicyVerdict.PROPOSE,
            situation="rejected:A7:164",
            outcome="1 awaiting you",
            summary="The new id comes from the 271, not the PMS; the rule only resends PMS values → proposed.",
            audit=self.audit_line(
                AG.CLAIMS,
                A.FIX_DEMOGRAPHICS_RESEND,
                moreau,
                "proposed (value ≠ PMS field)",
                "rule Fix demographics v1",
            ),
            item_id="itm_4851",
            evidence=ev,
        )
        self.item(
            "itm_4851",
            InboxItemKind.APPROVE_ACTION,
            AG.CLAIMS,
            "Rejected · Cigna · subscriber ID · #4851",
            "Subscriber ID not found; the 271 has U48213370. Update the PMS and resend in the next Cigna file.",
            claim=moreau,
            tier=Tier.ONE,
            cents=moreau.billed_cents,
            created=dt(TODAY, "07:03"),
            confidence=Confidence(pct=84, basis="16 of 19 demographic resends accepted"),
            evidence=ev,
            proposed_action=ProposedAction(
                action=A.FIX_DEMOGRAPHICS_RESEND,
                params={
                    "claim_id": moreau.id,
                    "field": "subscriber_id",
                    "value": "U48213370",
                    "source": "271",
                },
                cents=moreau.billed_cents,
                requires_hold_window=True,
            ),
            rule_id="rule_t1_fix_demographics",
            run_id=run.id,
        )

    def posting_items(self) -> None:
        foster = self.claims[4772]
        ev = [
            self.evidence(
                "ev_4772_era",
                EvidenceKind.ERA_LINE,
                "Cigna 835 · 10/28 · line held",
                "D2392 #19 · billed $255.00 · allowed $168.00 · CO-45 $87.00 · PR-1 $32.00 · PR-2 $27.20 · paid $108.80",
                dt(TODAY, "06:20"),
                claim=foster,
                reference="rem_cigna_1028",
            ),
            self.evidence(
                "ev_4772_eob",
                EvidenceKind.PRIOR_EOB,
                "Cigna EOB · 05/12/2026",
                "Deductible $50.00 met 05/12/2026 (D0150 · D0210).",
                dt(TODAY, "06:20"),
                claim=foster,
                reference="EOB-0512",
                system="pms",
                op="pms.get_documents",
            ),
        ]
        run = self.run(
            "run_posting_4772_1028",
            AG.POSTING,
            A.POST_ERA_LINE,
            dt(TODAY, "06:20"),
            claim=foster,
            rule_id="rule_t2_post_era",
            verdict=PolicyVerdict.PROPOSE,
            situation="variance:deductible_misapplied",
            outcome="Awaiting you",
            summary="Line does not match tracked benefits (deductible met 05/12) → held, not posted.",
            audit=self.audit_line(
                AG.POSTING,
                A.POST_ERA_LINE,
                foster,
                "held as variance",
                "rule Post ERA v1 (auto) · patient share ≠ tracked benefits",
            ),
            item_id="itm_4772",
            evidence=ev,
            remittance_id="rem_cigna_1028",
        )
        self.item(
            "itm_4772",
            InboxItemKind.VARIANCE,
            AG.POSTING,
            "Cigna ERA hold · #4772 · PR-1 applied though met",
            "PR-1 $32 applied though the deductible was met 05/12 → hold for reprocessing, not write-off. Patient owes $27.20 now; $32 disputed; refund $6.40 owed.",
            claim=foster,
            tier=Tier.TWO,
            cents=foster.billed_cents,
            created=dt(TODAY, "06:20"),
            remittance_id="rem_cigna_1028",
            confidence=Confidence(pct=None, basis="no base rate (n = 3)"),
            evidence=ev,
            proposed_action=ProposedAction(
                action=A.POST_ERA_LINE,
                params={
                    "remittance_id": "rem_cigna_1028",
                    "claim_id": foster.id,
                    "post": "patient_share_only",
                    "patient_cents": 2_720,
                    "disputed_cents": 3_200,
                    "then": "reprocessing_request:deductible_misapplied",
                },
                cents=10_880,
            ),
            rule_id="rule_t2_post_era",
            run_id=run.id,
        )

        osei = self.claims[4748]
        ev = [
            self.evidence(
                "ev_4748_era",
                EvidenceKind.ERA_LINE,
                "Aetna 835 · 10/26",
                "D2392 #14 · allowed $185.00 · PR-186 $38.00 (alternate benefit: D2150 rate) · paid at the amalgam rate.",
                dt(date(2026, 10, 26), "05:50"),
                claim=osei,
                reference="rem_aetna_1026",
            )
        ]
        run = self.run(
            "run_posting_4748_1026",
            AG.POSTING,
            A.PATIENT_TRANSFER,
            dt(date(2026, 10, 27), "08:10"),
            claim=osei,
            rule_id="rule_t2_patient_transfer",
            verdict=PolicyVerdict.PROPOSE,
            situation="variance:alternate_benefit",
            outcome="Awaiting you",
            summary="Alternate benefit −$38; on the signed estimate → patient transfer proposed.",
            audit=self.audit_line(AG.POSTING, A.PATIENT_TRANSFER, osei, "proposed", "rule Patient transfer v1 (ask)"),
            item_id="itm_4748",
            evidence=ev,
            remittance_id="rem_aetna_1026",
        )
        self.item(
            "itm_4748",
            InboxItemKind.APPROVE_ACTION,
            AG.POSTING,
            "Patient balance · Aetna · alternate benefit · #4748",
            "Transfer the $38 alternate-benefit difference to the patient; it was on the signed estimate.",
            claim=osei,
            tier=Tier.TWO,
            cents=osei.billed_cents,
            created=dt(date(2026, 10, 27), "08:10"),
            confidence=Confidence(pct=None, basis="no base rate (n = 4)"),
            evidence=ev,
            proposed_action=ProposedAction(
                action=A.PATIENT_TRANSFER, params={"claim_id": osei.id, "cents": 3_800}, cents=3_800
            ),
            rule_id="rule_t2_patient_transfer",
            run_id=run.id,
        )

        diaz = self.claims[4611]
        ev = [
            self.evidence(
                "ev_4611_portal",
                EvidenceKind.PORTAL_SCREENSHOT,
                "Delta portal · benefits",
                "Annual maximum $1,500.00 · used $1,500.00 · remaining $0.00 · as of 10/27/2026.",
                dt(date(2026, 10, 27), "09:10"),
                claim=diaz,
                system="payer:delta_ny",
                op="portal.benefits",
            ),
            self.evidence(
                "ev_4611_era",
                EvidenceKind.ERA_LINE,
                "Delta 835 · 10/22",
                "D2740 #30 · allowed $1,012.00 · PR-119 annual max met · CO-45 $228.00.",
                dt(date(2026, 10, 22), "05:35"),
                claim=diaz,
                reference="rem_delta_1022",
            ),
        ]
        run = self.run(
            "run_posting_4611_1027",
            AG.POSTING,
            A.WRITE_OFF,
            dt(date(2026, 10, 27), "09:12"),
            claim=diaz,
            verdict=PolicyVerdict.PROPOSE,
            situation="denied:PR-119:max_met",
            outcome="Awaiting you",
            summary="Max met confirmed on the portal: bill the patient the allowed $1,012; write off $228 (tier 3 → a person).",
            audit=self.audit_line(AG.POSTING, A.WRITE_OFF, diaz, "proposed to a human", "tier 3 · human only"),
            item_id="itm_4611",
            evidence=ev,
        )
        self.item(
            "itm_4611",
            InboxItemKind.APPROVE_ACTION,
            AG.POSTING,
            "Denial · Delta Dental · max met (PR-119) · #4611",
            "Bill the patient the allowed $1,012 and write off $228 (contractual).",
            claim=diaz,
            tier=Tier.THREE,
            cents=diaz.billed_cents,
            created=dt(date(2026, 10, 27), "09:12"),
            confidence=Confidence(pct=None, basis="tier 3 · human decision · max confirmed on portal 10/27"),
            evidence=ev,
            proposed_action=ProposedAction(
                action=A.WRITE_OFF,
                params={"claim_id": diaz.id, "writeoff_cents": 22_800, "patient_transfer_cents": 101_200},
                cents=22_800,
            ),
            required_role=Role.OWNER,
            run_id=run.id,
        )

    def eligibility_items(self) -> None:
        for item in self._appointments_with_flags():
            self.b.w.add(item)

    # ── eligibility ────────────────────────────────────────────────────────────────────────────────────────

    def eligibility(self) -> None:
        self._appointments: list[tuple[Appointment, str | None]] = []
        rows: list[tuple[str, date, str, str, list[tuple[str, str | None, int]], EligibilityStatus, str | None]] = [
            (
                "shah_p",
                date(2026, 10, 29),
                "08:00",
                PRV_LEE,
                [("D0120", None, 5_700), ("D1110", None, 8_500)],
                EligibilityStatus.VERIFIED,
                None,
            ),
            (
                "chen_j",
                date(2026, 10, 29),
                "09:00",
                PRV_MORGAN,
                [("D4341", None, 20_500), ("D4341", None, 20_500), ("D2392", "30", 24_000)],
                EligibilityStatus.ISSUE,
                "chen",
            ),
            (
                "moss_t",
                date(2026, 10, 29),
                "10:30",
                PRV_LEE,
                [("D0120", None, 5_700), ("D1110", None, 8_500)],
                EligibilityStatus.VERIFIED,
                None,
            ),
            (
                "ito_w",
                date(2026, 10, 29),
                "11:30",
                PRV_MORGAN,
                [("D0210", None, 18_000), ("D1110", None, 8_500)],
                EligibilityStatus.CHECKING,
                None,
            ),
            (
                "kim_s",
                date(2026, 10, 29),
                "13:00",
                PRV_LEE,
                [("D0274", None, 5_800), ("D1110", None, 8_500)],
                EligibilityStatus.ISSUE,
                "kim",
            ),
            (
                "ford_e",
                date(2026, 10, 29),
                "14:30",
                PRV_MORGAN,
                [("D2392", "30", 25_500)],
                EligibilityStatus.VERIFIED,
                None,
            ),
            (
                "park_n",
                date(2026, 10, 30),
                "09:00",
                PRV_MORGAN,
                [
                    ("D0150", None, 13_000),
                    ("D0210", None, 18_000),
                    ("D4341", None, 24_000),
                    ("D0220", "18", 3_000),
                    ("D1206", None, 5_900),
                ],
                EligibilityStatus.UNVERIFIED,
                "park",
            ),
            (
                "webb_c",
                date(2026, 10, 30),
                "10:30",
                PRV_LEE,
                [("D0210", None, 18_000), ("D1110", None, 8_500)],
                EligibilityStatus.CHECKING,
                None,
            ),
            (
                "brandt_k",
                date(2026, 10, 30),
                "13:00",
                PRV_LEE,
                [("D1110", None, 8_500)],
                EligibilityStatus.VERIFIED,
                None,
            ),
            (
                "patel_r",
                date(2026, 10, 30),
                "13:30",
                PRV_MORGAN,
                [("D4341", None, 20_500), ("D4341", None, 20_500)],
                EligibilityStatus.VERIFIED,
                None,
            ),
            (
                "alvarez_m",
                date(2026, 10, 30),
                "14:30",
                PRV_MORGAN,
                [("D0120", None, 5_700), ("D1110", None, 8_500), ("D0274", None, 5_800)],
                EligibilityStatus.VERIFIED,
                None,
            ),
        ]
        for key, day, at, provider, planned, status, flag in rows:
            pid = f"pat_{key}"
            patient = self.patients[pid]
            appt = Appointment(
                id=f"apt_{day:%m%d}_{key}",
                patient_id=pid,
                provider_id=provider,
                location_id=patient.location_id,
                start=dt(day, at),
                planned_procedures=[PlannedProcedure(cdt=c, tooth=t, fee_cents=f) for c, t, f in planned],
                eligibility_status=status,
                eligibility_note=_ELIG_NOTES.get(flag or ""),
            )
            self.b.w.add(appt)
            self._appointments.append((appt, flag))
            if status in (EligibilityStatus.VERIFIED, EligibilityStatus.ISSUE):
                cov = next(c for c in self.b.w.of(Coverage) if c.patient_id == pid and c.order.value == "primary")
                ins, pt = _estimate(cov, sum(p.fee_cents for p in appt.planned_procedures), flag)
                self.b.w.add(
                    Estimate(
                        id=f"est_{appt.id}",
                        appointment_id=appt.id,
                        as_of=dt(TODAY, "06:12"),
                        basis=VerifiedVia.PORTAL,
                        lines=appt.planned_procedures,
                        insurance_est_cents=ins,
                        patient_est_cents=pt,
                    )
                )
        today_rows: list[tuple[str, str, str, str, list[tuple[str, str | None, int]]]] = [
            ("reyes_a", "10:40", "10:52", PRV_MORGAN, [("D2740", "3", 109_000), ("D2950", "3", 12_000)]),
            ("romano_g", "10:00", "10:50", PRV_LEE, [("D0120", None, 5_700), ("D1110", None, 8_500)]),
            ("lindgren_c", "10:00", "10:51", PRV_LEE, [("D2740", "14", 109_000)]),
            ("kowalski_v", "10:15", "10:56", PRV_LEE, [("D4910", None, 14_000)]),
            (
                "torres_d",
                "11:00",
                "11:40",
                PRV_MORGAN,
                [("D0120", None, 5_700), ("D1120", None, 6_200), ("D9941", None, 19_500)],
            ),
        ]
        for key, start, checkout, provider, planned in today_rows:
            pid = f"pat_{key}"
            self.b.w.add(
                Appointment(
                    id=f"apt_1028_{key}",
                    patient_id=pid,
                    provider_id=provider,
                    location_id=self.patients[pid].location_id,
                    start=dt(TODAY, start),
                    planned_procedures=[PlannedProcedure(cdt=c, tooth=t, fee_cents=f) for c, t, f in planned],
                    eligibility_status=EligibilityStatus.VERIFIED,
                    checkout_at=dt(TODAY, checkout),
                )
            )

    def _appointments_with_flags(self) -> list[InboxItem]:
        out: list[InboxItem] = []
        for appt, flag in self._appointments:
            if flag is None:
                continue
            patient = self.patients[appt.patient_id]
            cents = sum(p.fee_cents for p in appt.planned_procedures)
            title, rec, ev = self._elig_texts(flag, appt)
            run = self.run(
                f"run_elig_{appt.id}",
                AG.ELIGIBILITY,
                None,
                dt(TODAY, "06:12"),
                patient_id=patient.id,
                verdict=PolicyVerdict.PROPOSE,
                situation=f"eligibility:{flag}",
                outcome="Awaiting you",
                summary=rec,
                audit=self.audit_line(
                    AG.ELIGIBILITY,
                    None,
                    None,
                    f"{patient.display_name} · {appt.start:%a %H:%M}",
                    "no rule → front desk",
                ),
                item_id=f"itm_elig_{flag}",
                evidence=ev,
                tier=None,
            )
            out.append(
                InboxItem(
                    id=f"itm_elig_{flag}",
                    kind=InboxItemKind.ELIGIBILITY_FLAG,
                    state=InboxItemState.OPEN,
                    patient_id=patient.id,
                    appointment_id=appt.id,
                    agent=AG.ELIGIBILITY,
                    title=title,
                    recommendation=rec,
                    confidence=Confidence(
                        pct=None,
                        basis="as of 10/28 06:12 · portal" if flag != "park" else "unverified · portal down",
                    ),
                    evidence=ev,
                    tier=None,
                    cents=cents,
                    created_at=dt(TODAY, "06:12"),
                    run_id=run.id,
                )
            )
        return out

    def _elig_texts(self, flag: str, appt: Appointment) -> tuple[str, str, list[str]]:
        patient = self.patients[appt.patient_id]
        when = f"{appt.start:%a %m/%d %I:%M %p}".replace(" 0", " ")
        if flag == "chen":
            ev = [
                self.evidence(
                    "ev_elig_chen",
                    EvidenceKind.PORTAL_SCREENSHOT,
                    "MetLife portal · benefits",
                    "Annual max $1,500.00 · used $1,320.00 · remaining $180.00 · deductible $50/$50 met · D4341 1/24 mo last 03/12/2024.",
                    dt(TODAY, "06:12"),
                    system="payer:metlife",
                    op="portal.benefits",
                )
            ]
            return (
                f"Eligibility · {patient.display_name} · {when} · over max",
                "Remaining max $180 of $1,500; planned $650 → insurance $180 / patient $470 · as of 10/28 · portal. Quote $470 at check-in, or move D2392 after 1/1.",
                ev,
            )
        if flag == "kim":
            ev = [
                self.evidence(
                    "ev_elig_kim",
                    EvidenceKind.PORTAL_SCREENSHOT,
                    "Guardian portal · frequency",
                    "D0274 bitewings: 1 per 12 months · last 11/03/2025 · next eligible 11/03/2026.",
                    dt(TODAY, "06:12"),
                    system="payer:guardian",
                    op="portal.benefits",
                )
            ]
            return (
                f"Eligibility · {patient.display_name} · {when} · frequency",
                "Bitewings are not covered until 11/03 (last 11/03/2025). Skip D0274 or have the patient sign the non-covered acknowledgment.",
                ev,
            )
        return (
            f"Eligibility · {patient.display_name} · {when} · could not verify",
            "MetLife portal and IVR unavailable since 05:40; 271 returned no plan detail. Verify at check-in or call MetLife.",
            [],
        )

    # ── runs that ran without review (41) ──────────────────────────────────────────────────────────────────

    def ran_without_review(self) -> None:
        claims = self.claims
        accepted_tue = sorted((c for c in claims.values() if c.status is ClaimStatus.ACCEPTED), key=lambda c: c.number)
        delta_crowns = [
            c for c in accepted_tue if c.payer_key is PayerKey.DELTA_NY and c.lines[0].cdt.startswith("D27")
        ]
        # claims: 11 tier-1 (sends + demographic fixes) and 2 tier-2 (agent-written narrative sends)
        sends = [claims[n] for n in (4857, 4864, 4860, 4866, 4863, 4855, 4856)] + accepted_tue[:2]
        for c in sends:
            at = c.built_at + timedelta(minutes=1)
            self.run(
                f"run_claims_send_{c.number}",
                AG.CLAIMS,
                A.SEND_CLAIM_PMS_CODES,
                at,
                claim=c,
                rule_id="rule_t1_send_claim",
                verdict=PolicyVerdict.EXECUTE,
                situation="ready:clean",
                outcome="Sent" if c.sent_at else "Queued for file",
                summary="13 of 13 readiness checks passed; queued for the next file.",
                audit=self.audit_line(
                    AG.CLAIMS,
                    A.SEND_CLAIM_PMS_CODES,
                    c,
                    f"file {(c.file_time or at):%H:%M}",
                    "rule Send claim · PMS codes v3 (auto) · until the file leaves",
                ),
            )
        for n, at, fix in (
            (4860, dt(TODAY, "09:52"), "subscriber id 8 → 9 digits (PMS)"),
            (4854, dt(TODAY, "07:02"), "rendering NPI from the PMS provider record"),
        ):
            c = claims[n]
            self.run(
                f"run_claims_fix_{n}",
                AG.CLAIMS,
                A.FIX_DEMOGRAPHICS_RESEND,
                at,
                claim=c,
                rule_id="rule_t1_fix_demographics",
                verdict=PolicyVerdict.EXECUTE,
                situation="rejected:A7",
                outcome="Resent",
                summary=f"Fixed {fix}; resent in the next file.",
                audit=self.audit_line(
                    AG.CLAIMS,
                    A.FIX_DEMOGRAPHICS_RESEND,
                    c,
                    fix,
                    "rule Fix demographics v1 (auto) · until the file leaves",
                ),
            )
        texts = [claims[4859], *(delta_crowns[:1] or accepted_tue[2:3])]
        for c in texts:
            self.run(
                f"run_claims_text_{c.number}",
                AG.CLAIMS,
                A.SEND_CLAIM_AGENT_TEXT,
                c.built_at + timedelta(minutes=1),
                claim=c,
                rule_id="rule_t2_agent_text_delta_crowns",
                verdict=PolicyVerdict.EXECUTE,
                situation="ready:crown_narrative",
                outcome="Queued for file" if c.status is ClaimStatus.READY else "Sent",
                summary="Buildup narrative drafted from the signed note; text guard passed.",
                audit=self.audit_line(
                    AG.CLAIMS,
                    A.SEND_CLAIM_AGENT_TEXT,
                    c,
                    "narrative (text guard ✓)",
                    "rule Agent text · Delta × crowns v1 (auto, signed Dr. Morgan 09/14)",
                ),
            )
        # followup: 18 tier-1 decisions on pending claims this week
        pending = sorted(
            (
                c
                for c in claims.values()
                if c.status is ClaimStatus.PENDING
                and c.number not in (4705, 4796, 4797, 3561, 4800, 4744, 4709, 4731, 4841)
            ),
            key=lambda c: c.number,
        )
        plan = (
            [
                (
                    A.RECORDS_REQUEST,
                    "rule_t1_records_request",
                    "denied:CO-16:M127:records_request",
                    "Records sent via NEA",
                )
            ]
            * 9
            + [
                (
                    A.RESUBMIT_WITH_ATTACHMENT,
                    "rule_t1_records_request",
                    "denied:CO-16:N29:attachment",
                    "Resubmitted with attachment",
                )
            ]
            * 6
            + [
                (
                    A.REPROCESSING_REQUEST,
                    "rule_t1_reprocessing",
                    "pending:prompt_pay_eligible",
                    "Reprocessing requested",
                )
            ]
            * 3
        )
        week = [date(2026, 10, 26), date(2026, 10, 27), TODAY]
        for i, ((action, rule_id, situation, outcome), c) in enumerate(zip(plan, pending, strict=False)):
            at = dt(week[i % 3], f"{6 + i % 4:02d}:{(i * 7) % 60:02d}")
            if at > T.NOW:
                at = dt(TODAY, "06:05")
            nea = f"26-44{70100 + i * 37:05d}"
            c.in_flight = f"{outcome.lower()} {at:%m/%d} · awaiting reprocessing"
            self.run(
                f"run_followup_{c.number}_{at:%m%d}",
                AG.FOLLOWUP,
                action,
                at,
                claim=c,
                rule_id=rule_id,
                verdict=PolicyVerdict.EXECUTE,
                situation=situation,
                outcome=outcome,
                summary=f"{outcome}; NEA# {nea}.",
                audit=self.audit_line(
                    AG.FOLLOWUP,
                    action,
                    c,
                    f"NEA# {nea}",
                    f"rule {ACTION_LABEL[action]} v1 (auto) · void only",
                ),
            )
        # eligibility: 5 tier-2 benefit updates
        for key in ("shah_p", "moss_t", "ford_e", "brandt_k", "patel_r"):
            patient = self.patients[f"pat_{key}"]
            self.run(
                f"run_elig_update_{key}",
                AG.ELIGIBILITY,
                A.UPDATE_PMS_BENEFITS,
                dt(TODAY, "06:12"),
                patient_id=patient.id,
                rule_id="rule_t2_update_benefits",
                verdict=PolicyVerdict.EXECUTE,
                situation="eligibility:plan_change",
                outcome="PMS updated",
                summary="271 showed a plan change (used to date); PMS benefits updated.",
                audit=self.audit_line(
                    AG.ELIGIBILITY,
                    A.UPDATE_PMS_BENEFITS,
                    None,
                    patient.display_name,
                    "rule Update PMS benefits v1 (auto, signed Dr. Morgan 06/03)",
                ),
            )
        # posting: 5 tier-2 ERA postings this week
        remits = sorted(
            (
                r
                for r in self.b.w.of(Remittance)
                if r.received_at.date() >= T.WEEK_START and r.kind.value == "835" and r.lines
            ),
            key=lambda r: (r.received_at, r.id),
        )
        for r in remits[:5]:
            self.run(
                f"run_posting_{r.id}",
                AG.POSTING,
                A.POST_ERA_LINE,
                r.received_at + timedelta(minutes=20),
                remittance_id=r.id,
                rule_id="rule_t2_post_era",
                verdict=PolicyVerdict.EXECUTE,
                situation="era:balanced",
                outcome="Posted",
                summary=f"Matched {len(r.lines)} lines to contract; balanced.",
                audit=f"Posting · Post ERA line · {r.id} · {r.payer_key.value} · ${r.amount_cents / 100:,.2f} · rule Post ERA v1 (auto, signed Dr. Morgan 06/11) · until day close",
            )

    def routine_runs(self) -> None:
        owens = self.claims[4821]
        self.run(
            "run_followup_4821_ivr",
            AG.FOLLOWUP,
            A.STATUS_CHECK,
            dt(date(2026, 10, 27), "16:02"),
            claim=owens,
            rule_id="rule_t1_status_check",
            verdict=PolicyVerdict.EXECUTE,
            situation="denied:CO-16:N29:pa_missing",
            outcome="No change",
            summary="IVR status check: denied 10/26, $0 paid.",
            audit=self.audit_line(AG.FOLLOWUP, A.STATUS_CHECK, owens, "IVR", "approved by Dana S."),
            evidence=["ev_4821_ivr"],
            trigger=RunTrigger.APPROVAL,
        )
        self.run(
            "run_followup_4821_rep",
            AG.FOLLOWUP,
            A.PAYER_REP_CALL,
            dt(date(2026, 10, 27), "16:20"),
            claim=owens,
            rule_id="rule_t1_payer_rep_call",
            verdict=PolicyVerdict.EXECUTE,
            situation="denied:CO-16:N29:pa_missing",
            outcome="Confirmed",
            summary="Rep call ref DD-1027-88412: send PA via NEA, resubmit.",
            audit=self.audit_line(
                AG.FOLLOWUP, A.PAYER_REP_CALL, owens, "ref DD-1027-88412", "rule Payer rep call v1 (auto)"
            ),
            evidence=["ev_4821_rep"],
        )
        brooks = self.claims[4705]
        self.run(
            "run_followup_4705_portal",
            AG.FOLLOWUP,
            A.STATUS_CHECK,
            dt(date(2026, 10, 26), "14:30"),
            claim=brooks,
            rule_id="rule_t1_status_check",
            verdict=PolicyVerdict.EXECUTE,
            situation="pending:status_due",
            outcome="No change",
            summary="Portal status check: still pending (day 63).",
            audit=self.audit_line(AG.FOLLOWUP, A.STATUS_CHECK, brooks, "portal", "approved by Dana S."),
            evidence=["ev_4705_portal"],
            trigger=RunTrigger.APPROVAL,
        )
        ito_appt = next(a for a, _ in self._appointments if a.patient_id == "pat_ito_w")
        self.run(
            "run_elig_running_ito",
            AG.ELIGIBILITY,
            A.ELIGIBILITY_CHECK,
            dt(TODAY, "10:38"),
            patient_id=ito_appt.patient_id,
            rule_id="rule_t1_eligibility_check",
            verdict=PolicyVerdict.EXECUTE,
            situation="eligibility:recheck",
            outcome="Checking…",
            summary="Cigna portal slow; retrying.",
            audit="",
            status=RunStatus.RUNNING,
        )

    def audit(self) -> None:
        rows = [
            (
                dt(date(2026, 10, 26), "10:02"),
                USR_DANA,
                "rule.change",
                "rule",
                "rule_t1_send_claim",
                "Approved rule change: Delta D27xx crowns → attach PA, not BWX",
            ),
            (
                dt(date(2026, 10, 27), "17:05"),
                USR_MORGAN,
                "rule.signoff",
                "rule",
                "rule_t2_mechanical_refund",
                "Signed: mechanical refund to the original tender ≤ $100",
            ),
            (
                dt(date(2026, 10, 27), "15:05"),
                USR_DANA,
                "inbox.approve",
                "claim",
                "clm_4690",
                "Approved & sent appeal (from last week)",
            ),
            (
                dt(TODAY, "10:12"),
                USR_DANA,
                "inbox.edit_note",
                "patient",
                "pat_chen_j",
                "Edited J. Chen front-desk note (not sent yet)",
            ),
            (
                dt(date(2026, 10, 26), "08:30"),
                USR_TASHA,
                "eligibility.view",
                "appointment",
                "apt_1029_chen_j",
                "Opened J. Chen benefits",
            ),
            (
                dt(date(2026, 10, 9), "15:20"),
                USR_MORGAN,
                "claim.write_off",
                "claim",
                "clm_4166",
                "Wrote off $310.00 (CO-29, timely filing)",
            ),
            (
                dt(date(2026, 10, 16), "15:20"),
                USR_MORGAN,
                "claim.write_off",
                "claim",
                "clm_4193",
                "Wrote off $310.00 (CO-50, appeal declined)",
            ),
            (
                dt(date(2026, 10, 15), "11:00"),
                USR_LEE,
                "appeal.sign",
                "claim",
                "clm_4716",
                "Signed & filed formal appeal (level 1)",
            ),
        ]
        for i, (at, actor, action, stype, sid, detail) in enumerate(rows, 1):
            self.b.w.add(
                AuditEvent(
                    id=f"aud_{i:04d}",
                    at=at,
                    actor=actor,
                    action=action,
                    subject_type=stype,
                    subject_id=sid,
                    detail=detail,
                )
            )


_ELIG_NOTES = {
    "chen": "Planned work exceeds remaining max by $470.",
    "kim": "D0274 frequency: next eligible 11/03.",
    "park": "Portal down; unverified.",
}


def _estimate(cov: Coverage, planned_cents: int, flag: str | None) -> tuple[int, int]:
    if flag == "chen":
        return 18_000, 47_000
    insurance = min(round(planned_cents * 0.62), cov.plan.remaining_max_cents)
    return insurance, planned_cents - insurance


def build_agent_state(b: Builder, pinned: Pinned) -> None:
    AgentSeed(b, pinned).build()
