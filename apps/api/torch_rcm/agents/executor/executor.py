"""Executor: one run, from case file to audit line, resumable and park-aware (07 §4, §8, §9).

Principle: the model proposes; code gates and executes. The pipeline is fixed: `gather_case` → `investigate`
(the planner's reads stream as progress lines; they are not extra steps) → `decide` (policy, per action) →
one `act:*` step per recipe step of every action policy said to execute → `report`. Only recipe steps call
`WorldPort.act`, each with the idempotency key `{run_id}:{step_idx}:{op}`, so a re-run after a crash returns
the stored world result (the same NEA#) instead of acting twice.

After every step the run saves a checkpoint pinned to `{model, effort, thinking, system_sha, tools_sha}` holding
the plan, the decisions and the recipe outputs; a restart continues from the last `ok` step. The audit line,
confidence (rule base rates only) and result text are built in code.
"""

from __future__ import annotations

import asyncio
import hashlib
import itertools
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any, Literal

from torch_rcm.agents.case import build_case
from torch_rcm.agents.catalog.actions import spec_for
from torch_rcm.agents.catalog.recipes import DOMAIN_OP_HOLD, RecipeCtx, RecipeStep, recipe_for
from torch_rcm.agents.catalog.situations import is_judgment, label_for, root_cause_finding
from torch_rcm.agents.guardrails import guard_draft
from torch_rcm.agents.planner.base import EvidenceSet, Planner, PlannerFallback, Reader, ReadResult
from torch_rcm.agents.planner.scripted import (
    RecordedPlanPlanner,
    ScriptedPlanner,
    code_result,
    has_script,
    scripted_pin,
)
from torch_rcm.agents.policy import PolicyCtx, decide
from torch_rcm.agents.ports import WorldCallResult, WorldUnavailable
from torch_rcm.agents.tools.registry import candidate_is_suspicious
from torch_rcm.agents.types import (
    UNKNOWN,
    CaseFile,
    Decision,
    Draft,
    Evidence,
    EvidenceCandidate,
    JsonValue,
    Pin,
    Plan,
    ProposedAction,
    RunOutcome,
    StepResult,
    Subject,
)
from torch_rcm.domain.entities import ROOT_CAUSE_RECORDED, AuditEvent, Claim, InboxItem, Run
from torch_rcm.domain.enums import (
    InboxItemKind,
    InboxItemState,
    RootCause,
    RuleAction,
    RunStatus,
    RunTrigger,
    StepStatus,
    Tier,
)
from torch_rcm.domain.values import Confidence as DomainConfidence
from torch_rcm.domain.values import ProposedAction as DomainProposedAction
from torch_rcm.domain.values import Usage as DomainUsage
from torch_rcm.events import FIREHOSE

if TYPE_CHECKING:
    from torch_rcm.agents.runtime import AgentRuntime, Checkpoint

PIPELINE: list[tuple[str, str, str]] = [
    ("gather_case", "Gather the case", "case"),
    ("investigate", "Investigate", "planner"),
    ("decide", "Decide", "policy"),
]
GATHER, INVESTIGATE, DECIDE = 0, 1, 2
AGENT_LABEL = {
    "eligibility": "Eligibility",
    "claims": "Claims",
    "followup": "Follow-up",
    "appeals": "Appeals",
    "posting": "Posting",
}
OUTCOME_TEXT = {
    "executed": "Done",
    "sent_to_person": "Awaiting you",
    "observed": "Would have run",
    "no_action_needed": "No action needed",
    "cannot_decide": "Needs a person",
}
_VERDICT_ORDER = ("execute", "propose", "observe", "refuse", "park")
_FILE_TIME_OPS = frozenset({"vyne.queue", "vyne.build_corrected"})
_TERMINAL = frozenset({RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCELLED, RunStatus.WOULD_HAVE_RUN})


@dataclass
class ExecResult:
    run: Run
    replayed: bool = False
    paused: bool = False
    failure: str | None = None  # "world_unavailable" | "cannot_decide"
    inbox_item_ids: list[str] = field(default_factory=list)

    @property
    def live(self) -> bool:
        return self.run.planner.value == "live"


# ──────────────────────────────────────────────────────────────────────────────────────────── pure helpers


def evidence_id(run_id: str, step_idx: int, seq: int) -> str:
    """07 §4: `ev_ + sha256(run_id, step_idx, seq)[:10]` — replays produce the same ids."""
    return "ev_" + hashlib.sha256(f"{run_id}:{step_idx}:{seq}".encode()).hexdigest()[:10]


def to_evidence(
    c: EvidenceCandidate,
    *,
    run_id: str,
    step_idx: int,
    seq: int,
    claim_id: str | None,
    gathered_by: str,
    world_call_id: str | None = None,
) -> Evidence:
    return Evidence(
        id=evidence_id(run_id, step_idx, seq),
        kind=c.kind,
        title=c.title,
        excerpt=c.excerpt,
        captured_at=c.captured_at,
        reference=c.reference,
        source=c.source,
        untrusted=c.untrusted,
        suspicious=candidate_is_suspicious(c),
        gathered_by=gathered_by,
        run_id=run_id,
        step_idx=step_idx,
        claim_id=claim_id,
        world_call_id=c.world_call_id or world_call_id,
        data=dict(c.data),
    )


def step_delay_ms(run_id: str, idx: int) -> int:
    """07 §4: displayed step duration `300 + hash(run_id, idx) mod 1201` ms."""
    return 300 + int(hashlib.sha256(f"{run_id}:{idx}".encode()).hexdigest()[:8], 16) % 1201


