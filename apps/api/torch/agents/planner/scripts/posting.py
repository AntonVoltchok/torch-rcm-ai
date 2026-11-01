"""Posting scripts (always scripted, 07 §2). Balanced 835 lines post under the owner-signed tier-2 rule; a
paper EOB never auto-posts (policy row 4); variances go to a person."""

from __future__ import annotations

from torch.agents.planner.base import EvidenceSet
from torch.agents.planner.scripted import Decided, ScriptedPlan, act, read, script
from torch.agents.types import CaseFile


@script("posting", "era:balanced")
def balanced(case: CaseFile) -> ScriptedPlan:
    remittance_id = case.subject.id

    def decide(c: CaseFile, ev: EvidenceSet) -> Decided:
        return Decided(
            [act("post_era_line", ev.ids("era_line"), "every line balances", remittance_id=remittance_id)],
            "Post the remittance: every line balances (billed = paid + adjustments + patient).",
        )

    return ScriptedPlan(reads=[read("era_get_remittance", remittance_id=remittance_id)], decide=decide)


@script("posting", "era:variance")
def variance(case: CaseFile) -> ScriptedPlan:
    remittance_id = case.subject.id

    def decide(c: CaseFile, ev: EvidenceSet) -> Decided:
        return Decided(
            [],
            "A line does not balance against the claim.",
            "Review the variance before posting; Torch never writes it off.",
        )

    return ScriptedPlan(reads=[read("era_get_remittance", remittance_id=remittance_id)], decide=decide)
