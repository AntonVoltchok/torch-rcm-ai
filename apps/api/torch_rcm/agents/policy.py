"""Policy: the only thing that decides whether an action runs.

Principle: the model proposes; code gates and executes. `decide()` is a pure function of the
practice's rules, the action's catalog entry and code-computed facts (tier, root cause, cents, base
rate, hold window). It never calls the world or a model. The decision table (07 §5.1) is data:
`ROWS` is evaluated top-down and the first row whose predicate matches decides.

Also here, because they are policy and must be impossible to bypass:
- `assert_invariants()` — rules-table invariants, raised as `PolicyInvariantError` at boot and in tests;
  the table's own invariants are asserted at import.
- `guard_root_cause_ours()` — root cause `ours` can never be learned into auto-run.
- `route_rule_patch()` / `apply_rule_patch()` / `signoff_item()` — owner sign-off routing.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from pydantic import Field, ValidationError

from torch_rcm.agents.catalog.actions import ACTIONS, AGENT_ACTIONS, TIER3_ROLES, ActionSpec, spec_for
from torch_rcm.agents.types import (
    UNKNOWN,
    AgentKind,
    Confidence,
    Decision,
    Evidence,
    Frozen,
    GuardResult,
    InboxItemDraft,
    JsonValue,
    PayerKey,
    ProposedAction,
    RootCause,
    RuleView,
    Verdict,
)

PRACTICE_CAP_CENTS = 100_000  # tier-2 practice cap ($1,000); tier 1 is exempt
MIN_BASE_RATE_N = 5
RunKind = Literal["triage", "approval", "manual"]


class PolicyInvariantError(AssertionError):
    """A rules table (or this module's table) violates an invariant. Raised at boot and in tests."""


class RootCauseGuardError(ValueError):
    """Root cause `ours` can never be learned into auto-run (API maps this to 422 root_cause_guard)."""


class PolicyCtx(Frozen):
    """Code facts the policy decides on. Nothing here is model output except `model_situation`."""

    agent: AgentKind
    run_kind: RunKind
    paused: bool = False
    actor_id: str | None = None
    actor_role: str | None = None
    classifier_situation: str = UNKNOWN
    model_situation: str | None = None
    root_cause: RootCause = "unknown"
    payer_key: PayerKey | None = None
    item_type: str = "all"
    cents: int = 0
    scope_ids: frozenset[str] = frozenset()
    evidence: Mapping[str, Evidence] = Field(default_factory=dict)
    expected_values: Mapping[str, JsonValue] = Field(default_factory=dict)
    paper_eob: bool = False
    hold_window_open: bool | None = None
    draft_guard: GuardResult | None = None
    rules: tuple[RuleView, ...] = ()
    practice_cap_cents: int = PRACTICE_CAP_CENTS


# ---------------------------------------------------------------- rule matching and confidence


def _specificity(rule: RuleView) -> tuple[int, int]:
    s = rule.scope
    score = (4 if s.payer_key else 0) + (2 if s.item_type != "all" else 0) + (1 if s.max_cents else 0)
    return score, rule.version


def match_rule(
    rules: tuple[RuleView, ...] | list[RuleView], action: str, payer_key: PayerKey | None, item_type: str
) -> RuleView | None:
    """Most-specific wins: payer×item_type×max_cents > payer×item_type > item_type > all.

    `max_cents` is not a filter: an over-cap amount still matches its rule and is stopped by row 11,
    so it can never fall through to a broader rule that might auto-run it.
    """
    candidates = [
        r
        for r in rules
        if r.action == action
        and (r.scope.payer_key is None or r.scope.payer_key == payer_key)
        and r.scope.item_type in ("all", item_type)
    ]
    return max(candidates, key=_specificity, default=None)


_METRIC_PHRASE = {"paid_30d": "paid within 30 d", "accepted": "accepted", "balanced": "balanced"}


def confidence(rule: RuleView | None) -> Confidence | None:
    """The rule's base rate, never a model number. Shown as 'no base rate' when n < 5."""
    if rule is None:
        return None
    rate = rule.base_rate
    if rate is None or rate.n < MIN_BASE_RATE_N:
        n = rate.n if rate else 0
        return Confidence(pct=None, basis=f"no base rate (n={n})")
    phrase = _METRIC_PHRASE.get(rule.outcome_metric or "", "succeeded")
    return Confidence(pct=round(100 * rate.k / rate.n), basis=f"{rate.k} of {rate.n} {phrase}")


# ---------------------------------------------------------------- row 1: validation backstop


def validation_errors(ctx: PolicyCtx, action: ProposedAction) -> list[str]:
    """Row 1. The live loop validates before this; policy re-checks so no path can skip it.

    Triage runs may only use the agent's own catalog. Approval/manual runs execute what a person approved:
    the action must exist in the catalog (and a tier-3 action needs a role holder), whichever agent drafted it.
    """
    spec = spec_for(action.action)
    if spec is None:
        return [f"{action.action} is not an action TorchRCM can run"]
    if ctx.run_kind == "triage" and action.action not in AGENT_ACTIONS[ctx.agent]:
        return [f"{action.action} is not available to {ctx.agent.capitalize()}"]
    try:
        params = spec.params.model_validate(action.params)
    except ValidationError as exc:
        return [f"params: {'.'.join(str(p) for p in e['loc'])} {e['msg']}" for e in exc.errors()]
    errors = _scope_errors(ctx, params.model_dump())
    errors += _value_errors(ctx, spec, params.model_dump())
    errors += [f"evidence {e} was not gathered in this run" for e in action.evidence_ids if e not in ctx.evidence]
    if spec.tier == 3 and ctx.run_kind != "triage" and ctx.actor_role not in TIER3_ROLES[spec.name]:
        errors.append(f"actor lacks role for {spec.label.lower()}")
    return errors


def _scope_errors(ctx: PolicyCtx, params: Mapping[str, object]) -> list[str]:
    errors: list[str] = []
    for key, value in params.items():
        if value is None or not key.endswith(("_id", "_ids")):
            continue
        ids = value if isinstance(value, list) else [value]
        errors += [f"{key}={v} is outside this run's subject" for v in ids if v not in ctx.scope_ids]
    return errors


def _value_errors(ctx: PolicyCtx, spec: ActionSpec, params: Mapping[str, object]) -> list[str]:
    """A demographic or amount param must equal its evidence value. A triage run may not propose a value code
    cannot source; a person's approval may carry one only where code has no value to compare (07 §5.1 row 1)."""
    checks: list[tuple[str, object]] = []
    if spec.name == "fix_demographics_resend":
        checks.append((f"{params.get('source', 'pms')}.{params['field']}", params["value"]))
    if spec.amount_param:
        checks.append((f"amount.{spec.name}", params[spec.amount_param]))
    errors: list[str] = []
    for key, value in checks:
        if key in ctx.expected_values:
            if ctx.expected_values[key] != value:
                errors.append(f"{key} must equal its evidence value")
        elif ctx.run_kind == "triage":
            errors.append(f"{key} has no evidence value in this run")
    return errors


# ---------------------------------------------------------------- the decision table (07 §5.1)

type Predicate = Callable[[PolicyCtx, ProposedAction, ActionSpec, RuleView | None], str | None]


@dataclass(frozen=True)
class PolicyRow:
    number: int
    condition: str
    verdict: Verdict
    predicate: Predicate
    approval_recheck: bool = False
    review_draft: bool = False


def _cites_only_suspicious(ctx: PolicyCtx, a: ProposedAction) -> bool:
    cited = [ctx.evidence[e] for e in a.evidence_ids if e in ctx.evidence]
    return bool(cited) and all(e.suspicious for e in cited)


def _carries_text(spec: ActionSpec, ctx: PolicyCtx) -> bool:
    return spec.carries_text is not None or ctx.draft_guard is not None


def _observes(rule: RuleView | None) -> bool:
    """Observe does nothing, so rows 4 and 5, which would open an item, yield to row 7 (07 §5.1)."""
    return rule is not None and rule.mode == "observe"


def observing_rule(
    rules: tuple[RuleView, ...] | list[RuleView], agent: AgentKind, payer_key: PayerKey | None, item_type: str
) -> RuleView | None:
    """A rule on `observe` that could decide this run. Reading a payer's portal is payer contact and it comes
    before the plan, so the deciding rule is not known yet: any rule that could be it withholds the read."""
    matched = (match_rule(rules, action, payer_key, item_type) for action in AGENT_ACTIONS[agent])
    return next((r for r in matched if _observes(r)), None)


def _row0(ctx: PolicyCtx, a: ProposedAction, s: ActionSpec, r: RuleView | None) -> str | None:
    return "agents paused by the practice" if ctx.paused else None


def _row1(ctx: PolicyCtx, a: ProposedAction, s: ActionSpec, r: RuleView | None) -> str | None:
    errors = validation_errors(ctx, a)
    return "refused: " + "; ".join(errors) if errors else None


def _row2(ctx: PolicyCtx, a: ProposedAction, s: ActionSpec, r: RuleView | None) -> str | None:
    if s.tier == 3 and ctx.run_kind == "triage":
        return f"tier 3 · {s.label.lower()} is human only; prepared for the {s.role_required or 'owner'}"
    return None


def _row3(ctx: PolicyCtx, a: ProposedAction, s: ActionSpec, r: RuleView | None) -> str | None:
    if s.tier == 3 and ctx.run_kind != "triage" and ctx.actor_role in TIER3_ROLES[s.name]:
        return f"tier 3 · started by {ctx.actor_id} ({ctx.actor_role})"
    return None


def _row4(ctx: PolicyCtx, a: ProposedAction, s: ActionSpec, r: RuleView | None) -> str | None:
    if _observes(r):
        return None
    return "paper EOB is never auto-posted" if ctx.paper_eob and s.name == "post_era_line" else None


def _row5(ctx: PolicyCtx, a: ProposedAction, s: ActionSpec, r: RuleView | None) -> str | None:
    if _observes(r):
        return None
    if ctx.classifier_situation == UNKNOWN:
        return "situation unknown to TorchRCM's classifier · a person reviews"
    if _cites_only_suspicious(ctx, a):
        return "cites only suspicious evidence · a person reviews"
    return None


def _row6(ctx: PolicyCtx, a: ProposedAction, s: ActionSpec, r: RuleView | None) -> str | None:
    return "no rule" if r is None and s.tier is not None else None


def _row7(ctx: PolicyCtx, a: ProposedAction, s: ActionSpec, r: RuleView | None) -> str | None:
    return f"observe mode · rule {r.label}" if r and _observes(r) else None


def _row8(ctx: PolicyCtx, a: ProposedAction, s: ActionSpec, r: RuleView | None) -> str | None:
    return f"rule {r.label} is {r.mode.replace('_', ' ')}" if r and r.mode in ("ask", "human_only") else None


def _row9(ctx: PolicyCtx, a: ProposedAction, s: ActionSpec, r: RuleView | None) -> str | None:
    if not _carries_text(s, ctx):
        return None
    if ctx.draft_guard is not None and not ctx.draft_guard.ok:
        return "agent text failed the fact check"
    if r is None or not (r.covers_agent_text and r.signed_by):
        return "agent-written text · no owner-signed text rule covers it"
    return None


def _row10(ctx: PolicyCtx, a: ProposedAction, s: ActionSpec, r: RuleView | None) -> str | None:
    return "root cause: ours · fix the upstream rule" if ctx.root_cause == "ours" else None


def _row11(ctx: PolicyCtx, a: ProposedAction, s: ActionSpec, r: RuleView | None) -> str | None:
    if s.name == "fix_demographics_resend" and a.params.get("source", "pms") != "pms":
        return "outside the rule: the value is not the PMS field"
    if r and r.scope.max_cents is not None and ctx.cents > r.scope.max_cents:
        return f"over cap (${r.scope.max_cents // 100:,})"
    if s.tier == 2 and ctx.cents > ctx.practice_cap_cents:
        return f"over the practice cap (${ctx.practice_cap_cents // 100:,})"
    return None


def _row12(ctx: PolicyCtx, a: ProposedAction, s: ActionSpec, r: RuleView | None) -> str | None:
    if r is None or r.confidence_floor is None:
        return None
    conf = confidence(r)
    if conf is None or conf.pct is None:
        return "no base rate for a rule with a confidence floor"
    floor = round(r.confidence_floor * 100)
    return f"confidence {conf.pct}% is below the {floor}% floor" if conf.pct < floor else None


def _row13(ctx: PolicyCtx, a: ProposedAction, s: ActionSpec, r: RuleView | None) -> str | None:
    if ctx.model_situation is not None and ctx.model_situation != ctx.classifier_situation:
        return "agent and classifier disagree"
    return None


def _row14(ctx: PolicyCtx, a: ProposedAction, s: ActionSpec, r: RuleView | None) -> str | None:
    if s.needs_hold_window and ctx.hold_window_open is False:
        return "file departed · the hold window is closed"
    return None


def _row15(ctx: PolicyCtx, a: ProposedAction, s: ActionSpec, r: RuleView | None) -> str | None:
    if ctx.run_kind != "triage":
        return "approved by a person"
    if r is None:
        # only a tier-less internal action reaches here (row 6 catches every rule-governed one)
        return "internal hold · no world call" if s.tier is None else None
    return f"rule {r.label} v{r.version} (auto)"


ROWS: tuple[PolicyRow, ...] = (
    PolicyRow(0, "Practice kill switch on", "park", _row0, approval_recheck=True),
    PolicyRow(
        1,
        "Not in catalog; params invalid; out of scope; value ≠ evidence",
        "refuse",
        _row1,
        approval_recheck=True,
    ),
    PolicyRow(2, "Tier 3, agent-started", "propose", _row2),
    PolicyRow(3, "Tier 3, human-started by a role holder", "execute", _row3, approval_recheck=True),
    PolicyRow(4, "Posting from a paper EOB", "propose", _row4),
    PolicyRow(5, "Classifier returned unknown, or only suspicious evidence cited", "propose", _row5),
    PolicyRow(6, "No matching rule", "propose", _row6),
    PolicyRow(7, "mode=observe", "observe", _row7, approval_recheck=True),
    PolicyRow(8, "mode=human_only or ask", "propose", _row8),
    PolicyRow(
        9,
        "auto; agent text not covered by an owner-signed text rule, or guard failed",
        "propose",
        _row9,
        review_draft=True,
    ),
    PolicyRow(10, "auto; root_cause=ours", "propose", _row10),
    PolicyRow(
        11,
        "auto; over the rule's cap or the tier-2 practice cap, or outside the rule's value source",
        "propose",
        _row11,
    ),
    PolicyRow(12, "auto; confidence below floor, or no base rate with a floor", "propose", _row12),
    PolicyRow(13, "auto; live model's situation ≠ classifier's", "propose", _row13),
    PolicyRow(14, "auto; hold window closed for an action that needs it", "refuse", _row14, approval_recheck=True),
    PolicyRow(15, "otherwise", "execute", _row15, approval_recheck=True),
)


def decide(ctx: PolicyCtx, action: ProposedAction) -> Decision:
    """Evaluate `ROWS` top-down; the first match decides. Approval runs re-check rows 0, 1, 3, 7, 14, 15.

    Row 7 is re-checked on approval because Observe mode does nothing: an item proposed under a rule that has
    since been switched to `observe` records `would_have_run` when approved, and never reaches the world.
    """
    spec = spec_for(action.action)
    if spec is None:
        return Decision(verdict="refuse", reason=f"refused: {action.action} is not an action", policy_row=1)
    rule = match_rule(ctx.rules, action.action, ctx.payer_key, ctx.item_type)
    rows = ROWS if ctx.run_kind == "triage" else tuple(r for r in ROWS if r.approval_recheck)
    for row in rows:
        reason = row.predicate(ctx, action, spec, rule)
        if reason is None:
            continue
        return Decision(
            verdict=row.verdict,
            reason=reason,
            policy_row=row.number,
            rule_id=rule.id if rule else None,
            rule_version=rule.version if rule else None,
            confidence=confidence(rule),
            as_review_draft=row.review_draft or (row.verdict == "propose" and _carries_text(spec, ctx)),
            alternatives=("corrected_claim",) if row.number == 14 else (),
        )
    raise PolicyInvariantError("decision table has no terminal row")  # pragma: no cover


class Policy:
    """Object form of the functions above, bound to a rules snapshot (07 §10)."""

    def __init__(self, rules: list[RuleView]) -> None:
        assert_invariants(rules)
        self.rules = tuple(rules)

    def match_rule(self, action: str, payer_key: PayerKey | None, item_type: str) -> RuleView | None:
        return match_rule(self.rules, action, payer_key, item_type)

    def decide(self, ctx: PolicyCtx, action: ProposedAction) -> Decision:
        return decide(ctx.model_copy(update={"rules": self.rules}), action)

    def confidence(self, rule: RuleView | None) -> Confidence | None:
        return confidence(rule)

    def assert_invariants(self, rules: list[RuleView]) -> None:
        assert_invariants(rules)


# ---------------------------------------------------------------- invariants


def assert_invariants(rules: list[RuleView] | tuple[RuleView, ...]) -> None:
    """Asserts, not rows (07 §5.1). Raised at rule load (boot) and in the rules repository."""
    problems: list[str] = []
    for r in rules:
        spec = ACTIONS.get(r.action)
        if spec is None:
            problems.append(f"{r.id}: unknown action {r.action}")
            continue
        if (spec.tier == 3 or r.tier == 3) and r.mode != "human_only":
            problems.append(f"{r.id}: tier-3 rule must be human_only (is {r.mode})")
        if spec.tier is not None and r.tier != spec.tier:
            problems.append(f"{r.id}: tier {r.tier} ≠ catalog tier {spec.tier} for {r.action}")
        if r.tier == 2 and r.mode == "auto" and not r.signed_by:
            problems.append(f"{r.id}: tier-2 auto rule lacks an owner signature")
        if r.origin == "learned" and r.outcome_metric in (None, "none"):
            problems.append(f"{r.id}: learned rule without an outcome metric")
        if r.origin == "learned" and r.tier != 1:
            problems.append(f"{r.id}: only tier-1 rules can be learned")
    if problems:
        raise PolicyInvariantError("; ".join(problems))


def _assert_table_invariants() -> None:
    """The table itself: rows contiguous, last row total, tier-3 never reaches an agent auto path."""
    if [r.number for r in ROWS] != list(range(len(ROWS))):
        raise PolicyInvariantError("policy rows must be numbered 0..n in order")
    if ROWS[-1].verdict != "execute" or ROWS[2].verdict != "propose" or ROWS[3].verdict != "execute":
        raise PolicyInvariantError("rows 2/3/15 changed meaning")
    for name, spec in ACTIONS.items():
        if spec.tier == 3 and not TIER3_ROLES.get(name):
            raise PolicyInvariantError(f"tier-3 action {name} has no role holder")
    for agent, actions in AGENT_ACTIONS.items():
        missing = [a for a in actions if a not in ACTIONS]
        if missing:
            raise PolicyInvariantError(f"{agent} lists unknown actions {missing}")


_assert_table_invariants()


# ---------------------------------------------------------------- root-cause guard (learning)


def guard_root_cause_ours(root_cause_class: str) -> None:
    """Root cause `ours` can never be learned into auto-run; accepting such a proposal is a 422."""
    if root_cause_class == "ours":
        raise RootCauseGuardError("root cause is ours: fix the upstream rule; this slice cannot auto-run")


# ---------------------------------------------------------------- owner sign-off routing (07 §5.2)

PatchRoute = Literal["apply", "needs_owner_signoff", "human_only"]


class RulePatch(Frozen):
    mode: str | None = None
    max_cents: int | None = None
    confidence_floor: float | None = None


def route_rule_patch(rule: RuleView, actor_role: str | None) -> PatchRoute:
    """Tier 3 rejects every patch (403); tier 2 needs the owner (409 → owner_signoff item)."""
    if rule.tier == 3:
        return "human_only"
    if rule.tier == 2 and actor_role != "owner":
        return "needs_owner_signoff"
    return "apply"


def apply_rule_patch(rule: RuleView, patch: RulePatch, by: str, by_role: str | None, at: datetime) -> RuleView:
    """Apply a routed patch. An owner patch on tier 2 signs it; any other change to a signed row clears
    the signature and drops it to `ask`. Result is re-checked against the invariants."""
    if route_rule_patch(rule, by_role) != "apply":
        raise PolicyInvariantError(f"patch on {rule.id} by {by} must be routed first")
    scope = rule.scope.model_copy(update={"max_cents": patch.max_cents}) if patch.max_cents is not None else rule.scope
    update: dict[str, object] = {"scope": scope, "version": rule.version + 1}
    if patch.mode is not None:
        update["mode"] = patch.mode
    if patch.confidence_floor is not None:
        update["confidence_floor"] = patch.confidence_floor
    if rule.tier == 2 and by_role == "owner":
        update |= {"signed_by": by, "signed_at": at}
    elif rule.signed_by:
        update |= {"signed_by": None, "signed_at": None, "mode": "ask"}
    new = rule.model_copy(update=update)
    assert_invariants([new])
    return new


def agent_for_action(action: str) -> AgentKind:
    """The agent whose catalog owns an action (first listed wins; used for item attribution)."""
    return next((a for a, acts in AGENT_ACTIONS.items() if action in acts), "followup")


def signoff_item(rule: RuleView, patch: RulePatch, by: str) -> InboxItemDraft:
    """The `owner_signoff` item a non-owner tier-2 patch creates for Dr. Morgan (before → after)."""
    after = ", ".join(f"{k} → {v}" for k, v in patch.model_dump(exclude_none=True).items())
    return InboxItemDraft(
        kind="owner_signoff",
        agent=agent_for_action(rule.action),
        title=f"Sign-off: {rule.label}",
        recommendation=f"{rule.label}: {rule.mode} → {after} (requested by {by})",
        tier=2,
        assignee_role="owner",
    )
