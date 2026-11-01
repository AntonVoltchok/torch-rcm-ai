# Red team — Round 3 (Settings › Agents A/B/C, Payments, Cash) — 2026-10-31

Written as a red team by an independent subagent (role: practice-owner dentist, 3-location group, who rejected two AI-RCM vendors over autonomy opacity). Given: Round 3 mocks + screenshot, the Round 2 red-team report, and Claude's lean ("C proposes, A stores") with instructions to attack it. Not given: the design agent's reasoning or the earlier wireframes.

## My recommendation

Adopt the hybrid, but reorganize it: **A is the store, C is the only path from "Ask me" to "Auto-run", B's Observe-only and live preview are kept as behaviors, and the table is grouped by what the action touches, not by agent.** Three tiers: (1) *Talks to payers* — attach, resubmit, status check, records request, reprocessing request; (2) *Touches my ledger or my patients* — posting, PMS updates, patient transfers, statements; (3) *Commits the practice* — write-offs, appeals, voids, refunds. Tier 1 can learn its way to auto-run from Dana's approvals. Tier 2 needs my sign-off per row. Tier 3 is human-only, no toggle.

The single strongest reason: the question I asked both vendors I rejected was "list what this thing can do to my ledger and my patients without a person." Only a readable table answers it. C's evidence is what makes me believe the table; the tier grouping is what makes it 13 rows I'll actually read instead of policy I have to author. Per-agent organization answers a question nobody at my practice asks.

## The strongest case against each option

**A.** It lets the coordinator write her own permissions. "Approver: Dana S." and "Changed 06/03 · Dana S." on every row means the person doing the approving also decides what stops needing approval. The locked rows are the only owner-grade control, and nothing says who locked them. First-match ordering is a landmine: a generic "All payers · reject · $2,000" row above a Delta row silently eats Delta items. And "$5,000 / ERA" for posting is the wrong cap: a balanced ERA is safe at any size; a $12 off-contract line is not. I would refuse to turn it on until rule changes above tier 1 require a second named person.

**B.** Three positions per agent is too coarse to be honest. Follow-up does a $0-risk status check and a $1,200 resubmission under one dial and one $ limit; "Eligibility drops back when patient owes > $0" means it always drops back, so the Run position is theater. The dashed "exception from Inbox" chip proves it: real control re-enters as rules anyway, now without the audit columns. I would refuse because I can't answer "why did this one run" from the screen.

**C.** Approval is not correctness, and the mock quietly proves it: "median time you spent on each: 40 s" is the rubber-stamp rate, offered as evidence. The suggested Delta rule automates fixing a denial we caused (the 10/13 BWX bug) instead of preventing it. The Tighten card demotes "Aetna alternate-benefit downgrades" — a rule that is not in the active list and that A marks as locked/never; and the Posting rule shows 2 reversals with no Tighten card despite the stated two-reversal trigger. An interviewer will click those. Cold start is the business killer: a new practice has no history, so the product does nothing for a month.

**"C proposes, A stores."** It inherits the worst of both: C's "Dana got bored" signal becomes a permanent row in A with Dana's name on it, and the owner sees neither the proposal nor the row. Outcome data exists only for resubmissions ("23 paid"); for eligibility writes and posting there is no "paid" to learn from, so those rules are born from approvals alone. Without tiers and an owner gate, the hybrid is a nicer-looking way for autonomy to grow without my knowledge.

## The three most likely ways the recommended model fails

1. **Learned rules with no outcome signal.** Tier-1 resubmissions have "paid within 30 days" as truth; eligibility PMS writes and ERA posting do not. The rule-birth card for those will say "14 of 14 approved" and nothing else. Who gets hurt: patients quoted wrong estimates from a plan-change rule that was "approved" but never checked. What they do: front desk stops trusting the PMS benefits and calls payers anyway. Interviewer spot: "What is the outcome metric on the Eligibility rule?" Fix: each rule shows its outcome definition; rows with none can't be learned, only owner-authored.

2. **Rule changes vanish into "41 ran."** Dana raises Follow-up from $1,000 to $2,000 on Friday; nine items run Monday; the owner sees a bigger number and no diff. Who gets hurt: me, discovering in March that write-off-adjacent behavior changed in October. Interviewer spot: "Show me what changed in the rules last week." Fix: a rule-change log in Activity with before/after, who, and "items run under this change since."

