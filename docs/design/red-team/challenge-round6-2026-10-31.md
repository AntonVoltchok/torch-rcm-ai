# Red team — Round 6 (patient billing A/B/C; denials decided; consistency fixes) — 2026-10-31

Written as a red team by an independent subagent (role: two-location practice owner-dentist, PPO-heavy with Medicaid, who has lived through a surprise-bill review, a consumer-protection inquiry over a collections referral, and refund season). Given: Round 6 mocks, the Round 4/5 red-team reports, and Claude's lean (B default, A for what's left, C explanations only) with instructions to attack it.

## My recommendation

B's desk estimate and collection, with an **asymmetric true-up**: money going back to the patient is automatic (refund to the original card under an owner-signed rule, 30-day clock); money coming from the patient after the 835 is never charged automatically. It becomes a statement in A's worklist, carrying C's EOB line, and the card on file is only charged after notice. C runs inbound only: it answers "why do I owe this?" on the pay page and by reply, offers a self-serve plan form inside signed rules, and never opens a thread. Plans are a form, not a negotiation.

The single strongest reason: my Yelp review and my consumer-protection letter were both about the surprise, not the balance. A signed estimate at checkout is the one document that makes every later number defensible, and B's "owes more → charge the card, text a receipt" turns a surprise bill into a surprise charge, which is worse.

## The strongest case against each option

**A.** It bills Park 98 days after the crown and calls it "0–30 d" because aging starts at the 835. The max-met was visible on 08/07; A has no checkout at all, so the one moment the patient is in front of you with a card is wasted. A's run also mails Fenwick a final notice three days after he asked the owner for a waiver. That is the exact sequence that produced my state inquiry: a notice crossing a pending request, then a referral. I would not let A send a final notice until "hold" includes waiver requests, disputes and current plans, with a clock.

**B.** "Signed today: estimate, and true-up after the 835" is a blank cheque. Reyes signs for $470 on a molar crown that Guardian may downgrade; three weeks later his card is charged $150 more and he gets a text receipt. Card-on-file consent from 03/2025 with no ceiling, no expiry and no notice is a chargeback and a complaint. B also quietly needs refunds moved out of a tier the whole product says is locked, and it shows Owens paying $482 on 10/12 and again on 10/28 with no mention of a second crown or remaining max.

**C.** Brennan says "why did the dentist use the expensive one?", which is a dispute, and the agent in the same breath offers a plan ("$50 today and $21.60 on 12/13", which breaks its own $50/month rule). That message, at 7:59 PM, from a bot, is the Yelp review. C also texts Park, whose preference is paper, and sets a $1,012 plan when tier 2's cap is $1,000. An outbound conversation agent in front of my patients needs a dispute detector that stops all payment talk; it has none.

**Claude's hybrid.** It keeps B's auto-charge, so it keeps the complaint generator, and it calls the plain-English EOB line "explanation, not messaging" when it is agent-written text sent to a third party, tier 2 by the product's own rule. It leaves plans to Dana's phone at two locations with 212 balances, so the plan rule Dr. Morgan signed is never used, and it says nothing about who owns the 90+ bucket.

## The three most likely ways the recommended model fails

