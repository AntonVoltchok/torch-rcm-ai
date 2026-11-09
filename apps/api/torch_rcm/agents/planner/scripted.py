"""ScriptedPlanner and RecordedPlanPlanner: the deterministic planners (07 §4).

`ScriptedPlanner` runs one registered script per situation key (`planner/scripts/<agent>.py`). A script names
its reads (run through the same scope-checked Reader a live model uses, so evidence and progress lines are
identical) and decides actions from the evidence those reads returned.

`RecordedPlanPlanner` replays `planner/recorded/<claim_id>.plan.json` for `unknown` situations: a plan recorded
from a live run, reviewed by a person and committed. Evidence references in the file (`read:0`, `read:1:note_excerpt`)
resolve to this run's evidence ids. With no fixture the run ends `cannot_decide` ("Needs a person").
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from torch_rcm.agents.planner.base import EvidenceSet, Reader, ReadResult
from torch_rcm.agents.planner.templates import has_template, render
from torch_rcm.agents.tools.registry import ToolRegistry
from torch_rcm.agents.types import (
    UNKNOWN,
    AgentKind,
    CaseFile,
    Draft,
    DraftKind,
    JsonValue,
    Pin,
    Plan,
    PlannerKind,
    ProposedAction,
    ReadCall,
    ResultText,
    RunOutcome,
    Usage,
)

RECORDED_DIR = Path(__file__).parent / "recorded"


@dataclass
class Decided:
    actions: list[ProposedAction]
    summary: str
    no_action_reason: str | None = None


@dataclass
class ScriptedPlan:
    reads: list[ReadCall]
    decide: Callable[[CaseFile, EvidenceSet], Decided]
    draft: DraftKind | None = None


type Script = Callable[[CaseFile], ScriptedPlan]

SCRIPTS: dict[tuple[AgentKind, str], Script] = {}


def script(agent: AgentKind, key: str) -> Callable[[Script], Script]:
    def register(fn: Script) -> Script:
        if (agent, key) in SCRIPTS:
            raise ValueError(f"script for {agent} {key} registered twice")
        SCRIPTS[(agent, key)] = fn
        return fn

    return register


def read(tool: str, **args: JsonValue) -> ReadCall:
    return ReadCall(tool=tool, args=args)


def act(action: str, evidence_ids: list[str], rationale: str = "", **params: JsonValue) -> ProposedAction:
    return ProposedAction(
        action=action, params=params, evidence_ids=tuple(dict.fromkeys(evidence_ids)), rationale=rationale
    )


def has_script(agent: AgentKind, key: str) -> bool:
    _load()
    return (agent, key) in SCRIPTS


def has_recording(claim_id: str | None) -> bool:
    return bool(claim_id) and (RECORDED_DIR / f"{claim_id}.plan.json").exists()


def _load() -> None:
    import torch_rcm.agents.planner.scripts  # noqa: F401  (registers every script)


def code_result(case: CaseFile, outcome: RunOutcome) -> ResultText:
    """The deterministic result text: built from decisions and step results, never from free text."""
    verdicts = [d.verdict for d in outcome.decisions]
    if not outcome.plan.actions:
        kind = "cannot_decide" if outcome.plan.situation_key == UNKNOWN else "no_action_needed"
        return ResultText(
            outcome=kind,
            recommendation=outcome.plan.no_action_reason or outcome.plan.reviewer_summary,
            explanation=outcome.plan.reviewer_summary,
        )
    if "execute" in verdicts:
        kind = "executed"
    elif "propose" in verdicts:
        kind = "sent_to_person"
    elif "observe" in verdicts:
        kind = "observed"
    else:
        kind = "no_action_needed"
    reasons = "; ".join(
        f"{a.action.replace('_', ' ')}: {d.reason}"
        for a, d in zip(outcome.plan.actions, outcome.decisions, strict=False)
    )
    cited = tuple(dict.fromkeys(e for a in outcome.plan.actions for e in a.evidence_ids))
    return ResultText(
        outcome=kind,
        recommendation=outcome.plan.reviewer_summary,
        explanation=reasons,
        evidence_ids=cited,
        injection_suspected=outcome.plan.injection_suspected,
    )


async def _run_reads(reads: list[ReadCall], reader: Reader, evidence: EvidenceSet) -> list[ReadResult]:
    results: list[ReadResult] = []
    for call in reads:
        res = await reader(call.tool, dict(call.args))
        evidence.add(res.evidence)
        results.append(res)
    return results


def scripted_pin(planner_kind: str, agent: AgentKind) -> Pin:
    """The checkpoint pin of a code planner: no model, the planner kind, and the agent's read-tool set."""
    tools = ",".join(sorted(ToolRegistry.allowed(agent)))
    return Pin(
        model="scripted",
        effort=None,
        thinking="disabled",
        system_sha=f"planner={planner_kind}",
        tools_sha=hashlib.sha256(tools.encode()).hexdigest()[:16],
    )


