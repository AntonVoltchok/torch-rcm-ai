# TorchRCM — product spec (what we are building)

TorchRCM is an agentic-AI revenue cycle management (RCM) product for dental practices. AI agents do the insurance back-and-forth (eligibility, claim assembly and submission, status follow-up, denial work, remittance posting); a human — the practice's billing coordinator — supervises and handles exceptions. The practice owner sets how much the agents may do on their own.

This repo is a **believable, interactive demo** built for a job application. It is not a production system, but every shortcut must be invisible from the UI and defensible under questioning by people who build dental RCM software for a living.

The design was settled over seven rounds of mocks, each red-teamed by a domain expert persona. Read `docs/design/decisions-log.md` first, then open `docs/design/mocks.html` (the "Overview" and "Engineering notes" sections at the top are the executive summary). The red-team reports in `docs/design/red-team/` are the realism checklist: anything they called fake stays out.

## Personas (seeded users)

| User | Role | Sees |
|---|---|---|
| Dana S. | Billing coordinator (primary) | Inbox, Today's claims, Claims, Denials, Payments, Patients, Eligibility, Activity |
| Dr. Morgan | Practice owner | Everything + Cash + Settings (signs tier-2 rules, does tier-3 actions) |
| Dr. Lee | Associate dentist | Claims, Denials (signs formal appeals for own patients) |
| Tasha P. | Front desk | Eligibility, Patients (checkout), Today's claims (read) |

Practice: **Harbor Dental** (invented), 2 locations (Downtown, Riverside), NY. PMS: "the PMS" (never a real vendor name). Clearinghouse: Vyne. Attachments: NEA. Payers: Delta Dental of NY, MetLife, Cigna, Aetna, Guardian, NY Medicaid (guard only).

## The ten screens and their demo status

| # | Screen | Purpose | Demo status |
|---|---|---|---|
| 1 | **Inbox** (home) | Prioritized queue of agent-generated work items; split pane; approve/edit/reject/snooze; group approve; keyboard; pipeline strip | **Interactive** |
| 2 | **Claim detail** | One claim: header money math, lines, attachments, acks, agent/human timeline with evidence, open inbox items | **Interactive** |
| 3 | **Claims** | Table of all claims; URL-held filters; opened from strip tiles; saved views | **Interactive** |
| 4 | **Settings › Agents** | Tiered rules table; mode toggles re-run live preview; proposed rules; change log | **Interactive** |
| 5 | Today's claims | Ledger of claims built at checkout: leaving in next file / sent (ack stage) / held | Static from seed (hold-window countdown may tick) |
| 6 | Activity | Agent run log, weekly counts, "would have run" rows in Observe mode | Static (rendered from run log) |
| 7 | Eligibility | Appointments with verification status; benefits panel | Static |
| 8 | Cash | Owner KPIs, A/R aging, by payer/provider, agent impact | Static |
| 9 | Denials | Worklist by next action; reconsideration vs formal appeal | Static list; appeal workbench mock-only |
| 10 | Payments / Patients | ERA posting; patient balances, checkout estimate | Mock-only (link to design) |

"Interactive" = real API, real state, real agent runs. "Static" = real API reads of seed data, no mutations. "Mock-only" = a route that renders the relevant mock screenshot/HTML with a "designed, not built in this demo" banner. No dead links anywhere.

## Non-negotiable product rules (from the red teams)

1. **One status model.** Claim status is one of nine; `needs_action` is a flag, never a status. Every badge, tile and total is derived from the same data — never stored separately.
2. **Three autonomy tiers.** Tier 1 "talks to payers" may learn to run without review (only for rules with an outcome metric). Tier 2 "touches the ledger or patients", including any payer- or patient-facing text the agent *wrote*, needs owner sign-off on the rule. Tier 3 "commits the practice" (write-offs, formal appeals, voids, discretionary refunds, collections) is human-only.
3. **Observe mode is the default** for a new practice (14 days): agents log "would have run" and do nothing.
4. **Agent mistakes are owned.** A denial whose root cause is ours is labeled so on the timeline and can never be learned into auto-run.
5. **Infrastructure failures never reach Dana** (999 file rejects are our bug); decisions do.
6. **No fake certainty.** Every number carries its basis ("as of 10/27 · portal", "estimate", base rate next to confidence).
7. **One claim, one queue.** A thing is worked in exactly one place; other screens link to it.
8. **Claims are built at checkout** and leave in per-payer scheduled files; there is a real hold window; after the file leaves, the only reversal is a void.
9. **Reconsideration ≠ formal appeal.** Most denial work is a 10-minute resend; a formal appeal attests clinical facts, burns a level, and the rendering dentist signs.
10. **Patients are never surprised.** Signed estimate at checkout; refunds automatic (mechanical, owner-signed rule); additional amounts get a statement before any charge.

## Out of scope for the demo (say so in the UI)

Real EDI (837/835/277) parsing, real payer portals, real PMS integration, multi-tenant auth, HIPAA controls, payments processing. The mock world simulates all of these with realistic shapes (see `03-mock-world.md`).