1. **Estimate drift.** Allowed amounts and max-left go stale (fee schedule change, a dependent's ortho eating the family max). The ± $0 rate slides from 24/31 to 15/31, refunds and statements both rise, and the desk goes back to "collecting the copay". Hurt: the patient who paid too much. Interviewer: "which eligibility date built this estimate, and what's the ± $0 rate by payer?" Only Reyes shows "portal 10/27".
2. **The signed estimate becomes a promise.** The statement says Guardian paid less; Reyes says "I signed for $470". Hurt: the front desk, who stops asking for signatures. Interviewer: "show me the estimate copy." There is none, only a button.
3. **Holds rot.** Foster (reprocessing), Webb (appeal), Young (dispute), Fenwick (waiver) all sit "on hold" with no held-since, no clears-when, no owner. The 90+ bucket grows, then one account goes to collections with a dispute still open. Interviewer: click "Holds 6".

## What I would change in the patient billing screens

**Cases.** Owens: right in B2, but label the 10/28 visit as #4859 with "max left $616 after #4821". Brennan: the alt-benefit must be on the signed estimate; the statement must show the −$85 Aetna adjustment line (Park's does, Brennan's doesn't); a treatment question pauses all payment asks until a person has called. Park: over the $1,000 tier 2 cap in A and C; should have been caught by the existing front-desk max alert on 08/07; show days since DOS, not since posting. Foster: $59.20 in A, $33.60 paid in B, $25.60 implied in Part A's footer, $32 in the text; the true answer is "owes $27.20, $32 disputed with Cigna, B owes her $6.40 back". Say that on the row and to her. Abara: the $45 sat 27 days before she asked. Fenwick: no final notice while a waiver is with Dr. Morgan; he paid $50 and asked, call him. Torres: key the guard on the patient's coverage set, not the claim's payer, or a Cigna-primary/Medicaid-secondary patient gets a PR-2 statement; allow non-covered services only with a dated written consent shown on the row.

**The estimate may** state the contract allowed, the plan %, deductible and max left "as of 10/27", and the estimated share. **It may not** promise what the plan pays, that no downgrade applies, or a final amount. It must say: "if the plan pays less, you get a statement; if more, we refund your card within 14 days."

**Card on file.** Per-visit signature, ceiling for additional charges (max $50 or 10%), 12-month expiry, 5 business days' notice before any charge, refunds to the original tender, tokenized at the processor, never for Medicaid patients. Show "••8812 · consent 03/2025 · ceiling $50 · expires 03/2026".

**Refunds.** Credit from a posted 835 → original card within 14 days, automatic under a signed tier 2 rule with a per-item cap; cash/check or payer-recoupment risk (COB corrections) → owner inbox, 30-day hold; credits over 60 days are an owner item. Never net a credit against a future visit without written OK.

**Statements.** Per line: date, tooth, procedure in plain words, fee, contract adjustment, plan paid, your share; EOB date and claim #; estimate signed on date; "disputed with your plan" shown separately from "due now"; due date; how to question it. One per 30 days, none under any hold, none under $5 (that needs a signed small-balance write-off rule, not silence).

**Collections.** Only after three statements, a final notice naming the date and the agency, 30 days, no open hold of any kind, balance above a floor, and Dr. Morgan clicking with name and date. Record the referral and a recall path.

**The agent may never** say what insurance will pay, discuss treatment, mention collections or credit reporting, waive, use "final notice", or put clinical detail in a text beyond date and amount. Statements go to the guarantor.

**This week:** estimate card with "as of" date and max left; consent chip; true-up panel split "refund (auto)" / "additional (statement first)"; hold columns held-since / clears when / owner; collections checklist modal; a plan picker on the pay page; fix the counts below.

## Denials decided and the consistency fixes: what's still wrong

- Partial tile $1,060 for the same five claims the footer prices at $1,175.20; and that footer's Foster figure ($25.60) is borrowed from B's checkout payment.
- Park: Delta paid $0 and the claim sits in "Partial".
- Morris: deadline column says 179 d, owner column says "file by 11/06".
- Ito's letter E6 says "filed with the patient's written authorization" while E6 is "not signed". The letter claims a fact no document supports, the rule Part A was built on.
- Moreno's "tier 2 rule" for a coverage-order change doesn't exist in Settings; it belongs in "no rule → Dana".
- B's "refund ≤ $50 · tier 2" contradicts the "locked · no toggle" refund row; resolve it by splitting mechanical overpayment refunds from discretionary ones.
- A's run: four checked rows + "29 more" = 33, not 38; 38 + 203 not-due ≠ 212 patients; Cash said $33,100 patient A/R and $2,180 credits two weeks earlier, A says $18,240 and $214.
- Claim #4402 is a Delta resubmission in Round 3 and Fenwick's MetLife claim here.
- Brennan and Park have different contact preferences across A and C for "the same cases".

## What to keep

Estimates from allowed, not the office fee, with the "which is why it matched" line. The Park statement's contract-adjustment line and the plain-English max-met sentence. Holds kept out of the run. The Medicaid guard hiding the card prompt. C's may/may-not list and quiet hours. The asymmetric refund story in B2's "other branch". "A final notice is a statement; collections is a person." The overturned/upheld arithmetic in Part A, which balances.

---

## Decision taken (Claude, 2026-10-31)

Adopted the red team's recommendation: **B's signed estimate-and-collect at checkout with an asymmetric true-up** — refunds to the original card are automatic under an owner-signed tier 2 rule (mechanical overpayment refunds split from discretionary refunds, which stay tier 3); additional amounts are never auto-charged and become a statement in **A's worklist** carrying the plain-English EOB line, with the card charged only after notice and within a consent ceiling. **C runs inbound only** (answers "why do I owe this?", self-serve plan form inside signed rules, no outbound threads, dispute detector stops all payment talk). Holds get held-since / clears-when / owner; final notice is a statement, collections is Dr. Morgan clicking after a checklist; Medicaid guard keyed on the patient's coverage set. Reason: the complaints that cost practices are about the surprise, not the balance — a signed estimate and "statement before charge" removes the surprise while keeping the checkout collection that pays for the product.
