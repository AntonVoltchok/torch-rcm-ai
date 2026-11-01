"""observe_mode_day3: a new practice on day 3 of the 14-day Observe default. Rules that could run are in
`observe`; this week's would-be executions are `would_have_run` runs and nothing touched a payer."""

from __future__ import annotations

from datetime import timedelta

from torch_rcm.domain.entities import Practice, Rule, Run
from torch_rcm.domain.enums import PolicyVerdict, RuleMode, RunStatus, StepStatus, Tier
from torch_rcm.seed.builder import SeedWorld
from torch_rcm.seed.canonical import build as build_canonical


def build() -> SeedWorld:
    w = build_canonical(scenario="observe_mode_day3")
    for practice in w.of(Practice):
        practice.observe_until = w.now.date() + timedelta(days=11)
    observed = set()
    for rule in w.of(Rule):
        if rule.tier is not Tier.THREE:
            rule.mode = RuleMode.OBSERVE
            if rule.tier is Tier.TWO:
                rule.signed_by = rule.signed_at = None
            observed.add(rule.id)
    for run in w.of(Run):
        if run.rule_id in observed and run.verdict is PolicyVerdict.EXECUTE:
            run.status = RunStatus.WOULD_HAVE_RUN
            run.verdict = PolicyVerdict.OBSERVE
            run.outcome = "Would have run"
            for step in run.steps:
                if step.name.startswith("act:"):
                    step.status = StepStatus.SKIPPED
                    step.output_summary = f"would have: {step.label.lower()}"
    return w