def idempotency_key(run_id: str, step_idx: int, op: str) -> str:
    return f"{run_id}:{step_idx}:{op}"


def overall_verdict(decisions: list[Decision]) -> str | None:
    verdicts = {d.verdict for d in decisions}
    return next((v for v in _VERDICT_ORDER if v in verdicts), None)


def needs_person(case: CaseFile, pending_ops: list[str], risk_days: int = 14) -> bool:
    """07 §9: a failed run opens a `run_failed` item only if a person has a decision to make — a deadline is
    near, or the failed work was going to make a payer file (the file time is at risk)."""
    if any(op in _FILE_TIME_OPS for op in pending_ops):
        return True
    today = case.now.date()
    return any(d.due_on is not None and (d.due_on - today).days <= risk_days for d in case.deadlines)


def _reverses(reverses_in: str, outputs: dict[str, JsonValue]) -> str:
    if reverses_in == "until_file_leaves":
        ft = outputs.get("file_time")
        return f"until the {ft} file leaves" if ft else "until the file leaves"
    return {"until_day_close": "until day close", "void_only": "void only"}.get(reverses_in, "")


def _artifacts(params: dict[str, JsonValue], outputs: dict[str, JsonValue]) -> str:
    parts: list[str] = []
    if outputs.get("nea_number"):
        kind = str(params.get("attachment_kind") or "").upper()
        parts.append(f"{kind + ' via ' if kind else ''}NEA# {outputs['nea_number']}")
    for key, label in (
        ("request_ref", "ref"),
        ("status_ref", "status ref"),
        ("call_ref", "call ref"),
        ("corrected_claim_id", "corrected"),
    ):
        if outputs.get(key):
            parts.append(f"{label} {outputs[key]}")
    return ", ".join(parts)


def audit_line(
    case: CaseFile,
    action: ProposedAction | None,
    decision: Decision | None,
    outputs: dict[str, JsonValue],
    *,
    approved_by: str | None,
    executed: bool,
) -> str:
    """07 §5.5, code-built: `{agent} · {action} · #{n} {patient} · {payer} · ${billed} · {artifacts} ·
    rule {label} v{ver} ({mode} | approved by {user}) · {reverses_in}`."""
    head = [AGENT_LABEL.get(case.agent, case.agent)]
    spec = spec_for(action.action) if action else None
    head.append(spec.label if spec else "no action")
    if case.claim:
        who = f"#{case.claim.number}" + (f" {case.patient.display}" if case.patient else "")
        head += [
            who,
            case.payer.short if case.payer else case.claim.payer_key,
            f"${case.claim.billed_cents / 100:,.0f}",
        ]
    elif case.subject:
        head.append(case.subject.id)
    if action is None or decision is None:
        return " · ".join(head)
    art = _artifacts(dict(action.params), outputs) if executed else ""
    if art:
        head.append(art)
    rule = next((r for r in case.rules_snapshot if r.id == decision.rule_id), None)
    if approved_by:
        head.append(f"approved by {approved_by}")
    elif rule is not None:
        head.append(f"rule {rule.label} v{rule.version} ({rule.mode})")
    if not executed:
        head.append(f"{decision.verdict}: {decision.reason}")
    elif spec is not None:
        rev = _reverses(spec.reverses_in, outputs)
        if rev:
            head.append(rev)
    return " · ".join(head)


# ──────────────────────────────────────────────────────────────────────────────────────────── planners


class ApprovedPlanPlanner(ScriptedPlanner):
    """An approval run's plan is what the person approved (plus their edits); it makes no reads and no model
    calls (07 §12.7). Policy still re-checks it (rows 0, 1, 3, 7, 14)."""

    def __init__(self, run: Run, item: InboxItem | None, approver: str) -> None:
        super().__init__(kind="scripted")
        self.run = run
        self.item = item
        self.approver = approver

    async def plan(self, case: CaseFile, reader: Reader, evidence: EvidenceSet) -> Plan:
        raw = self.run.plan or {}
        pa = raw.get("proposed_action") or {}
        edits = raw.get("edits") or {}
        situation = str((self.item.payload if self.item else {}).get("situation_key") or case.classifier_situation)
        if not pa:
            return Plan(
                situation_key=situation,
                no_action_reason="the approved item carries no action",
                reviewer_summary="Nothing to run.",
                planner=self.kind,
            )
        params = {**(pa.get("params") or {}), **(edits.get("params") or {})}
        cited = [e for e in (self.item.evidence if self.item else []) if e in evidence]
        return Plan(
            situation_key=situation,
            actions=(
                ProposedAction(
                    action=str(pa["action"]), params=params, evidence_ids=tuple(cited), rationale="approved by a person"
                ),
            ),
            reviewer_summary=self.item.recommendation if self.item else f"Approved by {self.approver}.",
            planner=self.kind,
        )


def _load_live_planner(rt: AgentRuntime, run_id: str, on_progress: Any = None) -> Planner | None:
    """The live planner for a run: `live.make_planner(runtime, run_id)` when that seam is set, otherwise
    `LivePlanner(client=runtime.llm_client, …)` once the integration has set `AgentRuntime.llm_client`.
    Absent or failing → None (the caller falls back to the labelled script)."""
    try:
        from torch_rcm.agents.planner import live

        if live.make_planner is not None:
            return live.make_planner(rt, run_id)
        if rt.llm_client is None:
            return None

        def checkpoint(pin: Pin, messages: list[dict[str, Any]]) -> None:
            rt.runs.save_checkpoint(run_id, pin, messages, {})  # pre-plan: nothing mutates before submit_plan

        return live.LivePlanner(client=rt.llm_client, cfg=rt.cfg, on_checkpoint=checkpoint, on_progress=on_progress)
    except Exception:
        return None


