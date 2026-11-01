# Red team — Final pass (whole page, hiring-interviewer persona) — 2026-10-31

Written as a red team by an independent subagent (role: Director of Engineering at the hiring company, reviewing the mock page as a design doc from a senior candidate). Given: the whole page after Round 7 plus the five domain red-team reports (told not to repeat them).

## Verdict

Yes, onsite. The product judgment is above the bar for a senior hire and the domain modelling (tiers, readiness checks, ack stages, asymmetric true-up) is better than what our own product team has on paper. What I cannot see anywhere on this page is the engineer. There is not one data model, state diagram, component inventory or route map in 30 screens, and the five red-team files show the candidate's own lean was overturned in every round and adopted "in full" each time. The single thing that decides it: at the onsite, can they state and then build the state model this page implies (one seeded dataset, derived counts, URL-held filters, streamed agent runs) for one screen, and defend one decision on this page against pushback instead of folding.

## What this tells me about their product judgment

1. **Settings › Agents (Round 4, decided)** is the best screen. Grouping rules by what the action touches rather than by agent, "Reverses in", base rate next to the floor, "no outcome data → can't be learned", and the "root cause: ours" guard that refuses to auto-run a fix for our own bug. That is a person who understands that trust is bought with a readable policy, not a confidence score.
2. **Today's claims (Round 5)**: 12 named readiness checks instead of "scrub: 0 errors", and four distinct ack events (999 / Vyne A7 / payer A7 / A1-A2) each with its own UI consequence. They know that a 999 reject is our bug and must never reach Dana. That is the right instinct for an agentic product: hide infrastructure failure, surface decisions.
3. **Patient billing (Round 7)**: the signed estimate as a document with dated inputs, the asymmetric true-up, the dispute detector that stops payment talk account-wide, and the collections checklist with a disabled button. They design for the complaint, not the happy path. Good.
4. **Where judgment is thin**: scope. Ten screens, seven rounds, 19 settings rows, 8-column worklists with stacked sub-text in 1200×720 frames. The mocks are text-dense in a way no real UI survives; nothing was cut. A senior front-end hire should have shown me the three screens that matter and said "the rest is a table".
5. **Process over conviction**: every "Decision taken" adopts the red team's recommendation wholesale. Updating is a virtue; never once holding a position is a question mark for someone who will argue with our product team.

## Where the front-end thinking is thin

- **State ownership is never named.** Strip tiles "open Claims, pre-filtered", "Save current filter", breadcrumbs "‹ Inbox › #4821 · 1 of 3", split-pane selection: all of this is URL state in a TanStack Router app and none of it is called out. Which filters are search params, which are a saved view on the server, whether the selected inbox item survives refresh: unanswered.
- **Cache vs server derivation.** The "reconciled number set" is the right idea, but counts (Inbox 12, strip, badges, footers) are presented as facts, not as selectors over one query cache. Nothing says whether approving a group invalidates `claims`, `inbox`, `activity` and `settings/preview` or whether the server returns the new counts.
- **Optimistic vs not.** "Runs in the background, you can leave this screen, failures come back as a new item" is an explicit job model, which is correct, but the UI consequences are missing: what the item looks like while the run is queued, what happens when the 10:45 file leaves while Dana is on the Edit screen, what a stale "Editable until 11:15" button does on click.
- **Loading / error / empty.** Only "Agent checking…" and "portal down" exist, both as seed data. No empty Inbox, no PMS/Vyne/NEA outage state, no partial-load for the 835 table, no "Observe mode: would have run" Activity rendering that Round 4 promises.
- **Tables at scale.** Claims shows 14 of 107, Balances 7 of 371, Payments 12 lines where a real ERA has 150. No virtualization, pagination, column config, sticky header, or row density decision. "Export" is a button with no story.
- **Agent progress / SSE.** The progress panel (Round 1 A3, Round 4 C2), the in-place "checking…" rows, the sidebar "5 agents active · 1 on a call" and the live preview "41 → 44" all require a stream or polling; the page never says which, nor how a reconnect or a mid-run tab close is handled.
- **Keyboard** exists only on the Inbox (J/K/A/E/R/S/⇧A). Claims, Today's claims, Denials and Balances are keyboard-dead, and Round 4 C's footer drops the R key with no explanation.
- **Missing from an engineer's mock**: an entity model (Claim, Line, InboxItem, Rule, Run, Remittance, Hold, Estimate), the nine-status transition diagram, role gating (Tasha sees Cash and Settings in the Round 7 nav), and a component list (status chip, ⚑ flag, tile, evidence card, progress panel).

## The demo build: what to cut, what to keep, what to fake

