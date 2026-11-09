"""Slot-only draft templates (07 §4 "Templates"), rendered into the same segmented `Draft` a model writes.

A template cannot branch or loop (stdlib `string.Template`), so it cannot invent facts: every slot is
filled from the CaseFile by `slots()`, and every segment cites evidence by kind, resolved to this run's
evidence ids. A missing slot raises. The text guard runs on template drafts too.

File format (`templates/<agent>/<situation>.<draft_kind>.tmpl`, `:` in keys written as `_`):

    # audience: payer
    # human_must_complete: item one; item two
    <fact_type> | <evidence kinds, space separated> | <text with ${slots}>
"""

from __future__ import annotations

from pathlib import Path
from string import Template

from torch_rcm.agents.planner.base import EvidenceSet
from torch_rcm.agents.types import CaseFile, Draft, DraftKind, DraftSegment, EvidenceKind

TEMPLATE_DIR = Path(__file__).parent / "templates"


def template_path(agent: str, situation: str, kind: DraftKind) -> Path:
    return TEMPLATE_DIR / agent / f"{situation.replace(':', '_')}.{kind}.tmpl"


def has_template(agent: str, situation: str, kind: DraftKind) -> bool:
    return template_path(agent, situation, kind).exists()


def _money(cents: int) -> str:
    return f"${cents / 100:,.2f}"


def slots(case: CaseFile) -> dict[str, str]:
    """Every value a template may use. Code facts only."""
    out: dict[str, str] = {"payer": case.payer.name if case.payer else "the payer"}
    if case.patient:
        out["patient"] = case.patient.display
    claim = case.claim
    if claim is not None:
        out |= {
            "number": str(claim.number),
            "icn": claim.icn or f"#{claim.number}",
            "dos": f"{claim.dos:%m/%d/%Y}",
            "billed": _money(claim.billed_cents),
            "lines": ", ".join(
                f"{line.cdt}{' #' + line.tooth if line.tooth else ''}{' ' + line.surface if line.surface else ''}"
                for line in claim.lines
            ),
            "first_cdt": claim.lines[0].cdt if claim.lines else "",
            "first_tooth": claim.lines[0].tooth or "" if claim.lines else "",
            "sent_on": f"{claim.sent_at:%m/%d/%Y}" if claim.sent_at else "",
        }
    if case.denial is not None:
        code = f"{case.denial.group}-{case.denial.carc}"
        out["denial"] = f"{code} · {case.denial.rarc}" if case.denial.rarc else code
        out["decoded"] = case.denial.decoded
    return out


def structured_facts(case: CaseFile) -> list[str]:
    """Code-rendered strings the text guard accepts as sources (claim number, DOS, lines, ICN)."""
    s = slots(case)
    facts = [v for k, v in s.items() if k not in ("decoded",)]
    if case.claim:
        facts += [f"{line.cdt} #{line.tooth}" for line in case.claim.lines if line.tooth]
    return facts


def render(case: CaseFile, agent: str, situation: str, kind: DraftKind, evidence: EvidenceSet) -> Draft:
    path = template_path(agent, situation, kind)
    audience = "payer"
    must: tuple[str, ...] = ()
    segments: list[DraftSegment] = []
    values = slots(case)
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            key, _, value = line[1:].partition(":")
            if key.strip() == "audience":
                audience = value.strip()
            elif key.strip() == "human_must_complete":
                must = tuple(v.strip() for v in value.split(";") if v.strip())
            continue
        fact_type, kinds, text = (part.strip() for part in line.split("|", 2))
        cited: list[str] = []
        for kind_name in kinds.split():
            cited += evidence.ids(kind_name)  # type: ignore[arg-type]
        segments.append(
            DraftSegment(
                text=Template(text).substitute(values),
                fact_type=fact_type,
                evidence_ids=tuple(dict.fromkeys(cited)),
            )
        )
    return Draft(kind=kind, audience=audience, segments=tuple(segments), human_must_complete=must, source="template")


__all__ = ["EvidenceKind", "has_template", "render", "slots", "structured_facts", "template_path"]
