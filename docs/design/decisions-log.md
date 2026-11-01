# Molar (dental RCM demo) — decision log

Mock page: https://claude.ai/artifact/SzxDujasTyuLW4qMBmjJ7h (Overview + Engineering notes at the top are the executive summary.)
Local source: /home/claude/rcm-mocks/index.html. Red-team reports: rcm-demo/challenge-round2…6 and challenge-final-interviewer (this project).

Method from Round 3 on: a design agent (Opus 5.5, medium) built the round; an independent red-team agent with a rotating persona attacked it; Claude adopted the top recommendation (hybrids allowed) and the next round implemented it plus the fixes. Every decision below records who red-teamed it and the one reason that carried.

| Round | Question | Options | Decision | Red team | Why |
|---|---|---|---|---|---|
| 1–2 | What is the home screen? | A exception inbox · B claims pipeline board · C schedule-centric | **Inbox** home + **Claims** table/detail as the map, cross-linked; Eligibility and Activity as tabs | Billing lead | A coordinator has two jobs: "what do I do now" (inbox) and "where is claim X" (claims). One view that fixes every con is a kitchen sink. |
| 2 | Status model | — | Nine statuses (Ready/Sent/Rejected/Accepted/Pending/Denied/Partial/Paid/Appealed) + `needsAction` flag; one seeded dataset, all counts derived | Billing lead | Counts across screens disagreed; "needs action" was masquerading as a status. |
| 3 | How does autonomy get set? | A rules table · B per-agent dial · C learned from approvals | **Tiered rules table** (A) grouped by what the action touches: tier 1 talks to payers (can learn to run without review, C-style, only where an outcome metric exists); tier 2 touches ledger/patients (owner sign-off); tier 3 commits the practice (human-only). Observe mode 14-day default (B). Rule-change log. "Root cause: ours" can never auto-run. | Practice owner | The owner's buying question is "what can this do to my ledger and patients without a person?" — only a readable table answers it. |
| 4 | How are claims created and sent? | A 4 PM batch review · B per-visit builder · C exceptions only | **Build at checkout** (C timing) + permanent **Today's claims** ledger (A) + builder as detail (B). Claims leave in per-payer files (real hold window, no 277CA until then). Sending PMS codes = tier 1; any agent-written payer-facing text or code change = tier 2. Named readiness checks replace "scrub 0 errors". | Billing lead | A claim is only cheaply fixable within the hour of checkout; a biller must always see "what left" and "what's stuck". |
| 5 | How are denials worked? | A worklist by root cause · B appeal workbench · C prevent, don't appeal | **Worklist grouped by next action** with *reconsideration* (portal/records/COB — tier 1/2, no signature) split from *formal appeal* (attests clinical facts, burns a level, rendering dentist signs — tier 3). Workbench for formal appeals only. Prevention matrix in the sidebar. Typed deadlines; "if we lose, can the patient be billed". One claim, one queue. | Appeals specialist | The 835 group code and RARC decide the path, not whose fault it was; most "appeals" are ten-minute reconsiderations. |
| 6 | How are patients billed? | A statement run · B collect at checkout · C conversation agent | **Signed estimate + collect at checkout** (B) with an **asymmetric true-up**: refunds automatic (owner-signed tier 2 rule, mechanical only); additional amounts never auto-charged — statement first (A), card only after notice within a consent ceiling. Agent is **inbound only** (C); dispute detector stops payment talk; collections = Dr. Morgan after a checklist. | Practice owner | Complaints are about the surprise, not the balance; a signed estimate and statement-before-charge removes the surprise. |
| Final | Would this get an onsite? | — | Yes. Added **Engineering notes** (entity model, status transitions, URL vs cache vs server state, mutation/invalidation map, SSE run stream, tables at scale, role gating, component inventory) and the **two-week build plan**: real = Inbox, Claim detail, Claims table, Settings; static = Activity, Cash, Eligibility, Today's claims; mock-only = appeal workbench, patient agent, checkout estimate, ERA posting. | Hiring Director of Engineering | "The product judgment is above the bar; what I cannot see is the engineer." |

## Standing rules the mocks obey
- One status model; every badge, tile and total derived from one seeded dataset.
- Three autonomy tiers; nothing the agent *wrote* for a payer or patient runs without a human until an owner signs the rule.
- No fake certainty: every number has a basis ("as of 10/27 · portal", "estimate", base rate next to confidence).
- Agent errors are owned on the timeline and can never be learned into auto-run.
- Infrastructure failures (999 rejects) never reach the coordinator; decisions do.
- One claim, one queue.

## Interview prep notes
- Be ready to **defend**: build-at-checkout over a 4 PM batch; the tiered table over per-agent dials.
- Be ready to **reverse**: Denials as top-level nav (may belong as a saved view of Claims); the Partial status (could be Paid + flag).
- Expected questions are in the final red-team report (ten of them); the state-ownership and "Approve 3 invalidation" answers are written in the Engineering notes.