# ──────────────────────────────────────────────────────────────────────────────────────────── executor


class Executor:
    def __init__(self, rt: AgentRuntime) -> None:
        self.rt = rt

    # ── events ──
    def _step_event(
        self, run_id: str, idx: int, phase: str, line: str | None = None, evidence: list[Evidence] | None = None
    ) -> None:
        from torch_rcm.agents.runtime import step_event

        run = self.rt.runs.require(run_id)
        ev = [{"id": e.id, "kind": e.kind, "title": e.title} for e in evidence or []]
        self.rt.bus.publish(run_id, "step", step_event(run, run.steps[idx], phase, line, ev))

    def _status_event(self, run: Run) -> None:
        data = {
            "run_id": run.id,
            "status": run.status.value,
            "agent": run.agent.value,
            "claim_id": run.claim_id,
            "planner": run.planner.value,
        }
        self.rt.bus.publish(run.id, "status", data)
        self.rt.bus.publish(FIREHOSE, "status", data)

    def _counts_event(self, run: Run) -> None:
        try:
            from torch_rcm.readmodels.claims import strip
            from torch_rcm.readmodels.snapshot import Snapshot

            counts = strip(Snapshot.from_store(self.rt.store, self.rt.clock.now()))
            data = counts.model_dump(mode="json") if hasattr(counts, "model_dump") else dict(counts)
        except Exception:
            return
        self.rt.bus.publish(run.id, "counts", data)

    # ── step bookkeeping ──
    def _times(self, run_id: str, idx: int) -> tuple[datetime, datetime]:
        """Sim timestamps: steps read sequentially with their seeded display duration; the clock never moves."""
        run = self.rt.runs.require(run_id)
        prev = [s.finished_at for s in run.steps[:idx] if s.finished_at is not None]
        start = max([self.rt.clock.now(), *prev])
        return start, start + timedelta(milliseconds=step_delay_ms(run_id, idx))

    def _start(self, run_id: str, idx: int, input_summary: str = "") -> datetime:
        start, end = self._times(run_id, idx)
        self.rt.runs.start_step(run_id, idx, input_summary, at=start)
        self._step_event(run_id, idx, "started")
        return end

    def _finish(
        self,
        run_id: str,
        idx: int,
        status: str,
        summary: str,
        evidence: list[Evidence] | None = None,
        *,
        at: datetime,
        verdict: str | None = None,
    ) -> None:
        self.rt.runs.finish_step(
            run_id, idx, status, summary, [e.id for e in evidence or []], policy_verdict=verdict, at=at
        )
        self._step_event(run_id, idx, "failed" if status == "failed" else "completed", evidence=evidence)

    def _progress(self, run_id: str, idx: int, line: str) -> None:
        self.rt.runs.progress(run_id, idx, line)
        self._step_event(run_id, idx, "progress", line)

    async def _delay(self, run_id: str, idx: int) -> None:
        scale = self.rt.cfg.delay_scale
        if scale > 0:
            await asyncio.sleep(step_delay_ms(run_id, idx) / 1000 * scale)

    def _save(self, run_id: str, pin: Pin, state: dict[str, Any], messages: list[dict[str, Any]] | None = None) -> None:
        self.rt.runs.save_checkpoint(run_id, pin, messages or [], state)

    def _pause(self, run_id: str) -> ExecResult:
        run = self.rt.runs.set_status(run_id, RunStatus.PAUSED)
        self._status_event(run)
        return ExecResult(run=run, paused=True)

    # ── case / planner ──
    def _case(self, run: Run) -> CaseFile:
        if run.claim_id:
            subject = Subject(kind="claim", id=run.claim_id)
        elif run.remittance_id:
            subject = Subject(kind="remittance", id=run.remittance_id)
        else:
            subject = Subject(kind="patient", id=run.patient_id or "")
        trigger = {
            RunTrigger.APPROVAL: "approval",
            RunTrigger.MANUAL: "manual",
            RunTrigger.SCHEDULE: "claim.status_check_due",
        }.get(run.trigger, "era")
        return build_case(
            self.rt.dom,
            run_id=run.id,
            agent=run.agent.value,
            subject=subject,
            now=self.rt.clock.now(),
            trigger_kind=trigger,
        )

    def _planner(self, case: CaseFile, run: Run, state: dict[str, Any], advance_id: str | None) -> Planner:
        if run.trigger is RunTrigger.APPROVAL:
            item = self.rt.store.get(InboxItem, run.inbox_item_id or "")
            return ApprovedPlanPlanner(run, item, self.rt.dom.user_name(run.actor))
        if "plan" in state:  # resuming: the plan is persisted; the planner only renders result text
            return ScriptedPlanner(kind=state.get("planner", "scripted"))
        cfg = self.rt.cfg
        unknown = case.classifier_situation == UNKNOWN
        wants_live = cfg.is_live_for(case.agent) and (unknown or is_judgment(case.agent, case.classifier_situation))
        if wants_live:
            if not self.rt.limits.take_live(state.get("advance_id")):
                return ScriptedPlanner(note="advance cap")
            live = _load_live_planner(self.rt, run.id, lambda line: self._progress(run.id, INVESTIGATE, line))
            if live is not None:
                return live
        if unknown:
            return RecordedPlanPlanner() if RecordedPlanPlanner().can_plan(case) else ScriptedPlanner()
        if wants_live:
            return ScriptedPlanner(kind="scripted_fallback", note="live planner unavailable")
        return ScriptedPlanner()

    def _reader(self, run_id: str, case: CaseFile, gathered_by: str) -> Reader:
        seq = itertools.count()
        claim_id = case.claim.id if case.claim else None

        async def read(name: str, args: dict[str, JsonValue]) -> ReadResult:
            try:
                out = self.rt.tools.call(case, name, args, run_id=run_id)
            except WorldUnavailable as exc:
                self._progress(run_id, INVESTIGATE, f"{name} · unavailable · {exc}")
                return ReadResult(ok=False, tool=name, args=args, error=f"unavailable: {exc}")
            evs = [
                to_evidence(
                    c, run_id=run_id, step_idx=INVESTIGATE, seq=next(seq), claim_id=claim_id, gathered_by=gathered_by
                )
                for c in out.evidence
            ]
            for e in evs:
                self.rt.runs.save_evidence(e)
            line = out.progress_line or f"{name} · {out.error}"
            self._progress(run_id, INVESTIGATE, line)
            return ReadResult(
                ok=out.ok, tool=name, args=args, data=dict(out.data), evidence=evs, error=out.error, progress_line=line
            )

        return read

    async def _plan(self, run: Run, case: CaseFile, planner: Planner, evidence: EvidenceSet) -> tuple[Plan, Planner]:
        gathered_by = "agent" if planner.kind == "live" else "code"
        reader = self._reader(run.id, case, gathered_by)
        try:
            if planner.kind == "live":
                async with self.rt.limits.semaphore:
                    return await planner.plan(case, reader, evidence), planner
            return await planner.plan(case, reader, evidence), planner
        except PlannerFallback as exc:
            if has_script(case.agent, case.classifier_situation):
                fb: Planner = ScriptedPlanner(kind="scripted_fallback", note=exc.reason)
            elif RecordedPlanPlanner().can_plan(case):
                fb = RecordedPlanPlanner()
            else:
                fb = ScriptedPlanner(kind="scripted_fallback", note=exc.reason)
            self._progress(run.id, INVESTIGATE, f"agent fell back to rules · {exc.reason}")
            return await fb.plan(case, self._reader(run.id, case, "code"), evidence), fb

    def _policy_ctx(
        self, run: Run, case: CaseFile, plan: Plan, evidence: EvidenceSet, draft_guard: Any = None
    ) -> PolicyCtx:
        claim = case.claim
        needs_window = any((s := spec_for(a.action)) is not None and s.needs_hold_window for a in plan.actions)
        practice = self.rt.practice()
        return PolicyCtx(
            agent=case.agent,
            run_kind="approval" if run.trigger is RunTrigger.APPROVAL else "triage",
            paused=practice.agents_paused,
            actor_id=run.actor,
            actor_role=self.rt.dom.user_role(run.actor),
            classifier_situation=case.classifier_situation,
            model_situation=plan.situation_key if plan.planner == "live" else None,
            root_cause=case.root_cause,
            payer_key=claim.payer_key if claim else (case.payer.key if case.payer else None),
            item_type=case.item_type,
            cents=case.cents,
            scope_ids=case.subject_ids,
            evidence=evidence.by_id(),
            expected_values=case.expected_values,
            paper_eob=case.paper_eob,
            hold_window_open=self.rt.dom.hold_window_open(claim.id) if (claim and needs_window) else None,
            draft_guard=draft_guard,
            rules=case.rules_snapshot,
            practice_cap_cents=practice.practice_cap_cents,
        )

    # ── inbox ──
    def _open_item(
        self, run: Run, case: CaseFile, plan: Plan, action: ProposedAction, decision: Decision, draft: Draft | None
    ) -> str:
        """Exactly one open item per (claim, action): an existing open item is reused. The item and the root cause
        recorded with it commit together, and a reused item takes what this run found."""
        store = self.rt.store
        spec = spec_for(action.action)
        claim = case.claim
        rule_mode = next((r.mode for r in case.rules_snapshot if r.id == decision.rule_id), None)
        found = {
            "situation_key": plan.situation_key,
            "root_cause": case.root_cause,
            "policy_row": decision.policy_row,
            "rule_mode": rule_mode,
        }
        with store.tx():
            self._record_root_cause(run, case)
            if claim is not None:
                for it in store.find(InboxItem, {"claim_id": claim.id, "state": InboxItemState.OPEN}):
                    if it.proposed_action and it.proposed_action.action.value == action.action:
                        store.update(it.model_copy(update={"payload": {**it.payload, **found}}))
                        return it.id
            iid = "itm_" + hashlib.sha256(f"{run.id}:{action.action}".encode()).hexdigest()[:10]
            if store.get(InboxItem, iid) is not None:
                return iid
            payer = case.payer.short if case.payer else ""
            store.insert(
                InboxItem(
                    id=iid,
                    kind=InboxItemKind.REVIEW_DRAFT if decision.as_review_draft else InboxItemKind.APPROVE_ACTION,
                    state=InboxItemState.OPEN,
                    claim_id=claim.id if claim else None,
                    patient_id=case.patient.id if case.patient else None,
                    agent=run.agent,
                    title=f"{spec.label if spec else action.action} · {payer} · #{claim.number}"
                    if claim
                    else (spec.label if spec else action.action),
                    summary=decision.reason,
                    recommendation=plan.reviewer_summary,
                    confidence=DomainConfidence(**decision.confidence.model_dump()) if decision.confidence else None,
                    evidence=list(action.evidence_ids),
                    proposed_action=DomainProposedAction(
                        action=RuleAction(action.action),
                        params=dict(action.params),
                        cents=case.cents,
                        requires_hold_window=bool(spec and spec.needs_hold_window),
                    ),
                    tier=Tier(spec.tier) if spec and spec.tier else None,
                    rule_id=decision.rule_id,
                    cents=case.cents,
                    created_at=self.rt.clock.now(),
                    run_id=run.id,
                    payload={**found, **({"draft": draft.model_dump(mode="json")} if draft else {})},
                )
            )
        return iid

    def _record_root_cause(self, run: Run, case: CaseFile) -> None:
        """A finding on an item is on the claim too, so every screen agrees and it outlives the item. A recorded
        `ours` is never replaced, and the audit event is what the claim's timeline shows."""
        if case.claim is None or case.root_cause == "unknown":
            return
        claim = self.rt.store.require(Claim, case.claim.id)
        if claim.denial is None or claim.denial.root_cause in (RootCause.OURS, RootCause(case.root_cause)):
            return
        before = claim.denial.root_cause.value
        denial = claim.denial.model_copy(update={"root_cause": RootCause(case.root_cause)})
        payer = case.payer.short if case.payer else claim.payer_key.value
        self.rt.store.update(claim.model_copy(update={"denial": denial}))
        self.rt.store.insert(
            AuditEvent(
                id=f"aud_{run.id}_root_cause",
                at=self.rt.clock.now(),
                actor=run.agent.value,
                action=ROOT_CAUSE_RECORDED,
                subject_type="claim",
                subject_id=claim.id,
                detail=root_cause_finding(
                    case.root_cause, case.claim, case.payer_rules, self.rt.dom.provenance(claim.id), payer
                ),
                data={"before": before, "after": case.root_cause, "run_id": run.id},
            )
        )

    def _failed_item(self, run: Run, case: CaseFile, title: str, recommendation: str, explanation: str) -> str:
        """At most one `run_failed` item per run (07 §9)."""
        iid = "itm_fail_" + hashlib.sha256(run.id.encode()).hexdigest()[:10]
        if self.rt.store.get(InboxItem, iid) is None:
            claim = case.claim
            self.rt.store.insert(
                InboxItem(
                    id=iid,
                    kind=InboxItemKind.RUN_FAILED,
                    state=InboxItemState.OPEN,
                    claim_id=claim.id if claim else None,
                    patient_id=case.patient.id if case.patient else None,
                    agent=run.agent,
                    title=title,
                    summary=explanation,
                    recommendation=recommendation,
                    tier=None,
                    cents=case.cents,
                    deadline_on=next((d.due_on for d in case.deadlines if d.due_on), None),
                    created_at=self.rt.clock.now(),
                    run_id=run.id,
                )
            )
        return iid

    def _mark_observed_approval(self, run: Run, decisions: list[Decision]) -> None:
        """An approved item whose rule is now `observe` ran nothing: say so on the item (07 §5.1, row 7)."""
        item = self.rt.store.get(InboxItem, run.inbox_item_id or "")
        if item is None:
            return
        item.payload = {**item.payload, "approval_outcome": "would_have_run", "approval_run_id": run.id}
        item.resolution_note = "Would have run · " + "; ".join(d.reason for d in decisions)
        self.rt.store.update(item)

    # ── world calls ──
    async def _world_act(self, run_id: str, idx: int, rstep: RecipeStep, args: dict[str, JsonValue]) -> WorldCallResult:
        key = idempotency_key(run_id, idx, rstep.op)
        if rstep.op.startswith("code."):
            return WorldCallResult(ok=True, data={"op": rstep.op, **{k: v for k, v in args.items() if k != "text"}})
        if rstep.op == DOMAIN_OP_HOLD:
            hid = self.rt.dom.create_hold(str(args["claim_id"]), str(args["reason"]), "", run_id)
            return WorldCallResult(ok=True, reference=hid, data={"hold_id": hid})
        delays = tuple(self.rt.cfg.world_retry_backoff_s)
        for attempt in range(len(delays) + 1):
            try:
                return self.rt.port.act(rstep.op, args, key, run_id=run_id)
            except WorldUnavailable:
                if attempt == len(delays):
                    raise
                self._progress(
                    run_id,
                    idx,
                    f"{rstep.op.split('.')[0]} unavailable · "
                    f"retry {attempt + 1} of {len(delays)} in {delays[attempt]:g} s",
                )
                scale = self.rt.cfg.delay_scale
                if scale > 0 and delays[attempt] > 0:
                    await asyncio.sleep(delays[attempt] * scale)
        raise AssertionError("unreachable")  # pragma: no cover

    # ── the run: one method per pipeline phase ──
    async def run(self, run_id: str, *, advance_id: str | None = None) -> ExecResult:
        """gather_case → investigate → decide → act:* → report. Each phase is skipped when the checkpoint says it
        is done, so a restart continues from the last `ok` step; a pause returns early and resumes later."""
        begun = self._begin(run_id)
        if isinstance(begun, ExecResult):
            return begun
        run = begun
        ck = self.rt.runs.load_checkpoint(run_id)
        state: dict[str, Any] = dict(ck.state) if ck else {}
        state.setdefault("advance_id", advance_id)

        case = self._case(run)  # always rebuilt: pure reads of code facts
        await self._gather_case(run, case)
        planner = self._planner(case, run, state, advance_id)
        state = self._reconcile_checkpoint(run_id, ck, state, planner, case)
        evidence = EvidenceSet(case.evidence)

        if "plan" not in state:
            investigated = await self._investigate(run, case, planner, evidence, state)
            if isinstance(investigated, ExecResult):
                return investigated
            run, planner = investigated
        plan = Plan.model_validate(state["plan"])
        pin = Pin.model_validate(state["pin"])

        if "decisions" not in state:
            paused = await self._decide(run, case, plan, planner, evidence, state, pin)
            if paused is not None:
                return paused
        decisions = [Decision.model_validate(d) for d in state["decisions"]]

        acted = await self._act_steps(run_id, case, plan, state, pin)
        if isinstance(acted, ExecResult):
            return acted
        failure, pending_ops = acted
        return await self._report(run_id, case, plan, planner, decisions, state, failure, pending_ops)

    def _begin(self, run_id: str) -> Run | ExecResult:
        run = self.rt.runs.require(run_id)
        if run.status in _TERMINAL:
            return ExecResult(run=run, replayed=True)
        if self.rt.paused():
            return self._pause(run_id)
        if run.status is not RunStatus.RUNNING:
            run = self.rt.runs.set_status(run_id, RunStatus.RUNNING)
            self._status_event(run)
        return self.rt.runs.ensure_steps(run_id, PIPELINE)

    def _reconcile_checkpoint(
        self, run_id: str, ck: Checkpoint | None, state: dict[str, Any], planner: Planner, case: CaseFile
    ) -> dict[str, Any]:
        """ADR-0001: a checkpoint whose pin no longer matches.

        Before `submit_plan` nothing has mutated, so a pre-plan checkpoint saved under another pin (model, effort,
        thinking, prompt or tool hashes) is discarded with its conversation, and the run re-plans from scratch.
        Once a plan exists the run continues the stored plan under the pin it was planned with: what remains is
        policy over that plan and code recipes with idempotency keys, none of which depends on the model.
        """
        if "plan" in state or ck is None or ck.pin is None or ck.pin == planner.expected_pin(case.agent):
            return state
        fresh: dict[str, Any] = {
            "advance_id": state.get("advance_id"),
            "replanned": f"checkpoint pinned to {ck.pin.model} ({ck.pin.system_sha[:12]}) · re-planning",
        }
        self.rt.runs.save_checkpoint(run_id, ck.pin, [], fresh)  # drop the old conversation
        return fresh

    async def _gather_case(self, run: Run, case: CaseFile) -> None:
        if run.steps[GATHER].status is StepStatus.OK:
            return
        end = self._start(run.id, GATHER, f"{run.agent.value} · {case.subject.kind} {case.subject.id}")
        situation = label_for(case.agent, case.classifier_situation) or case.classifier_situation
        self._finish(run.id, GATHER, "ok", f"situation {situation} · root cause {case.root_cause}", at=end)
        await self._delay(run.id, GATHER)

    async def _investigate(
        self, run: Run, case: CaseFile, planner: Planner, evidence: EvidenceSet, state: dict[str, Any]
    ) -> tuple[Run, Planner] | ExecResult:
        """The planner's reads stream as progress lines on this step; the plan, its planner and pin are saved."""
        run_id = run.id
        if self.rt.paused():
            return self._pause(run_id)
        end = self._start(run_id, INVESTIGATE, f"planner {planner.kind}")
        if state.get("replanned"):
            self._progress(run_id, INVESTIGATE, str(state["replanned"]))
        plan, planner = await self._plan(run, case, planner, evidence)
        gathered = [e for e in evidence.items if e.run_id == run_id]
        has_answer = plan.actions or plan.situation_key != UNKNOWN
        summary = plan.reviewer_summary if has_answer else (plan.no_action_reason or plan.reviewer_summary)
        pin = planner.pin or scripted_pin(plan.planner, case.agent)
        state.update(plan=plan.model_dump(mode="json"), planner=plan.planner, pin=pin.model_dump())
        run = self.rt.runs.update(
            run_id,
            planner=plan.planner,
            situation_key=plan.situation_key,
            model_situation_label=plan.situation_description
            if plan.planner == "live" or plan.situation_key == UNKNOWN
            else None,
            plan={**(run.plan or {}), "agent_plan": plan.model_dump(mode="json")},
            usage=DomainUsage(**planner.usage.model_dump()),
        )
        self._save(run_id, pin, state, planner.transcript)
        self._finish(run_id, INVESTIGATE, "ok", summary, gathered, at=end)
        await self._delay(run_id, INVESTIGATE)
        return run, planner

    async def _decide(
        self,
        run: Run,
        case: CaseFile,
        plan: Plan,
        planner: Planner,
        evidence: EvidenceSet,
        state: dict[str, Any],
        pin: Pin,
    ) -> ExecResult | None:
        """Policy per proposed action; lays out one `act:*` step per recipe step of every executed action and
        opens an inbox item per proposal (triage runs only). Returns an ExecResult only when the run parks."""
        rt, run_id = self.rt, run.id
        if rt.paused():
            return self._pause(run_id)
        end = self._start(run_id, DECIDE, f"{len(plan.actions)} proposed action(s)")
        drafts: dict[str, Any] = {}
        decisions: list[Decision] = []
        for ai, action in enumerate(plan.actions):
            spec = spec_for(action.action)
            guard = None
            if spec is not None and spec.carries_text:
                draft = await planner.draft(case, plan, spec.carries_text, evidence)
                if draft is not None:
                    facts = [str(case.claim.number), case.claim.dos.strftime("%m/%d/%Y")] if case.claim else []
                    guard = guard_draft(draft, evidence.by_id(), facts, case.patient.id if case.patient else None)
                    drafts[str(ai)] = draft.model_dump(mode="json")
            decisions.append(decide(self._policy_ctx(run, case, plan, evidence, guard), action))
        if any(d.verdict == "park" for d in decisions):
            return self._pause(run_id)
        layout, groups = self._act_layout(case, plan, decisions, base=len(run.steps))
        item_ids: list[str] = []
        for ai, (action, d) in enumerate(zip(plan.actions, decisions, strict=True)):
            if d.verdict == "propose" and run.trigger is not RunTrigger.APPROVAL:
                dr = Draft.model_validate(drafts[str(ai)]) if str(ai) in drafts else None
                item_ids.append(self._open_item(run, case, plan, action, d, dr))
        state.update(
            decisions=[d.model_dump(mode="json") for d in decisions],
            act=groups,
            drafts=drafts,
            items=item_ids,
            outputs={},
        )
        verdict = overall_verdict(decisions)
        first = decisions[0] if decisions else None
        first_spec = spec_for(plan.actions[0].action) if plan.actions else None
        rt.runs.ensure_steps(run_id, layout)
        rt.runs.update(
            run_id,
            verdict=verdict,
            action=RuleAction(plan.actions[0].action) if plan.actions else None,
            action_label=first_spec.label if first_spec else "",
            tier=Tier(first_spec.tier) if first_spec and first_spec.tier else None,
            rule_id=first.rule_id if first else run.rule_id,
            rule_version=first.rule_version if first else None,
        )
        self._save(run_id, pin, state)
        out = "; ".join(
            f"{d.verdict}: {_label(a.action)} · {d.reason}" for a, d in zip(plan.actions, decisions, strict=True)
        )
        self._finish(run_id, DECIDE, "ok", out or (plan.no_action_reason or "no action"), at=end, verdict=verdict)
        await self._delay(run_id, DECIDE)
        return None

    @staticmethod
    def _act_layout(
        case: CaseFile, plan: Plan, decisions: list[Decision], *, base: int
    ) -> tuple[list[tuple[str, str, str]], list[dict[str, Any]]]:
        """Step rows for every executed action's recipe (`act:<step>` or `act:<action>:<step>`), then `report`."""
        layout: list[tuple[str, str, str]] = []
        groups: list[dict[str, Any]] = []
        executed = [
            (ai, a)
            for ai, (a, d) in enumerate(zip(plan.actions, decisions, strict=True))
            if d.verdict == "execute" and recipe_for(a.action)
        ]
        for ai, action in executed:
            spec = spec_for(action.action)
            assert spec is not None
            rctx = RecipeCtx(case=case, params=spec.params.model_validate(action.params), outputs={})
            idxs = []
            for rs in recipe_for(action.action) or ():
                name = f"act:{rs.name}" if len(executed) == 1 else f"act:{ai}:{rs.name}"
                idxs.append(base + len(layout))
                layout.append((name, rs.label(rctx), rs.op))
            groups.append({"action": ai, "steps": idxs})
        layout.append(("report", "Report", "code"))
        return layout, groups

    async def _act_steps(
        self, run_id: str, case: CaseFile, plan: Plan, state: dict[str, Any], pin: Pin
    ) -> tuple[str | None, list[str]] | ExecResult:
        """Each executed action's recipe, one idempotent step at a time. A failed step skips the rest of its
        action's recipe; other actions still run. Returns (failure, ops left undone) or a pause."""
        failure: str | None = state.get("failure")
        outputs: dict[str, dict[str, JsonValue]] = state.setdefault("outputs", {})
        pending_ops: list[str] = []
        for group in state["act"]:
            ai = group["action"]
            action = plan.actions[ai]
            spec = spec_for(action.action)
            assert spec is not None
            params = spec.params.model_validate(action.params)
            draft = Draft.model_validate(state["drafts"][str(ai)]) if str(ai) in state.get("drafts", {}) else None
            out = outputs.setdefault(str(ai), {})
            aborted = False
            for rstep, idx in zip(recipe_for(action.action) or (), group["steps"], strict=True):
                step = self.rt.runs.require(run_id).steps[idx]
                if step.status is StepStatus.OK:
                    continue
                if aborted or step.status in (StepStatus.FAILED, StepStatus.SKIPPED):
                    if step.status is StepStatus.PENDING:
                        self.rt.runs.finish_step(run_id, idx, "skipped", "skipped · an earlier step failed")
                        self._step_event(run_id, idx, "completed")
                    pending_ops.append(rstep.op)
                    aborted = True
                    continue
                if self.rt.paused():
                    self._save(run_id, pin, state)
                    return self._pause(run_id)
                rctx = RecipeCtx(case=case, params=params, outputs=out, draft=draft)
                outcome = await self._act_step(run_id, idx, rstep, rctx, case, state, pin, out)
                if outcome == "unavailable":
                    failure = "world_unavailable"
                    pending_ops.append(rstep.op)
                aborted = outcome != "ok"
        return failure, pending_ops

    async def _act_step(
        self,
        run_id: str,
        idx: int,
        rstep: RecipeStep,
        rctx: RecipeCtx,
        case: CaseFile,
        state: dict[str, Any],
        pin: Pin,
        out: dict[str, JsonValue],
    ) -> Literal["ok", "failed", "unavailable"]:
        """One recipe step: the world call under `{run_id}:{idx}:{op}`, its evidence, the checkpoint, the row."""
        end = self._start(run_id, idx, rstep.label(rctx))
        try:
            res = await self._world_act(run_id, idx, rstep, rstep.args(rctx))
        except WorldUnavailable as exc:
            detail = f"{rstep.op.split('.')[0]} unavailable · {exc}"
            state["failure"] = "world_unavailable"
            state.setdefault("failure_detail", detail)
            self._finish(run_id, idx, "failed", detail, at=end)
            self._save(run_id, pin, state)
            return "unavailable"
        if not res.ok:
            self._finish(run_id, idx, "failed", res.error or "the world refused the step", at=end)
            state.setdefault("step_errors", []).append(res.error)
            self._save(run_id, pin, state)
            return "failed"
        ref = res.reference
        if ref is None and rstep.output_key and isinstance(res.data.get(rstep.output_key), str):
            ref = str(res.data[rstep.output_key])  # ops whose answer names the value (e.g. file_time) but no reference
        if rstep.output_key:
            out[rstep.output_key] = ref
        claim_id = case.claim.id if case.claim else None
        evs = [
            to_evidence(
                c,
                run_id=run_id,
                step_idx=idx,
                seq=i,
                claim_id=claim_id,
                gathered_by="code",
                world_call_id=res.world_call_id,
            )
            for i, c in enumerate(res.evidence)
        ]
        for e in evs:
            self.rt.runs.save_evidence(e)
        self._save(run_id, pin, state)
        summary = (
            rstep.label(rctx)
            + (f" · {ref}" if ref and len(ref) <= 80 else "")
            + (" · replayed" if res.replayed else "")
        )
        self._finish(run_id, idx, "ok", summary, evs, at=end)
        await self._delay(run_id, idx)
        return "ok"

    async def _report(
        self,
        run_id: str,
        case: CaseFile,
        plan: Plan,
        planner: Planner,
        decisions: list[Decision],
        state: dict[str, Any],
        failure: str | None,
        pending_ops: list[str],
    ) -> ExecResult:
        """Result text, final status, `run_failed` item if a person must decide, the audit line, `done`."""
        rt = self.rt
        run = rt.runs.require(run_id)
        results = tuple(
            StepResult(step=s.name, status=s.status.value, summary=s.output_summary)
            for s in run.steps
            if s.name.startswith("act:")
        )
        outcome = RunOutcome(
            plan=plan, decisions=tuple(decisions), step_results=results, inbox_item_ids=tuple(state.get("items", []))
        )
        result = code_result(case, outcome)
        if planner.kind == "live":
            try:
                result = await planner.result(case, outcome)
            except Exception:
                result = code_result(case, outcome)
        item_ids = list(state.get("items", []))
        status = RunStatus.SUCCEEDED
        outcome_text = OUTCOME_TEXT[result.outcome]
        if failure or any(s.status is StepStatus.FAILED for s in run.steps if s.name.startswith("act:")):
            status = RunStatus.FAILED
            failure = failure or "step_failed"
            detail = state.get("failure_detail") or "; ".join(e for e in state.get("step_errors", []) if e)
            outcome_text = (
                "Failed · retrying later"
                if failure == "world_unavailable" and run.trigger is not RunTrigger.APPROVAL
                else "Failed"
            )
            if needs_person(case, pending_ops, rt.cfg.decision_risk_days):
                title = (
                    f"Run failed · {AGENT_LABEL.get(case.agent, case.agent)} · #{case.claim.number}"
                    if case.claim
                    else "Run failed"
                )
                item_ids.append(
                    self._failed_item(
                        run, case, title, "Decide how to proceed: a deadline or the next payer file is at risk.", detail
                    )
                )
        elif result.outcome == "cannot_decide":
            status = RunStatus.FAILED
            failure = "cannot_decide"
            item_ids.append(
                self._failed_item(
                    run,
                    case,
                    "Needs a person: Torch couldn't classify this",
                    result.recommendation,
                    plan.reviewer_summary,
                )
            )
        elif decisions and all(d.verdict == "observe" for d in decisions):
            status = RunStatus.WOULD_HAVE_RUN
            if run.trigger is RunTrigger.APPROVAL:
                self._mark_observed_approval(run, decisions)
        executed_ai = {g["action"] for g in state["act"]}
        approver = rt.dom.user_name(run.actor) if run.trigger is RunTrigger.APPROVAL else None
        lines = [
            audit_line(
                case,
                a,
                d,
                state["outputs"].get(str(ai), {}),
                approved_by=approver,
                executed=ai in executed_ai and status is not RunStatus.FAILED,
            )
            for ai, (a, d) in enumerate(zip(plan.actions, decisions, strict=True))
        ] or [
            audit_line(case, None, None, {}, approved_by=None, executed=False)
            + f" · {plan.no_action_reason or 'no action'}"
        ]
        report_idx = next(s.idx for s in run.steps if s.name == "report")
        if run.steps[report_idx].status is not StepStatus.OK:
            end = self._start(run_id, report_idx, result.outcome)
            self._finish(run_id, report_idx, "ok", result.recommendation, at=end)
        run = rt.runs.finish(run_id, status, result.recommendation, " | ".join(lines), outcome_text)
        self._status_event(run)
        self._counts_event(run)
        from torch_rcm.agents.runtime import done_event

        rt.bus.publish(run_id, "done", done_event(run))
        return ExecResult(run=run, failure=failure, inbox_item_ids=item_ids)


def _label(action: str) -> str:
    spec = spec_for(action)
    return spec.label if spec else action
