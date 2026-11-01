# Red team — Round 4 (claim creation & submission A/B/C; Settings decided; Payments/Cash fixes) — 2026-10-31

Written as a red team by an independent subagent (role: billing lead, 12 years running claims for a 6-provider dental group). Given: Round 4 mocks + screenshot, the Round 2 and Round 3 red-team reports, and Claude's lean (C steady state + A's queue fading out + B as detail) with instructions to attack it.

## My recommendation

C's timing with A's queue kept permanently, and the "send" rule split in two. Build the claim the minute the visit closes, put the ones that can't go in the Inbox right then, and keep a **Today's claims** ledger (A's screen) as the view that never fades: a running list of what left, what's held and why, and what leaves in the next file. Sending PMS-coded lines with the attachments the payer rule names is tier 1. Any claim where the agent *wrote* something the payer reads (remarks, narrative, replacement box, moved dates, "none" in other coverage) is tier 2 with owner sign-off per payer × procedure family, because that text is the practice's attestation, not a phone call.

The single strongest reason: a claim is not fixable at 4 PM. The hygienist has left, the patient has left, the doctor is in a crown prep. The only moment a missing depth, a wrong tooth, or an unsigned note can be fixed cheaply is within the hour of checkout. A once-a-day batch review is a ritual of looking at problems you can no longer solve; C puts the problem in front of Dana while the people who can solve it are still in the building.

## The strongest case against each option

**A.** The 3:45 cut-off means half the day's production (the afternoon) goes out tomorrow, so "one review a day" costs a day of cash on most claims and still doesn't catch anything in time. The flags are also wrong: Brennan's Aetna downgrade is not a readiness problem (you send D2392, Aetna pays as D2150, the front desk quotes the difference), and "D0274 moved to patient" is a PPO contract violation at most payers: you bill all services, let it deny with PR, then bill the patient off a signed frequency acknowledgment. On a Friday I'd refuse because 40 rows of green checkmarks at 3:50 is exactly where I rubber-stamp.

**B.** It's the the PMS claim screen with reasons. "Scrub: 0 errors" on Owens with no remaining-max or deductible line is the lie every PMS already tells me; a $986 crown in late October lives or dies on remaining max. And "Other coverage: None, 271 shows no other plan" is fake certainty: 271s do not carry COB reliably; intake does. I'd refuse it as the main flow because it invites me to edit fields the agent got right.

**C.** Two fakes. The 30-minute cancel: C2 shows "Vyne 277CA accepted 10:49" and "cancel until 11:15" on the same card. Once Vyne has acked, the only way back is a void (freq. 8); a real cancel window means Molar holds the file, so no 277CA until it leaves. Second, "build & send" as tier 1 "moves no money": the claim *is* the request for money and the signature attestation. If the agent can send a corrected claim (freq. 7) under tier 1 without a doctor seeing the code change, I'd refuse on day one.

**Claude's hybrid.** "Send button fades out as rules graduate" collapses the two things a biller needs to know: *what left* and *what's stuck*. If the queue disappears into Activity, holds age invisibly (Akers waiting for an 835 that may never come, with timely filing running). The hybrid also inherits C's tier placement, so the owner never signs off on the one thing that creates liability.

## The three most likely ways the recommended model fails

1. **Clean is not correct.** The 7 "sent without review" claims are only as good as the PMS: wrong provider on the line, a note signed by the associate but billed under Morgan, a fee not on schedule. Who gets hurt: the owner, in refund demands and a payer audit. What they'd do: turn the rule off after the first void and never turn it on again. Interviewer spot: "Scrub 0 errors, what did it check?" There is no list.
2. **The hold list rots.** C's "Not sent" items have no held-since clock, no timely-filing countdown, no owner. Akers (secondary, waiting for a Delta 835) is the classic one that reaches day 90. Who gets hurt: Dana, when the CO-29 lands. Interviewer spot: snooze Akers and ask what happens on day 60.
3. **Documentation to fit the claim.** Ortega: SRP was performed on UR with no depths, and the product's plan is "task RDH: chart UR #2–#5; UR goes out when the chart is saved." That nudges a clinician to add findings after the fact so a claim can leave. Who gets hurt: the hygienist and the dentist, legally. What they'd do: the hygienist refuses, the claim sits. Interviewer spot: any clinician on the panel will stop on that sentence.

## What I would change in the claim-creation screens

- **Readiness checks, named, in this order:** note signed by the rendering provider on the line; procedures on the claim = procedures in the signed note; fee = fee schedule; subscriber ID format per payer (MetLife 9, Delta per plan); 271 ≤ 30 days, remaining max ≥ estimate, deductible status; frequency/history per payer; tooth/surface/quad validity (D4341 needs 4+ teeth per quad with the chart to prove it); attachment per payer rule with NEA# written to remarks; narrative required/present; COB order from intake, not 271; duplicate check against sent claims; timely-filing days left.
- **Replace the 30-minute cancel with a per-payer hold**: "Leaves in the 11:15 file." No 277CA until it leaves. Copy after it leaves: "Void only (freq. 8)."
- **Kill the 4 PM cut-off.** Header: "Sent today 7 · $3,465 · last file 10:45 · next file 11:15 · held 4."
- **Three different events, three different screens:** *999 reject* (file-level, Molar's bug, never Dana's); *Vyne 277CA A7* (minutes, demographic fix under tier 1, status Rejected, never counts as a denial); *payer 277CA A7* (next morning, the claim never entered adjudication, timely filing still running, resend); *277CA A1/A2* writes the ICN to the claim, flips Sent → Accepted, and starts the day-30 (not day-15) status check. Show which of the four it was on the row.
- Brennan: drop the flag; show "Alt. benefit expected · pt est. $71.60 sent to front desk." Russo: send D0274, note "will deny PR-frequency · acknowledgment on file 03/11."
- Owens estimate: add "Remaining max $1,120 of $1,500 · deductible met" or the $504 is fiction.
- Fix the rule name: Settings says "Fix reject, resend," A2's audit line says "Fix demographics, resend."
- Held items get **held since / timely filing / owner** columns.

## Settings and Payments as revised: what's still wrong

- Posting rule is per-line ("$0 off contract") but the Cigna ERA holds all 12 lines for Dana. Under the rule, 11 post and Foster's line comes to her. Worse: Foster's line *is* on contract (allowed $168); a $0-variance check would have auto-posted the doubled deductible. The rule needs "patient responsibility matches tracked benefits."
- "Corrected claim (7) · Runs without review · tier 1": a corrected claim changes what was billed. Tier 2, doctor sees the code change.
- "Front-desk alert · Ask Dana · 0·2 this week": alerts need no approval, and two a week at a practice with 101 open claims is fake volume.
- "Rep call · outcome: ref # logged": an activity count, not an outcome. And nothing bounds what the agent may *agree to* on a call (a rep offering reprocessing against a refund).
- "NY prompt-pay · 45 d+": §3224-a is 30 days electronic, 45 paper, insured plans only (not self-funded). A 4/11 base rate next to a 90% floor is nonsense.
- "Send records / 835" lumps a records request with asking Guardian for an 835 under "paid ≤ 45 d."
- Payer ID 94276 is not a New York Delta ID; the EFT trace says DDNY. Pick one.
- Aetna "Auto-posted ⚑ 1": either it posted or a line is held.
- Abara: Cigna secondary paying $131.20 against a MetLife primary of $82.80 on SRP only works if MetLife is at 50% after a deductible; say so on the row.

## What to keep

The two-stage ack story (999 → Vyne 277CA in minutes → payer 277CA next morning) with the A7:164 example; it's the most real thing in the file. The ⓘ provenance on ADA fields in B. The Delta seat-date logic and the buildup narrative. The pre-estimate with a contractual write-off line. The audit line in C (rule + version, scrub, NEA#, 837 link). The "root cause: ours" guard and the "Reverses in" column. The bank panel and the balanced ERA table. The Ortega split-and-hold idea, minus the chart-completion task.

---

## Decision taken (Claude, 2026-10-31)

Adopted the red team's recommendation: **build-at-checkout (C's timing) + a permanent "Today's claims" ledger (A's screen, never fades) + B's builder as the row-level detail.** Claims leave in per-payer files ("leaves in the 11:15 file"), so there is a real hold window and no 277CA until the file leaves; no 4 PM cut-off; no 30-minute cancel. The send rule is split: sending PMS-coded lines with rule-named attachments is tier 1; any claim where the agent *wrote* payer-facing text (narrative, remarks, replacement box, COB "none") or changed codes (corrected claim, freq. 7) is tier 2 with owner sign-off. Held claims get held-since / timely-filing / owner columns. The named readiness-check list replaces "scrub 0 errors". The Ortega chart-completion task is removed (never nudge documentation to fit a claim). Reason: the only cheap moment to fix a claim is within the hour of checkout, and a biller must always be able to see "what left" and "what's stuck".
