"""Situation classification, root cause and required evidence — code facts, computed before any
planner runs.

Principle: the model proposes; code gates and executes. `classify()` reads only structured data
(CARC·RARC via `torch.domain.routing.route_denial`, claim status, the structured 277 category, payer
rules, the trigger). It never parses free text, so a portal page that says "pended" or "adjusted"
leaves the classifier at `unknown` and the run in the model's (or a recorded plan's) hands — with
policy row 5 guaranteeing a person reviews the result. Root cause comes from WorldCallLog provenance:
"the payer rule named X and our agent sent Y" is `ours`.

A situation key is also the rules table's `item_type` (the seeded Delta missing-PA rule is scoped to
`denied:CO-16:N29:pa_missing`), so rule matching and classification can never drift apart.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta

from torch.domain.enums import NextAction
from torch.domain.enums import PayerKey as DomainPayerKey
from torch.domain.enums import RootCause as DomainRootCause
from torch.domain.routing import route_denial
from torch.agents.types import (
    UNKNOWN,
    AgentKind,
    ClaimView,
    CoverageView,
    DeadlineView,
    EvidenceKind,
    PayerRuleView,
    PayerView,
    Provenance,
    RootCause,
)

STALE_ATTACHMENT = timedelta(days=183)


@dataclass(frozen=True)
class Situation:
    key: str
    required_evidence: tuple[EvidenceKind, ...] = ()
    judgment: bool = False  # live mode plans with the model for this key (07 §2 "Planner by mode")
    label: str = ""

    @property
    def item_type(self) -> str:
        return self.key


SITUATIONS: dict[AgentKind, tuple[Situation, ...]] = {
    "followup": (
        Situation(
            "denied:CO-16:N29:pa_missing", ("era_line", "pms_record"), True, "denied: pre-op PA missing"
        ),
        Situation(
            "denied:CO-16:M127:records_request", ("era_line", "pms_record"), True, "denied: payer asks for records"
        ),
        Situation(
            "denied:CO-119:frequency_history_conflict", ("era_line", "prior_eob"), True, "frequency vs tooth history"
        ),
        Situation("denied:CO-22:cob_order", ("era_line", "pms_record"), True, "coordination of benefits"),
        Situation("pending:status_due", (), False, "status check due"),
        Situation("pending:prompt_pay_eligible", ("policy_clause",), False, "NY prompt-pay eligible"),
        Situation("pending:adjudicated_no_835", (), False, "adjudicated, no 835 on file"),
    ),
    "appeals": (
        Situation("denied:CO-50:N10:formal_appeal", ("era_line", "note_excerpt"), False, "medical necessity"),
        Situation("denied:CO-29:timely_filing_appeal", ("era_line",), False, "timely filing"),
    ),
    "claims": (
        Situation("rejected:A7:164:subscriber_id", ("pms_record",), True, "clearinghouse reject: subscriber id"),
        Situation("checkout:clean", (), False, "clean claim"),
    ),
    "eligibility": (Situation("eligibility:verify", (), False, "verify benefits"),),
    "posting": (
        Situation("era:balanced", ("era_line",), False, "balanced remittance"),
        Situation("era:variance", ("era_line",), False, "posting variance"),
    ),
}


def situation(agent: AgentKind, key: str) -> Situation | None:
    return next((s for s in SITUATIONS[agent] if s.key == key), None)


def situation_keys(agent: AgentKind) -> list[str]:
    return [s.key for s in SITUATIONS[agent]] + [UNKNOWN]


def item_type_for(agent: AgentKind, key: str) -> str:
    """The rules-table item type is the situation key itself (unknown matches only `all` rules)."""
    return key


def required_evidence(agent: AgentKind, key: str) -> tuple[EvidenceKind, ...]:
    s = situation(agent, key)
    return s.required_evidence if s else ()


def label_for(agent: AgentKind, key: str) -> str:
    s = situation(agent, key)
    return s.label if s else "situation Torch cannot name"


def is_judgment(agent: AgentKind, key: str) -> bool:
    s = situation(agent, key)
    return key == UNKNOWN or bool(s and s.judgment)


# ---------------------------------------------------------------- classify


def _rule_attachment(claim: ClaimView, rules: Sequence[PayerRuleView]) -> str | None:
    for rule in rules:
        if rule.topic == "attachments" and rule.requires_attachment:
            if any(line.cdt.startswith(rule.cdt_prefixes) for line in claim.lines):
                return rule.requires_attachment
    return None


def _classify_denial(agent: AgentKind, claim: ClaimView, rules: Sequence[PayerRuleView], self_funded: bool) -> str:
    """CARC·RARC → the one shared router (Denials worklist uses the same function), then a per-agent key."""
    d = claim.denial
    assert d is not None
    carc = f"{d.group}-{d.carc}"
    route = route_denial(
        carc,
        d.rarc,
        root_cause=DomainRootCause.UNKNOWN,
        payer=DomainPayerKey(claim.payer_key),
        self_funded=self_funded,
    )
    if route.agent.value != agent:
        return UNKNOWN
    if agent == "followup":
        if carc == "CO-16" and d.rarc == "N29" and _rule_attachment(claim, rules) == "pa":
            return "denied:CO-16:N29:pa_missing"
        if carc == "CO-16" and d.rarc == "M127":
            return "denied:CO-16:M127:records_request"
        if carc == "CO-119":
            return "denied:CO-119:frequency_history_conflict"
        if carc == "CO-22" and route.next_action is NextAction.CORRECTED:
            return "denied:CO-22:cob_order"
    if agent == "appeals" and route.next_action is NextAction.FORMAL_APPEAL:
        if carc == "CO-50" and d.rarc == "N10":
            return "denied:CO-50:N10:formal_appeal"
        if carc == "CO-29":
            return "denied:CO-29:timely_filing_appeal"
    return UNKNOWN


def _classify_pending(claim: ClaimView, coverages: Sequence[CoverageView], today: date, trigger_kind: str) -> str:
    if claim.has_free_text_status:
        return UNKNOWN  # payer correspondence that maps to no structured category: a judgment call
    age = (today - claim.sent_at.date()).days if claim.sent_at else 0
    category = claim.status_category
    if category == "finalized":
        return "pending:adjudicated_no_835"
    if category not in (None, "in_process"):
        return UNKNOWN
    insured = any(c.plan_type == "ppo" and c.order == "primary" for c in coverages)
    if trigger_kind == "claim.status_check_due" and age >= 30:
        return "pending:status_due"
    if category == "in_process" and insured and age >= 45:
        return "pending:prompt_pay_eligible"
    if age >= 30:
        return "pending:status_due"
    return UNKNOWN


def classify(
    agent: AgentKind,
    claim: ClaimView | None,
    coverages: Sequence[CoverageView],
    rules: Sequence[PayerRuleView],
    today: date,
    *,
    trigger_kind: str = "manual",
    self_funded: bool = False,
) -> str:
    """Closed per-agent situation key, or `unknown`. Structured data only."""
    if claim is None:
        return {"eligibility": "eligibility:verify"}.get(agent, UNKNOWN)
    if claim.status == "denied" and claim.denial is not None:
        return _classify_denial(agent, claim, rules, self_funded)
    if agent == "followup" and claim.status == "pending":
        return _classify_pending(claim, coverages, today, trigger_kind)
    if agent == "claims" and claim.status == "rejected":
        return "rejected:A7:164:subscriber_id" if claim.status_category == "A7:164" else UNKNOWN
    if agent == "claims" and claim.status == "ready":
        return "checkout:clean"
    return UNKNOWN


# ---------------------------------------------------------------- root cause and deadlines


def root_cause(claim: ClaimView | None, rules: Sequence[PayerRuleView], provenance: Sequence[Provenance]) -> RootCause:
    """`ours` when a payer rule named an attachment and our agent sent something else (or a stale one)."""
    if claim is None or claim.denial is None:
        return "unknown"
    if claim.denial.group == "PR":
        return "patient"
    if claim.denial.carc != "16":
        return "payer"
    sent = [p for p in provenance if p.actor == "agent" and p.attachment_kind]
    required = _rule_attachment(claim, rules)
    if required and sent and not any(p.attachment_kind == required for p in sent):
        return "ours"
    stale = [p for p in sent if p.attachment_date and p.attachment_date < claim.dos - STALE_ATTACHMENT]
    return "ours" if stale else "payer"


def deadlines(claim: ClaimView | None, payer: PayerView | None) -> tuple[DeadlineView, ...]:
    if claim is None or payer is None:
        return ()
    out: list[DeadlineView] = []
    if claim.denial and claim.denial.denied_on:
        due = claim.denial.denied_on + timedelta(days=payer.appeal_window_days)
        out.append(DeadlineView(kind="appeal", due_on=due, basis=f"{payer.appeal_window_days} d from denial"))
    if claim.timely_filing_due:
        out.append(DeadlineView(kind="timely_filing", due_on=claim.timely_filing_due, basis="payer timely filing"))
    return tuple(out)