3. **Self-caused denial loop.** The Claims agent attaches the wrong image, Follow-up learns to fix it, both count as "ran without you," hours saved go up, denial rate includes our own errors. Who gets hurt: the owner reading 6.2% denial rate as payer behavior. Interviewer spot: the timeline says "our Claims agent sent the BWX" on the same screen where C proposes auto-running the fix. Fix: every denial-fix rule carries "root cause: ours / payer's"; ours cannot be learned into auto-run, it generates a "fix the upstream rule" suggestion instead.

## What I would change in the Settings screen

- **Group rows by tier** (payer-facing / ledger-and-patient / commits-the-practice) with tier headers; drop the per-agent toggles and the agent cards. Agent name stays as a column.
- **Default state for a new practice:** every row *Observe* for 14 days (B's shadow mode, logged, visible in Activity as "would have run"). Then tier 1 auto-promotes to *Ask me*; tier 2 and 3 stay *Ask me* / *Human only* until the owner acts. Practice-wide cap default **$1,000**, not $2,500, with tier-1 exempt from the cap (paper to a payer isn't money at risk).
- **Owner gate column:** "Needs owner sign-off" on all tier-2 rows; a rule change there creates an Inbox item for Dr. Morgan. Copy: *"Dana proposed: Posting · balanced ERA → runs without review. Approve?"*
- **Rename the actions:** "Auto-run" → **Runs without review**; "Ask me" → **Ask Dana** (named); "Never" → **Human only**. Owners understand people, not modes.
- **Confidence column shows the base rate next to it:** "≥ 90% · 23/25 paid," or "no outcome data" in amber.
- **Replace "$5,000 / ERA" with a per-line variance tolerance** ("post if every line within $0 of contract; else hold the line").
- **Add a "Reverses in" column:** "until 4 PM batch," "until day close," "void only."
- **Add "Changes" tab** beside the table: date, who, before → after, items affected since. Weekly owner digest: "Rules changed: 1. Ran under changed rules: 3."
- **Remove first-match ordering** from user view; evaluate most-specific-wins (payer row beats All). Say so in one line.
- On the Inbox popover keep "Approve 3, no rule" as default; add "root cause: ours (BWX attachment, fixed 10/26)" so nobody creates a rule to fix our own bug.

## Payments and Cash: what's wrong

**Payments.** The primary button contradicts the agent: the card says "post $108.80, keep $25.60 open," the button says "Post 11 · hold 1." Pick one; the right one is post the line, open a $25.60 variance. Related: "Unapplied $0.00" is wrong if a line is held; the money is in the bank and not on a ledger, that is unapplied. The $136 → $168 fee-schedule jump (24% in one year) is not a thing; real short-pays are a deductible applied twice (PR-1 on a met deductible) or a silent downgrade. "Unknown payer" with trace prefix GRD and an agent that already "asked Guardian" is a contradiction. A scanned paper EOB auto-posted "with no human touch" is a trust-killer; paper is where I want eyes, and it needs a deposit status (check not yet deposited). No secondary claims anywhere; dual coverage is daily in a family practice. What I look at first is the bank: add "Deposits this week $13,165.20 · 6 of 7 matched to bank · Guardian check #208841 not deposited."

**Cash.** No write-offs by type. Contractual $21,400 is shown; non-contractual adjustments (and which ones agents initiated) are the single number an AI RCM vendor must show me and it is absent. "590 status checks × 4 min = 39 h" is fiction; no human did 590 checks on 101 claims; either count what a person would have done (~120) or show measured inbox time. Net collection rate has no formula while Days in A/R does; give it one. No production or collections by provider (I pay associates off this). No patient A/R aging or credit balances; patient $33,100 is 30% of A/R and invisible. No location switcher for groups like mine.

## What to keep

The Inbox "Always auto-run" popover with full scope and "Still comes to you if," plus "Approve 3, no rule" as default. Observe-only shadow mode for new payers. The live "41 → 44 of 53" preview on any change. A's locked rows and Changed column. C's birth record and "See the 25." The ERA line table that actually balances (I checked every line), the struck-through "Write off $25.60," the deposit-to-ERA tie, the "estimate" label on hours saved, and Days in A/R shown as a formula I can check.

---

## Decision taken (Claude, 2026-10-31)

Adopted the red team's recommendation in full: **tiered rules table** (A as the store, grouped by what the action touches: payer-facing / ledger-and-patient / commits-the-practice), **C's learning limited to tier 1** and only for rows with an outcome metric, **B's Observe mode as the 14-day default** plus the live preview, **owner sign-off gate** on tier 2, tier 3 human-only, a rule-change log, "root cause: ours / payer's" on denial-fix rules, and the Payments/Cash corrections listed above. Reason: it is the only model that answers the owner's buying question ("what can this do to my ledger without a person?") while keeping the agentic "rules born from approvals" story.