class ScriptedPlanner:
    def __init__(self, kind: PlannerKind = "scripted", note: str | None = None) -> None:
        self.kind: PlannerKind = kind
        self.note = note
        self.usage = Usage()
        self.pin: Pin | None = None  # code planners make no model calls
        self.transcript: list[dict[str, Any]] = []

    def expected_pin(self, agent: AgentKind) -> Pin:
        return scripted_pin(self.kind, agent)

    def can_plan(self, case: CaseFile) -> bool:
        return has_script(case.agent, case.classifier_situation)

    async def plan(self, case: CaseFile, reader: Reader, evidence: EvidenceSet) -> Plan:
        _load()
        fn = SCRIPTS.get((case.agent, case.classifier_situation))
        if fn is None:
            return Plan(
                situation_key=case.classifier_situation,
                actions=(),
                no_action_reason="Needs a person: TorchRCM couldn't classify this",
                reviewer_summary="No script for this situation.",
                planner=self.kind,
            )
        sp = fn(case)
        await _run_reads(sp.reads, reader, evidence)
        decided = sp.decide(case, evidence)
        return Plan(
            situation_key=case.classifier_situation,
            actions=tuple(decided.actions),
            no_action_reason=decided.no_action_reason,
            reviewer_summary=decided.summary,
            planner=self.kind,
            fallback_reason=self.note,
            reads=tuple(sp.reads),
        )

    async def draft(self, case: CaseFile, plan: Plan, kind: DraftKind, evidence: EvidenceSet) -> Draft | None:
        if not has_template(case.agent, plan.situation_key, kind):
            return None
        return render(case, case.agent, plan.situation_key, kind, evidence)

    async def result(self, case: CaseFile, outcome: RunOutcome) -> ResultText:
        return code_result(case, outcome)


class RecordedPlanPlanner(ScriptedPlanner):
    """Replays a hand-written plan for an `unknown` case (live format; its cassette is synthetic).

    Labelled "hand-written plan, replayed".
    """

    def __init__(self) -> None:
        super().__init__(kind="recorded_plan")

    def can_plan(self, case: CaseFile) -> bool:
        return has_recording(case.subject.id)

    @staticmethod
    def load(claim_id: str) -> dict[str, Any]:
        data: dict[str, Any] = json.loads((RECORDED_DIR / f"{claim_id}.plan.json").read_text())
        return data

    async def plan(self, case: CaseFile, reader: Reader, evidence: EvidenceSet) -> Plan:
        if not self.can_plan(case):
            return Plan(
                situation_key=UNKNOWN,
                actions=(),
                no_action_reason="Needs a person: TorchRCM couldn't classify this",
                reviewer_summary="TorchRCM's classifier returned unknown and there is no reviewed plan for this case.",
                planner=self.kind,
            )
        rec = self.load(case.subject.id)
        reads = [ReadCall(tool=r["tool"], args=r["args"]) for r in rec["reads"]]
        results = await _run_reads(reads, reader, evidence)
        actions = tuple(
            ProposedAction(
                action=a["action"],
                params=a["params"],
                evidence_ids=tuple(dict.fromkeys(i for ref in a["evidence"] for i in _resolve_all(ref, results))),
                rationale=a.get("rationale", ""),
            )
            for a in rec["actions"]
        )
        return Plan(
            situation_key=UNKNOWN,
            situation_description=rec["situation_description"],
            actions=actions,
            no_action_reason=rec.get("no_action_reason"),
            reviewer_summary=rec["reviewer_summary"],
            planner=self.kind,
            injection_suspected=bool(rec.get("injection_suspected", False)),
            reads=tuple(reads),
        )


def _resolve_all(ref: str, results: list[ReadResult]) -> list[str]:
    """`read:N` → every evidence id read N produced; `read:N:kind` → only that kind."""
    parts = ref.split(":")
    if parts[0] != "read" or len(parts) not in (2, 3):
        raise ValueError(f"bad evidence ref {ref!r}")
    res = results[int(parts[1])]
    return [e.id for e in res.evidence if len(parts) == 2 or e.kind == parts[2]]


__all__ = [
    "SCRIPTS",
    "Decided",
    "RecordedPlanPlanner",
    "ScriptedPlan",
    "ScriptedPlanner",
    "act",
    "code_result",
    "has_recording",
    "has_script",
    "read",
    "script",
]
