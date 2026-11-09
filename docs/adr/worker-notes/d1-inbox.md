# d1-inbox (D1 phase 2): hand-over

Branch `feat/d1-inbox`, based on `feat/d1-dashboard` @ 8db4937. Not pushed. It touches no API or codegen file, and nothing in `features/claim/**` or `features/denials/**`.

Decisions: `docs/plans/d1-build.md`, "Phase 2 (inbox) notes" and its "Red-team result, adopted". The report is `docs/design/red-team/challenge-d1-inbox-2026-11-08.md` (hiring Director of Engineering, with a dental billing lead). Fold both into ADR-0008.

## What shipped

| Piece | Where | Notes |
|---|---|---|
| Queue | `features/inbox/InboxQueue.tsx` | Contents:<br>• "Yours" with URL tabs (only All shows a count, the server's `total`)<br>• the baton key<br>• rows drawn with `Baton` from `claim.move`, with a dashed ghost at `lands`<br>• a batch is one row; the rod carries the count, and its ghost is the members' `lands` when they agree<br>• "Not yours to do": rows with a `signer_note`, which show that note<br>• collapsed "Runs you started" (`RecentRuns.tsx`)<br>An item with no claim (an upcoming visit) draws the practice stop, because it is in your Inbox. |
| Decision pane | `features/inbox/InboxDecision.tsx` | Contents, in order:<br>• h1 `title` (the batch title when the item is in one), why `summary`, a root-cause "ours" box (`audit_note`)<br>• a relay table (`components/RelayTable.tsx`)<br>• one filled button `action_label` with `A` (`⇧A` for a batch, plus "Only #N"), and Edit plan / Reject / Snooze<br>• "What this does" `touches`, and the hold window<br>• facts: `stopped_by`, `recommendation`, track record (`pct`, then `basis`, as sent)<br>• "Propose always auto-run" on tiers 1 and 2 with a `rule_id`; the server's refusal shows inline<br>• the cited draft (`DraftText.tsx`)<br>• evidence as rows (`EvidenceRows.tsx`)<br>Blocked items show the `signer_note` box, "Switch to …" (demo users holding `required_role`), and "What the signature does". |
| Run pane | `components/ProgressPanel.tsx` | `variant="pane"` in the Inbox; the default `card` is for the claim page. Each claim keeps its relay row, and the baton is the claim's own server `move`, refetched when the run ends. Steps show `RunStep.label` live; the client `stepLabel()` is deleted. Once every run has ended, the outcome leads above the steps: the summary, then "What changed" from `Launch.changes` (equal before/after reads "stays N"; Denied carries the tile's `HolderTally`), then the `footer` slot. Focus goes to the heading on open and to Next at the end (no scroll). One polite live region. |
| Failure | same | Contents:<br>• the failed step is red and later steps stay pending<br>• the run's `result_summary` (else the step's `output_summary`) leads<br>• approve-time `changes` are hidden<br>• "Back to …" opens the `run_failed` item whose `run_id` is the failed run (the API's `_failed_item` contract), then Next |
| Lock | `hooks/useActiveLaunch.ts` | `lockFor(claim)` is non-null when `claim.move.who === 'agents'` or this tab has a non-terminal launch run on the claim (unknown status counts as running). The hook polls runs not known to be over and invalidates like the SSE `done` when it sees one end. Approve, Edit, Reject and Snooze are disabled for those items only; `A`/`E`/`R`/`S`/`⇧A` toast the reason; J/K/Next stay live. |
| Launch | `state/launches.ts`, `hooks/useInboxActions.ts` | New optional fields `changes`, `action_label` and `touches`, copied from ApproveOut and the item or group at launch. They live in sessionStorage, so a reload or "Runs you started" shows the full pane. |
| URL | `InboxPage.tsx` | Selecting an item (click, J/K, Next) drops `launch`. A `?launch=` from another tab says so instead of guessing. The route sets `chrome: { header: 'full', panel: false }`. |
| Mock | `mocks/db.ts`, `mocks/browser.ts` | Changes:<br>• approval runs carry the API recipe's step names and labels<br>• a `failStep(itemId, step, message)` test hook fails a step like the executor does and files a `run_failed` item with `run_id`<br>• `window.__torchMockDb` is exposed in mock mode only (for e2e and screenshots) |

Leftovers from `d1-shell.md`:

- `text-[10px]` went with `InboxList.tsx`, which is deleted.
- `text-bad` became `risk-ink` for form errors; the Reject form is neutral.
- There is no `acc` in inbox files. `Chip tone="acc"` is the shared Chip's API.

The flaky `InboxPage.test.tsx` test now holds the request on a promise it releases, instead of a 150 ms delay.

## Checks (all green at the last commit)

- `make lint`.
- `make test`: API 572, web 122.
- MSW e2e: 6/6 on :5193.
- Real-target e2e (`--grep @demo`): 3/3, with the API on :8041 over a scratch DB in the session scratchpad and the web on :5193.

New tests in `InboxPage.test.tsx`:

- Approve and Reject are disabled for an item on a claim under a running launch, `A` toasts why, and J moves on to an enabled item.
- After Approve the run owns the pane; "What changed" rows equal the server's `ApproveOut.changes`, key for key; Next leaves the pane.
- #4851 fails via `failStep`: the failed step and its words show, `changes` are hidden, and "Back to" opens the `run_failed` item.

`selectors.test.ts` now tests `isBlocked` and `groupLands`, replacing `inboxMix`, whose numbers now come from `strip.inbox_claims`/`inbox_visits`.

**e2e copy changes (D1 changed the copy):**

- Step 2: the heading is the batch title "Delta Dental · missing PA x-ray (3)" (was "#4821 · K. Owens"). #4821 is checked as the relay link, and the track record as "92%" plus "23 of 25" (was "Why 92%:").
- Step 4: opens the collapsed "Runs you started" first.
- `reload-mid-run`: clicks "Send prompt-pay request" (was "Approve & run").
- No strip or badge assertion changed.

## Gaps vs the prototype

- **Headline:** there is no plain `headline` field, so the h1 is the server's `title` ("Denial · Delta Dental · missing PA x-ray · #4821"), not D1's sentence. The queue's second line is the `title` too. Contract gap.
- **Track record:** "92% 23 of 25 …" as sent, not D1's bold "23 of 25". `Confidence` has no `n`/`k`, and "no base rate (n = 4)" is developer wording. Contract gap.
- **Policy line:** only the proposal link and the server's refusal. The prototype says "off the table" before you click; that needs a `learnable` field.
- **Run steps:** shown per claim (one run expanded), not as D1's single merged list for a batch. On the real API a run also shows gather/investigate/decide/report.
- **Baton glide:** no glide from the decision row to the run row, because they are different elements. No "Stay here"; × closes the pane.
- **Queue lanes:** no "With the agents" or "With payers" claim lanes in the queue (the shell's KPI cards carry those numbers). No per-kind tab counts, because GET /inbox sends no facets.
- **#4851 failure:** on the canonical seed #4851 succeeds, on both the API and the mock. D1's failure was invented copy. The designed failure state shows through `failStep` (unit test, screenshots). The API produces real failures in `portal_outage` (Delta).
- **Mock divergence:** after a generic approval (for example #4851) the mock's claim `move` stays `practice`, because its onDone queues no file. The API says `agents`. The parity fixture doesn't cover post-run moves.
- **Kept for step 3b:** "Policy: ask Dana → Inbox" and the "↳ " progress prefix stay in ProgressPanel. `e2e/demo/02-claim-triage.ts` (d1-claim-denials) asserts them. The hard-coded "Dana" should become the server's words when that step is reworded.

## For the coordinator

- **Contract gaps:**
  - `InboxItemOut.headline`;
  - `learnable: {ok, reason}`;
  - `Confidence.n`/`k`;
  - a 409 when an Approve would start a second run on a claim with an active run. The client lock is UX only; Approve already sends an Idempotency-Key.
- **ProgressPanel props:** it gained optional `variant` and `footer` props. The claim page keeps the `card` default, which now draws the relay table and outcome block inside a bordered card. d1-claim-denials was told the API (`useActiveLaunch`, `Launch.changes`).
- **Screenshots:** in the session scratchpad.
  - `proto/` is the prototype's states.
  - `app/` is MSW, including the #4851 failure.
  - `app-real/` is the real API; its 7 is #4851 succeeding.