**Real and interactive (the demo):** Inbox with split pane, group approve, keyboard, progress panel fed by a streamed run; Claim detail with timeline; Claims table seeded with 107+ rows, filters in the URL, opened from the strip tiles; Settings tiered table where toggling a mode re-runs the live preview and "Accept proposal" moves the next matching item from Inbox to Activity.
**Static:** Activity (render it from the run log, it is free), Cash, Eligibility, Today's claims as a read-only ledger with the hold-window countdown.
**Drop:** Formal appeal workbench, Patient messages agent, Checkout estimate, Payments ERA posting. They are domain showpieces, not front-end showpieces, and each is a week.
**Seed and runner:** one module with the reconciled number set, a frozen clock (Wed 10/28 10:40) with a "tick" control, deterministic ids. The mock runner must emit step events with delays over SSE, fail one step on a known item (to show failure → new Inbox item), honour the rules table (a row set to "Runs without review" diverts the next seeded item to Activity with the audit line), and return new counts so the badges move.
**First five minutes:** Inbox at 12 → open the Delta group → evidence → Approve 3 → steps stream → Inbox 9, Activity gains a row → Settings: accept the proposal, watch 41 → 44, see the "ours" guard hold 3 → click the Denied tile → Claims table filtered, refresh the page, filter survives → J/K through rows.

## Ten questions I'd ask in the onsite about these mocks

1. Which pieces of Inbox state live in the URL, which in the query cache, which only on the server, and why?
2. Dana clicks Edit on #4859 at 10:44; the 10:45 Delta file leaves. What does the UI do?
3. How does the browser learn a run step completed: SSE, polling, or a mutation result? What happens on tab reload mid-run?
4. Name the mutations fired by "Approve 3" and every query they invalidate.
5. Zod: where does the schema live, and how do the nine statuses plus the ⚑ flag type through to the table cell?
6. The Claims table at a DSO has 4,000 rows. Walk me through sorting, filtering and virtualization.
7. Which red-team recommendation would you reverse today, and why?
8. Tasha's Round 7 nav shows Cash and Settings. How are roles enforced in the router?
9. Settings says "17 rows" and renders 19. How would the build prevent that class of error?
10. Of the ten screens, which three would you ship first and what do you tell the product team about the other seven?

## What's inconsistent or broken on the page itself

- **Overview vs screens:** the "ten screens, in nav order" list matches only the Round 7 sidebar; Rounds 2–6 still show the seven-item nav with Today's claims as a tab under Claims and Denials as "Claims › Denials", despite "revised in place".
- **Overview lifecycle vs Round 6:** the K. Owens timeline says records were sent Wed 10/28 with Dana approving 3, yet Thursday's Denials worklist still lists #4821 +2 as a pending resubmit with an "Approve 3 Delta resubmits" button.
- **Round 2 Claim detail timeline** still reads "10/13 · 7:05 AM → 4 PM Claims agent built claim" after the build-at-checkout decision; the Round 5 fix list claims the Round 2 copy was updated to file times.
- **Delta file times:** Round 2 Inbox at 10:40 says the next Delta file is 11:15; Round 5 builder at 10:38 says Owens leaves in the 10:45 Delta file.
- **A. Reyes #4858:** DOS 10/27 and "Ready" in Round 2's Claims table and "had a claim on 10/27" in Round 3's fix list, but a 10/28 10:40 appointment built at checkout in Rounds 5 and 7.
- **Status-check cadence:** Round 2 and the overview say day 14 (11/11); Round 4 says day 15; Round 5 says day 30. Three numbers for one rule.
- **Settings note says "17 rows"**; the table has 9 + 7 + 3 = 19 after the Round 7 refund split. "Changes 5" tab shows four rows.
- **Lindgren:** held "today 10:20" and called the one new Inbox item, yet the 10:38 and 10:40 screens show Inbox 12; Lindgren is also absent from Round 7's "Today · 11 checkouts".
- **Thursday bridge "107 + 5 built − 6 paid"** does not match Today's claims, which shows at least eight claims built after 10:40 plus "9 more visits today will join".
- **Round 7 sidebar at 10:58** shows Payments 1 and Eligibility 2; Round 5 at the same minute shows Payments 2 and Eligibility 3.
- **Nav depth is uneven:** Round 1 and 3 get sub-links, Round 2's five screens get none, "Fixes" links exist for Rounds 6–7 but not 3–5, and "Settings A·B·C" lands only on A. The empty `set-shared` wrapper before `r3-shared` is leftover scaffolding.
- **K. Owens 9:00 vs 10:00:** the builder says visit 9:00; the checkout list says 10:00.

---

## Decision taken (Claude, 2026-10-31)

Adopted: (1) add an **Engineering notes** block to the Overview — entity model, nine-status transition list, state ownership (URL search params vs TanStack Query cache vs server), mutation → invalidation map for "Approve 3", SSE run stream with reconnect/reload behavior, table-at-scale plan, role gating, component inventory, and the two-week demo build plan (real: Inbox, Claim detail, Claims table, Settings; static: Activity, Cash, Eligibility, Today's claims; dropped from the build: appeal workbench, patient agent, checkout estimate, ERA posting); (2) fix the page-level inconsistencies listed above; (3) keep the Overview's "ten screens" as the final nav and label earlier rounds' nav as historical rather than re-drawing 25 screens. Not adopted as a change to the mocks: the "process over conviction" critique — it is a note for the interview (be ready to defend or reverse one decision; candidate answer prepared in the summary doc), not a mock change.
