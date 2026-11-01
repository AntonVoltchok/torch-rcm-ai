"""ToolRegistry: the read tools a planner may call, their argument models, scope checks and evidence.

Principle: the model proposes; code gates and executes. Only read tools live here; there is no mutating
tool for any model. A read is scope-checked against the run's subject before it reaches the world (a portal
page that asks the model to "look up claim 4999" gets `is_error`, not another patient's chart), and every
result's free text comes back as labelled, untrusted world content.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from torch_rcm.agents.guardrails import looks_like_injection
from torch_rcm.agents.ports import WorldPort
from torch_rcm.agents.tools.schemas import AGENT_READS
from torch_rcm.agents.types import AgentKind, CaseFile, EvidenceCandidate, Frozen, JsonValue, PayerKey


class _Args(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class VisitArgs(_Args):
    visit_id: str


class ImagesArgs(_Args):
    patient_id: str
    on_or_before: date
    kinds: list[Literal["pa", "bwx", "fmx", "pano", "perio_chart", "intraoral_photo"]]
    tooth: str | None


class CoverageArgs(_Args):
    patient_id: str


class RulebookArgs(_Args):
    payer_key: PayerKey
    topic: Literal[
        "attachments", "frequency", "alternate_benefit", "missing_tooth", "cob", "timely_filing", "appeal",
        "prompt_pay", "medical_necessity",
    ]  # fmt: skip
    cdt_codes: list[str]


class HistoryArgs(_Args):
    claim_id: str
    include: list[
        Literal["acks", "remits", "attachments", "correspondence", "prior_eobs", "runs", "payer_tooth_history"]
    ]


class RemittanceArgs(_Args):
    remittance_id: str


class ToolOutcome(Frozen):
    ok: bool
    data: dict[str, JsonValue] = Field(default_factory=dict)
    evidence: tuple[EvidenceCandidate, ...] = ()
    error: str | None = None
    progress_line: str = ""


class ReadTool(Frozen):
    name: str
    op: str
    args_model: type[_Args]
    describe: Callable[[dict[str, JsonValue], tuple[EvidenceCandidate, ...]], str]


def _visit_line(args: dict[str, JsonValue], ev: tuple[EvidenceCandidate, ...]) -> str:
    rec = next((e for e in ev if e.kind == "pms_record"), None)
    return rec.title if rec else f"PMS visit {args.get('visit_id')}"


def _images_line(args: dict[str, JsonValue], ev: tuple[EvidenceCandidate, ...]) -> str:
    kinds = "/".join(str(k).upper() for k in args.get("kinds") or []) or "all"  # type: ignore[union-attr]
    tooth = f" #{args['tooth']}" if args.get("tooth") else ""
    return f"PMS imaging · {kinds}{tooth} · {len(ev)} found"


def _history_line(args: dict[str, JsonValue], ev: tuple[EvidenceCandidate, ...]) -> str:
    corr = [e for e in ev if e.kind in ("portal_screenshot", "ivr_transcript")]
    if corr:
        return "read " + corr[0].title.split(" · ", 1)[-1].replace("correspondence", "portal correspondence")
    return "claim history · " + ", ".join(str(i) for i in args.get("include") or [])  # type: ignore[union-attr]


READS: dict[str, ReadTool] = {
    t.name: t
    for t in (
        ReadTool(name="pms_get_visit", op="pms.get_visit", args_model=VisitArgs, describe=_visit_line),
        ReadTool(name="pms_find_images", op="pms.find_images", args_model=ImagesArgs, describe=_images_line),
        ReadTool(
            name="pms_get_coverage",
            op="pms.get_coverage",
            args_model=CoverageArgs,
            describe=lambda a, ev: "PMS coverage on file",
        ),
        ReadTool(
            name="payer_rulebook_lookup",
            op="rulebook.lookup",
            args_model=RulebookArgs,
            describe=lambda a, ev: f"rulebook · {a.get('payer_key')} · {str(a.get('topic')).replace('_', ' ')}",
        ),
        ReadTool(name="claim_get_history", op="claim.get_history", args_model=HistoryArgs, describe=_history_line),
        ReadTool(
            name="era_get_remittance",
            op="era.get_remittance",
            args_model=RemittanceArgs,
            describe=lambda a, ev: f"remittance {a.get('remittance_id')}",
        ),
    )
}


class ToolRegistry:
    def __init__(self, world: WorldPort) -> None:
        self.world = world

    @staticmethod
    def allowed(agent: AgentKind) -> tuple[str, ...]:
        return AGENT_READS[agent]

    def scope_errors(self, case: CaseFile, name: str, args: BaseModel) -> list[str]:
        """Ids must belong to this run's subject; the rulebook only for this claim's payer."""
        errors: list[str] = []
        scope = case.subject_ids
        for key, value in args.model_dump().items():
            if key.endswith("_id") and isinstance(value, str) and value not in scope:
                errors.append(f"{key}={value} is outside this run's subject")
        if name == "payer_rulebook_lookup" and case.claim and getattr(args, "payer_key", None) != case.claim.payer_key:
            errors.append("rulebook lookups are limited to this claim's payer")
        return errors

    def call(self, case: CaseFile, name: str, raw: dict[str, JsonValue], *, run_id: str) -> ToolOutcome:
        if name not in READS or name not in self.allowed(case.agent):
            return ToolOutcome(ok=False, error=f"{name} is not a tool available to {case.agent.capitalize()}")
        tool = READS[name]
        try:
            args = tool.args_model.model_validate(raw)
        except ValidationError as exc:
            return ToolOutcome(ok=False, error="; ".join(f"{e['loc']}: {e['msg']}" for e in exc.errors()))
        problems = self.scope_errors(case, name, args)
        if problems:
            return ToolOutcome(ok=False, error="; ".join(problems))
        payload: dict[str, JsonValue] = args.model_dump(mode="json")
        result = self.world.read(tool.op, payload, run_id=run_id)
        return ToolOutcome(
            ok=True,
            data=result.data,
            evidence=result.evidence,
            progress_line=tool.describe(payload, result.evidence),
        )


def candidate_is_suspicious(c: EvidenceCandidate) -> bool:
    return c.untrusted and looks_like_injection(c.excerpt)
