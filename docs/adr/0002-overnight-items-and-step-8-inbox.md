# ADR-0002 — Overnight routing, the step-8 inbox (17, not 16) and benefit variances

Status: accepted · 2026-11-01 · integration worker

## Context
Demo step 8 promised "Inbox 16 (15 + the step-3b item)". With the agent handlers registered, the API reached 12:
`era.arrived` sent every denial to Follow-up (which cannot classify CO-50/CO-29 → "Needs a person"), Moreno had no
other coverage on file, Castillo's records request ran unattended, and `claim.status_check_due` had no handler.
The web mock reached 16 with Lindgren (built 10:51, held) and a held ERA line — neither of which the API can
produce (no claim-building on `visit.checked_out`, no posting run on `era.arrived`).

## Decision
- `era.arrived` routes each denial with `torch.domain.routing.route_denial` (the Denials worklist's router):
  CO-50/CO-29 → Appeals, CO-16/CO-22/CO-119 → Follow-up, patient-responsibility codes → none (Payments).
- Moreno gets a second coverage in the seed (MetLife, listed secondary): the COB script's real branch proposes
  `cob_order_change` (tier 2, no rule → Dana). The single-coverage branch stays tested by stripping it.
- Castillo's claim carries an agent-sent FMX where Guardian's rule names the perio chart, so `root_cause` is
  computed as `ours` and the overnight records request is held for Dana (web S9 made the same call in mock mode).
- `claim.status_check_due` is handled: pending claims without an open item get a Follow-up triage run (trigger
  `schedule` → trigger kind `claim.status_check_due`). The seeded Status check rule is **Ask**, so the three
  morning checks (#4690, #4764, #4760) become proposals.
- Step 8's number is therefore **17** = 10 + 4 overnight denials + 3 status-check proposals. We did not invent
  eligibility flags or a held ERA line to hit 16; the spec and the e2e follow the API.
- Benefit variances: `PlanBenefits.deductible_met_on` (structured, from the EOB that met it) lets the posting
  classifier flag a PR-1 applied after the deductible was met ("deductible applied though met 05/12") as
  `era:variance`, never from EOB text.
- Overnight denials get typed deadlines from a pure `routing.denial_deadline` called by the world's 835 handler.

## Alternatives considered
- Keep 16 by seeding two more eligibility issues or a held overnight ERA line: rejected — numbers must come from
  computation, and a seed tweak whose only purpose is a count is exactly what a reviewer would question.
- Leave status checks unhandled (14): rejected — step 8 says "status checks fire", and with the rule at Ask the
  honest outcome is a proposal per check.

## Consequences
- The web mock's step-8 composition (Lindgren, held ERA line) disagrees with the API until `visit.checked_out`
  (claim building) and posting on `era.arrived` exist; the mock must be re-aligned to 17 or those handlers built.
- Payments' nav badge grows by the overnight 835s (left `needs_review`: no posting run yet).
