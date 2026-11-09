# d1-claim-denials (D1 phase 2): hand-over

Branch `claude/nostalgic-kowalevski-b60020`, on `feat/d1-dashboard` @ 8db4937. Not pushed. Decisions and the red team: `docs/plans/d1-build.md` → "Phase 2 (claim/denials) notes" and `docs/design/red-team/challenge-d1-claim-denials-2026-11-08.md` (dental billing lead persona).

## What shipped

**Claim** (`features/claim/**`, `routes/claims.$claimId.tsx`, `chrome.panel: false`)
- Header card: back link (`?from=inbox|claims|denials`), "J. Webb #4733" (accessible name "J. Webb claim #4733"), payer/plan/DOS/provider/location/ICN, `procedures_plain`. Facts: status, whose move (`claim.move` baton; "Waiting on you" when `mine`, else `move.label`), Billed in ink, then "Expected from Delta, est." (`insurance_est_cents`) / "Patient owes, per the 835" on a PR denial / Paid, and the deadline with its verb from `deadline.kind` and days on the server clock.
- **History lanes** (`HistoryLanes.tsx` + `legs.ts`): an HTML grid with one column per leg. Each lane has a text row and a 14px bar track. Labels wrap in their own column, so nothing crosses a hop. This replaces D1's halo mask.
  - Lanes come from `TimelineEntry.who` and are named Practice / Agents / {payer}.
  - A remittance never merges with a neighbouring entry. The leg with the run behind an open item is "Proposed fix". The now leg comes from `claim.move`. The ghost "If you approve" comes from the item's `lands`.
  - Above 7 legs, older legs fold into "+N earlier" (click to expand). The first leg, the fix, every remittance and the now leg are never folded.
- **Open item** (`OpenItemsPanel.tsx`):
  - Amber card with `recommendation`, title + `stopped_by`, `touches`, the tier, and "Then it is with …" (`lands`).
  - A `review_draft` is **not** sendable here. Its primary is "Read and send in Inbox", where the draft and citations are.
  - Tier 3 you can't sign shows `signer_note`, "Dr. Morgan signs this", and "Switch to Dr. Morgan (demo)".
  - When nothing is open, `data-testid="no-open-items"` shows `in_flight`.
- **Body:**
  - Denial decoded: codes as `<abbr>`. "Root cause: ours" is a red box with the root-cause entry's reason.
  - Money: on an estimate, Expected vs Per the 835. "Patient cannot be billed (CO)" when the 835's patient share is $0.
  - Lines: plain name + code. Adjustments: "CO-119 $1,090".
  - Attachments and acknowledgments.
- Side panel: the shared `Timeline`, in a region named "Timeline".

**Denials** (`features/denials/**`, `routes/denials.index.tsx`, `?row=`, `chrome.panel: false`)
- **Summary:**
  - `total` denied claims with the Denied tile's `cents` billed.
  - `HolderTally` of the tile's `by_holder`, then one part per `by_holder` row as sent ("4 with you", "1 with the owner"). A role is never resolved to a person on the client.
  - Primary "Review {name} #{n}" for the first row you hold.
- **Worklist:**
  - Server groups, headed "Next: reconsideration · Resend or inquiry…". Rows are sorted by deadline within a group.
  - Columns: deadline (days, "Appeal by"/"File by", basis; "No deadline on file", plus "Nothing to appeal" only on PR rows), whose move (baton + `move.label`, plus "{signer} signs" when the label doesn't say it), name + `#number` + payer + DOS + `procedures_plain`, codes + decoded, root cause chip (ours red, others grey), the checklist, billed with "If lost: patient can/cannot be billed", and Review / See why.
  - Formal-appeal rows keep the workbench link; bill-patient rows keep "closes in Payments".
- **J/K** select (`?row=`), **Enter** opens the claim with `from=denials`, and "‹ Denials" returns to the row. On a claim from Denials, "Next denial: … (2 of 5)" follows the cached worklist order.
- Payer × reason panel is for everyone; the 12-month appeal history is owner only. It sits beside the list at ≥1400px and below it under that.
- **Leftovers removed** (from `d1-shell.md`): `text-bad`, `text-acc`, `font-bold`/`font-extrabold`, arbitrary `text-[18px]`, and the old `Card`/`MoneyMath` strip on the claim page. The `MoneyMath` component is no longer rendered by Claim (only `moneyIsEstimate` is imported); `ReadinessChecklist` now shows only on a ready or held claim ("Before it can be sent").

## Approve seam

`features/claim/useClaimApprove.ts` is the one call site (used by `OpenItemsPanel`). Today it wraps `useApprove` + `?launch=` and renders `ProgressPanel` under the open item. After d1-inbox merges, replace its body with `useActiveLaunch`. Callers only use `{ approve, isPending, isBlocked }`.

## Checks

- `make lint` green.
- `make test`: API 572, web 126. New: `claim/legs.test.ts` (5) and 2 in `denials/selectors.test.ts`.
- MSW e2e: 6/6.
- Real-target e2e (`--grep @demo`): 3/3. API on :8051 over a scratch DB, web on :5194.

**e2e copy changes:**
- 10b reads "Formal appeal" from the group heading ("Next: formal appeal"). D1 dropped the per-row path chip.
- 10b adds checks for the holder tally and for J/K/Enter/Back.
- 3b adds a check that the lanes have one now leg.
- Step 4 (d1-inbox's) is unchanged and green: its "‹ Inbox" breadcrumb, `no-open-items`, and chronological "Timeline" region are kept on purpose.

## Gaps vs the prototype

- **Timeline order:** the side panel stays oldest-first (D1 is newest-first), because step 4 asserts the last entry is the newest and the shared `Timeline` is chronological.
- **Lane labels:** the date sits above the label, not inline. Lanes are about 170px tall vs D1's 100px, which buys wrapping without overlap.
- **Open-item headline:** the server's `recommendation` (longer) instead of D1's hand-written copy.json headline. No headline field, per plan decision 2.
- **Header money:** "Billed" + "Expected, est." instead of D1's red "At stake" (red team).
- **Deadline column:** narrower than D1 (172 vs 208px) so the claim column fits at 1280.
- **Running/failed open-item card states:** D1's are not drawn. `ProgressPanel` shows the run under the card until the coordinator wires `useActiveLaunch`.

## For the coordinator

- **API seed:** on #4611 the 999 and 277CA acks are stamped 3 minutes *before* the visit, so the history's first leg is the payer's.
- **Mock vs API parity on Thursday:** for Dr. Morgan the API's #4796 `move` is "Waiting on you" (mine), while MSW said "Dr. Lee signs". The row now shows `signer` separately, so both pass, but the parity test doesn't cover Thursday.
- **Contract asks from the red team:**
  - `TimelineEntry.short`: today a run's word is its title cut at the first clause.
  - `HolderCount.label`.
  - `deadline.days_left`: the client count uses noon UTC on both dates.
  - A denial date on `DenialRow`, a follow-up date after a send, `last_activity`, and `location`.
- **Not adopted, for later:**
  - Payer/root-cause URL filters on Denials.
  - The rep-call reference in the denial card.
  - An above-the-fold test at 1280×800.
