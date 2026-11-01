# Red team — Round 2 (Inbox + Claims shell) — 2026-10-31

Written as a red team by an independent subagent (role: ex-dental-group billing lead turned vertical-SaaS product lead). It was given: the user's verbatim messages, the job description facts, the Round 1 + Round 2 mocks (/home/claude/rcm-mocks/index.html and round2.png), and Claude's full position and reasoning, with instructions to attack it. It was not given the earlier wireframes, the spec discussion, or any hint of what Claude hoped it would say.

## The strongest case against this position

Inbox-primary bets that the coordinator's day is a sequence of single-claim approvals. It isn't. A biller's day is batched: post this morning's ERAs (one EFT = 12–40 lines across patients), work the aging report by payer (one Delta call covers six claims), send the day's claims at 4 PM, and field front-desk eligibility questions in between. The inbox fragments payer-batched work into one-at-a-time ceremonies, and the "one item shape scales to every flow" bet breaks on exactly the two flows that are batch by nature: payment posting and eligibility. The mock already proves it: the Round 1 inbox had a payments row, Round 2 quietly dropped it, and there is no posting screen anywhere.

Second, the shell creates three taxonomies for the same work and the mocks already disagree: Inbox 12, pipeline strip "Needs action 5", Option B "Needs action 7", Activity "2 items awaiting you", Eligibility "3 need a human look". "Needs action" is being used as both a claim status (in the Claims table status column, next to "Denied CO-16") and a work-queue state. A claim status is Ready / Sent / Accepted / Rejected / Pending / Denied / Paid / Partial / Appealed; "needs action" is a flag on top. Until that is fixed, the cross-links produce counts that don't reconcile when the interviewer clicks a tile.

Third, for this audience, an exceptions inbox is the default shape every agentic-RCM pitch deck uses. It is not where the product judgment shows. The thing that would make ten engineers lean forward is the autonomy dial (what runs without me, and how do I change that) and that surface does not exist in the mocks at all.

## The three most likely ways it fails

**1. No autonomy policy, so the inbox becomes a treadmill.** Who gets hurt: the office manager at a 4-chair practice doing 40 claims/day. At 12 items it demos beautifully; at 60 she stops opening it and goes back to the PMS aging report. What she'd do instead: ask "why am I approving the 23rd Delta PA-attachment at 92% confidence?" and demand auto-run. How the interviewer spots it: "Agents closed 41 items without you" is on screen, but nowhere can you see or change the rule that decided which 41. First question: "Where do I set that?"

**2. Payment posting has no home.** Who gets hurt: the coordinator's first two hours every morning. The Activity log says "Posted Cigna ERA, 12 lines; 1 short-pay found", but there is no ERA/EFT view, no batch, no deposit reconciliation, no variance list. What she'd do: keep posting in Dentrix, use Molar only for denials, and the "get paid faster" story collapses to "get denials fixed faster". Interviewer spot: "Show me the Cigna ERA." There is nothing to click.

**3. Status and count collisions.** Who gets hurt: the owner-dentist asking "how much is stuck?" and getting Needs action $7,160, inbox $8,430, and Option C's $142,380 collected vs. Round 2's "Paid this month $14,220" (a 10x discrepancy that no one at a 3-chair practice would miss). Interviewer spot: click the strip tile, count the rows, compare to the badge in the sidebar. Also: Submitted 12/$18,420 on the strip vs 14/$9,880 on the board for the same practice on the same morning.

## What I would change

- **Claim status model first, screens second.** One seeded dataset in a single module; every badge, tile, and footer total derived via TanStack Query selectors. Statuses: Ready, Sent, Rejected (clearinghouse), Accepted, Pending, Denied, Paid, Partial, Appealed. `needsAction` is a boolean. Add a Rejected tile: clearinghouse rejections are the most common same-day item in dental.
- **Autonomy surface.** On every inbox item: "Always auto-run: Delta · missing PA · < $2,000" plus a Settings > Agents page with per-agent confidence/$ thresholds and a "ran without you" count per rule. This is the agentic-AI product-thinking piece.
- **Batch approve.** Group the inbox by payer × type; "Approve 3 Delta resubmissions" as one action with one progress panel.
- **Payments screen** (one screen is enough): EFT/check #, payer, ERA date, line table (claim, billed, allowed, paid, pt resp, adjustment code), variance rows flagged, "Post 11 / hold 1".
- **Fix the money math.** Add Allowed (PPO contracted fee) to the claim header and compute patient estimate from allowed, with a contractual write-off line. Preventive/diagnostic (D0220) at 100%, buildup at basic or major by plan.
- **Codes and references.** CO-16 always ships with a RARC (N29 / M127): show both. Add payer claim ICN, call reference number, NEA/Vyne attachment ID. Replace "Undo until Delta accepts" after submission with the honest version: void claim (frequency code 8).
- **Fix the 10/13 story.** Your own claims agent attached a BWX to a Delta crown claim instead of the PA, which caused the denial. Either own it ("rule updated: D2740 → attach PA") or change the seed so the PA wasn't in imaging until 10/14.
- **Cut the pipeline-primary toggle.** Two homes over one backend reads as indecision. Spend those hours on the owner's Cash tab: days in A/R, net collection rate, production vs. collections, agent actions/week.
- **Keyboard nav** (J/K, A/E/R/S) in the inbox. Cheap, and exactly what a front-end-leaning interviewer notices.

## What I would keep, and why

The split-pane inbox item itself: recommendation, "why 92%" with the base rate, three evidence cards, plan steps, Approve/Edit/Reject/Snooze. That is the best thing in the mocks. The claim detail timeline with agent/payer/human lanes and evidence links is the audit story that sells trust to an owner. Eligibility organized by appointment is correct; that job really is schedule-shaped. "Open inbox items for this claim" at the top of the detail page is the right cross-link. The Activity tab with weekly counts is fine as a tab, not a home.

## Three things in the mocks that a billing coordinator would immediately call fake

1. **"Delta IVR · Rep: '…a corrected claim is fine.'"** An IVR has no rep; you leave the IVR to reach one, and every biller writes down the call reference number, which is missing. Also "corrected claim (freq code 7)" for a missing attachment is odd: for Delta you send the PA through Vyne/NEA referencing the claim, or resubmit with the attachment; code 7 is for a claim whose data was wrong. And "resubmit by 11/25" is invented; Delta's timely filing is far longer.
2. **Patient est. $620 on a $1,240 crown with "Allowed —".** That is 50% of UCR. No PPO office estimates off billed fees; the estimate comes from the contracted allowed amount, and the three lines are not all "major at 50%".
3. **#4611 Delta "Denied CO-197" (precert absent) on a crown.** Delta does not require prior authorization for D2740; predeterminations are optional. In the same column: "Escalate to provider relations" for a MetLife claim pending 64 days. In New York that is a prompt-pay reprocessing request, not provider relations (who handle contracting). Honorable mention: Round 1's "short-paid $12 vs contract fee schedule, post as write-off?" is the opposite of what you do with an underpayment.
