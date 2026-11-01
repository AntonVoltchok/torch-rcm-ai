"""Eligibility scripts (always scripted, 07 §2): verify benefits before the visit."""

from __future__ import annotations

from torch.agents.planner.base import EvidenceSet
from torch.agents.planner.scripted import Decided, ScriptedPlan, act, script
from torch.agents.types import CaseFile


@script("eligibility", "eligibility:verify")
def verify(case: CaseFile) -> ScriptedPlan:
    appointment_id = case.subject.id

    def decide(c: CaseFile, ev: EvidenceSet) -> Decided:
        return Decided(
            [act("eligibility_check", [], "visit tomorrow", appointment_id=appointment_id)],
            "Verify benefits for tomorrow's visit (portal → 271 → IVR).",
        )

    return ScriptedPlan(reads=[], decide=decide)
