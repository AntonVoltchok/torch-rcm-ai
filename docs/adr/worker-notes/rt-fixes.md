# Final red team fixes (challenge-final-d1-2026-11-08)

Two parallel sessions fixed the top five findings; each keeps its notes under its own heading.

## rt-seed

Findings 1 (Foster money) and 2 (claims leave before they exist).

**Foster #4772.** The 835 line is billed $255.00 = paid $108.80 + CO-45 $87.00 + PR-1 $32.00 + PR-2 $27.20. The
tracked benefits say the deductible was met 05/12 and basic restorative is 80%, so Cigna owed 80% × $168 allowed
= $134.40. It is **$25.60 short**. The patient owes **$33.60**, not the 835's $59.20. There is no refund.

- The seed adjudicates the claim a second time at the tracked benefits (`Pinned.expected`, the same function with
  no posting error). The remit line's `variance_cents`, its note, the claim's reason, the ERA evidence excerpt
  and the item's recommendation and params are all built from those cents. They are formatted with the same
  `dollars()` the run effects use. `tests/test_seed_variance.py` recomputes the figures from first principles
  (allowed × plan % with the deductible met) for every variance item.
- A dental billing-lead red team (a subagent) settled the judgment calls, and I adopted its answers:
  - Move $33.60 to the patient now. That is what the patient owes whichever way Cigna rules, so no refund and
    no second bill.
  - Hold $25.60, the money actually in question, and ask Cigna to reprocess the $32 PR-1.
  - Label the claim card "Underpaid", not "Denied". PR-1 is never a denial: the line paid.
  - Never headline the 835's $59.20.
- Claim screen:
  - API `money()`: a partial payment with a held benefit variance shows the expected figures (basis "expected
    at tracked benefits") beside the 835's.
  - Header: "Expected from Cigna, tracked benefits $134.40".
  - Web only: `DenialCard` says "Underpaid" with the server's reason on a partial claim where every line paid.
  - Web only: the Lines table lists PR adjustments after CO/OA. The API already sent `patient_adj`.
  - No schema change.

**Chronology.** 17 claims (the report said 14) were sent at hh:45 after a visit that ran to hh:50. Each now
leaves in the first file slot after its build. The Castillo FMX is now attached after the build (11:55).
`Builder.send` asserts the file time is not before the build. `test_invariants.py` checks visit ≤ built ≤ sent ≤
acks ≤ remitted, plus agent attachments ≥ build, over the whole seed. #4860 is a real resend (its first file was
rejected at 09:45, resent 10:15), so for that claim the newest 999 follows the send. Visible demo times are
unchanged. Today's 10:45/11:15 files are untouched.

## rt-truth

Findings 4 ("12 items need you" counted an item only Dr. Morgan can sign), 5 (#4744's borrowed 94% · 91 of 97) and
the Payments near miss (the design exploration around the mock-only screens). Judgment calls went to one red-team
subagent (a dental billing lead for wording and workflow, a hiring Director of Engineering for the contract); its
answers were adopted as below.

### "N items need you"

| Decision | Choice | Why / alternative rejected |
|---|---|---|
| What `Strip.inbox_open` counts | The viewer's open items they can act on (`moves.can_act`: sees it and may approve it, the 403 rule). `inbox_open_cents`, `inbox_claims`, `inbox_visits` follow. | Keeping `inbox_open` as the whole queue and adding `inbox_yours` would leave the badge's field name meaning the wrong thing. One client, codegen'd types: the semantic change is safe and is documented on the field. |
| The rest of the queue | `Strip.inbox_waiting: [{signer_ids, label, count, cents}]`, one row per set of signers, first-seen order. | A single `inbox_waiting: int` + label breaks when two different signers wait. The server writes `label` (as it writes `signer_note`), so no second copy of signer naming lives in the web (finding 3 was that bug). |
| Who a row names | The users who have the item in their own `inbox_open` (`can_act`), not everyone whose role could approve. | The label must be true from the signer's side; an invariant test checks it. Today that is Dr. Morgan for Diaz and for the unassigned Ito and Morris appeals (Dr. Lee only sees items assigned to Dr. Lee). |
| `GET /inbox` | `total` stays `len(items)`; adds `actionable` and `waiting [{…, item_ids}]`, `actionable + Σ waiting.count == total`. | A `total` that disagrees with the array it describes is the first thing a reviewer attacks. |
| Activity "awaiting you in the Inbox" | Same number as the badge (`actionable_inbox`). | It linked to the Inbox with 12 while the badge said 11; it was also not per-viewer (the mock was). |
| UI | Header "11 items need you: 8 claims, 3 upcoming visits · 1 waiting on Dr. Morgan"; "Not yours to do" becomes "Waiting on Dr. Morgan · 1 · $1,240" per server row; the All tab reads `actionable`. | A billing lead says "waiting on", and the section shows the dollars. |

Demo numbers: step 1 badge 11 (queue 12), step 3 → 8, step 3b → 9, step 8 → 14 with "3 waiting on Dr. Morgan" (queue 17).
`seed/targets.py` keeps `INBOX_OPEN` as the queue and adds `INBOX_WAITING`; the eval harness checks both.

Tests: `tests/test_inbox_truth.py` (every seeded user at seed, after steps 3 + 3b and after the night: need-you +
waiting = queue = list total, badge = list actionable = Activity, cents add up, every waiting row's signers have the
item in their own count, every waiting item carries a `signer_note`); web `InboxPage.test.tsx` "Inbox counts" (badge,
header, All tab and section agree) and the MSW invariants in `db.test.ts`/`db.s2.test.ts`.

**Touched another session's file:** `apps/api/tests/test_invariants.py::test_inbox_badge_equals_open_items_and_activity_awaiting`
(two assertion lines, marked `# rt-truth`): it asserted badge == queue == 12, which is exactly what finding 4 changes.

### Unnamed situations carry no track record

- `policy.confidence(rule, situation)`: when the classifier returned `unknown`, the matched rule (an `all` rule) still
  gates the action and names itself in the audit line, but the confidence is `pct None, 0 of 0` with the basis
  "No track record. TorchRCM couldn't match this to a known situation, so there are no past cases to compare." Same
  `Confidence` shape (not `null`), so there is one "no record" shape. "Classifier" was dropped from the words: billing
  staff don't say it.
- Row 12 (confidence floor) uses the same answer, so an unnamed situation can never clear a floor; row 5 already
  stops it first. `learnable()` refuses it ("…so there are no past cases to learn from").
- The eval harness's `unknown_property_failures` now fails on any track record on the three seeded unknowns. Cassettes
  unchanged (confidence is computed by code after the model call); `torch eval` OK in both modes.
- Tests: `test_policy_table.py::test_unknown_situation_has_no_borrowed_track_record`, `test_inbox_truth.py`, the
  MSW step-3b test, an InboxPage test and the `@demo` step 8 (opens #4744 and reads the track record).

### Mock-only routes show only their own design

`docs/design/mocks.html` (and its copy in `apps/web/public/design/`) gained a `?frame=<screen id>` mode: a head script
replaces the body with that screen's `.frame > .app` before first paint (the page is hidden until then), and frame CSS
drops the mock's own sidebar and top bar (a second sidebar, a dead search box, a second clock). No exploration copy is
in the document at all, at any scroll position. `MockOnlyBanner` uses it for the iframe and for "Open the design ↗"
(the old link landed on the exploration page). Rejected: extracting the screen in the app from fetched HTML (depends on
mock-internal selectors and loses parent-scoped styles), and a screenshot (goes stale). The banner names the mock
screens from `NAV` ("Payments and Patients are designs; every other screen in the sidebar reads the live API"); the
appeal workbench keeps its own note. e2e: `shell.spec.ts` checks all three routes.

### Not fixed here (follow-ups)

- **Diaz #4611 is itself wrong (finding 4, second half; fix list item 7).** A CO-45 contractual adjustment posts with
  the ERA; the real decision is a tier-2 patient transfer plus statement. When that lands, Diaz stops waiting on
  Dr. Morgan and step 1 reads "12 items need you" with no waiting line; the feature still shows at step 8 (Ito, Morris).
  The red team suggests seeding one real owner-only item (e.g. a write-off of the practice's own timely-filing miss).
- **Castillo #4797 still shows the records-request rule's 91 of 97** (finding 5 mentions it). It is a named situation,
  so this fix doesn't cover it; a base rate counted over the same situation and root cause would.
- **Finding 3 (signer):** the waiting rows say Dr. Morgan for the Ito and Morris appeals, while their `signer_note` and
  the Denials row still say "Dr. Lee or Dr. Morgan" / "Dr. Lee signs". Fixing who holds those items fixes all three.
- **The Patients design still shows Foster's old numbers** ("$32 disputed", "owe her $6.40") inside `mocks.html`'s
  r7-s2 screen, which `/patients` now shows on its own. Design-doc content; not changed here.
- `docs/STATUS.md` not updated in this branch, to keep the coordinator's merge with `rt-seed` clean.

## rt-signer

Finding 3 (one Denials row named two signers) and the Castillo note under finding 5 (a named situation still showed
the records-request rule's 91 of 97). The owner decided two things: the treating dentist signs clinical appeals, so
Dr. Lee signs Ito's and Morris's; and Castillo shows only its own situation's record. One red-team subagent (a dental
billing lead) settled the remaining calls, and its answers were adopted as below.

### One signer, named by the server

| Decision | Choice | Why / alternative rejected |
|---|---|---|
| Who signs | `moves.signer(snap, item)`: the item's assignee, else for a clinical sign-off (`formal_appeal`) the claim's treating dentist (`treating_dentist`: the rendering provider's login), else the owner. Clinical holds (note unsigned, procedures not in note, rendering mismatch) wait on the treating dentist by the same rule (`claim_signer`). | The old `_sole(role)` picked "the only user with the dentist role" (Dr. Lee) and Denials read the provider (Dr. Morgan). Setting `assignee_user_id` at creation (the report's first option) would store a fact that can be derived, and every creator would have to remember it. |
| Morris #3561 | The seed now records Dr. Lee as the rendering dentist of the 10/30/2025 crown visit (visit, lines, note signer and claim provider all follow from `make(provider=PRV_LEE)`). | The owner's decision ("Dr. Lee signs Morris's") plus "treating dentist signs" is only true if Lee treated Morris. No cassette covers Morris; `make eval` is OK in both modes. |
| Who may approve | `can_approve`: the named signer, or the owner (override). `services.inbox._check_authority` raises 403 `tier_requires_owner` on the same test, naming the signer. Any dentist no longer approves any appeal. | Owner's rule. |
| Whose count | `can_act` (what "N items need you" counts) adds: an item that names someone else is not yours, even for the owner. Dr. Morgan's Inbox shows "Waiting on Dr. Lee · 2" and keeps her approve as an override. | Red team: counting Dr. Lee's appeals as hers double-counts and invites the owner to sign to clear her number. |
| Waiting rows | A signed item's row names its signer only (`signer_ids = [signer]`). Rows come in the order of their oldest item, in the API and the mock. | First-seen order was the store's id order (random ids), so API and mock disagreed on order. Oldest wait first puts Diaz (10/27) before the appeals. |
| Signer note | "A formal appeal goes out over the treating dentist's signature, so Dr. Lee signs this." / "Writing off money commits the practice, so Dr. Morgan signs this." The owner's override is not mentioned. | Red team: telling billing the owner can also sign teaches them to walk it to whichever dentist is free. |
| `InboxItemOut.signer_user_id` (new field) | The id `moves.signer` names. The claim screen's open-items panel used it instead of `USERS.find(u => u.role === it.required_role)` (a client-side signer guess: "Someone else signs this" on Ito). | Same bug class as finding 3. |
| Denials row signer | `_denial_signer`: the open item's signer, else `claim_signer` by the route's role. | It hard-coded "Dr. Morgan" for owner routes. |

Demo after the night: Dana "14 items need you: … · 1 waiting on Dr. Morgan · 2 waiting on Dr. Lee"; Dr. Lee's badge 2;
Dr. Morgan "Waiting on Dr. Lee · 2". Step 1 is unchanged (Diaz, Dr. Morgan · 1).

Tests: `tests/test_signer.py` (at seed, after 3 + 3b and after the night, every signed item: the move label and holder,
the signer note, Dana's waiting row and strip row, and the Denials row name the same person; that person and the owner
pass the approve endpoint's authority check, everyone else gets 403; Ito and Morris → Dr. Lee, Diaz → Dr. Morgan).
`test_inbox_truth.py` gained two `# rt-signer` lines (a waiting item has a signer note, or the viewer is the owner who
may sign in the signer's place; the night's rows). MSW: `db.s2.test.ts` step 8; e2e `06-overnight.ts` (header, the
"Waiting on Dr. Lee" region) and `09-denials.ts` (the Morris row says only Dr. Lee).

### Track records per situation

- `Rule.situation_rates: dict[situation, BaseRate]` (schema: optional on `Rule`). `policy.confidence(rule, situation)`
  reads only this situation's past cases; a situation missing from the map is "No past cases like this yet." The rule's
  `base_rate` stays its whole scope and appears only on the Rules screen and rule proposals. `item_learnable` counts
  the situation's n. Row 12 (confidence floor) gates on the same number.
- Castillo #4797 (Guardian CO-16 · M127): **86% · 6 of 7 paid within 30 days**. Red team: count every Guardian
  CO-16 · M127 records request, whatever the root cause, because the question is "when the right chart goes, does
  Guardian pay?". Root cause ours still blocks learning (`root_cause_guard`).
- Under five cases: "{k} of {n} {outcome}, too few for a rate" (red team: keep what counted as success visible), e.g.
  "4 of 4 alternate-benefit transfers balanced, too few for a rate".
- Seed: every rule that produces an item in the demo has its situations' records. Single-situation rules carry their
  whole record under that situation. The patient-transfer rule's `base_rate` is now 4 of 4 (its one situation's).
  Every situation record fits inside its rule (a test).
- #4733 has no rule; its seeded "9 of 11 tooth-history reconsiderations" is that situation's own record. The test checks
  that a rule-less item never shows a rule's whole-scope record.
- Cassettes unchanged: confidence is computed by code after the model call.

Tests: `tests/test_signer.py` (every item at every moment: k/n equal its rule's record for its own situation, 0/0 for
`unknown`; Castillo is 86% · 6 of 7; records fit inside their rule); `test_d1_api3.py` and `test_policy_table.py`
wording; the MSW mock mirrors `situation_rates` and computes overnight items' records (it showed none before); e2e
step 8 opens Castillo and reads "6 of 7 paid within 30 days".

### Not done here (follow-ups)

- **Owner override wording (red team).** An owner can't attest in the first person to care she didn't give. When
  Dr. Morgan approves Dr. Lee's appeal, the letter should switch to reviewing-dentist language, and the Inbox should
  say "Signing as owner and reviewing dentist". That needs the appeal draft and the Inbox decision pane (`src/features/inbox/**`,
  the other session's files). Today the API lets her approve, and the Inbox shows the item under "Waiting on Dr. Lee"
  with no signer note, so the web's `isBlocked` (signer note present) leaves her Approve enabled.
- **Morris is administrative (finding 3, second half; fix list item 8).** A CO-29 with the payer's own 277CA is a
  reconsideration billing sends. The owner kept it a formal appeal signed by Dr. Lee. The letter must not carry clinical
  attestation wording. Also show the 277CA date next to MetLife's 12-month limit.
- **Header wording.** The red team prefers "14 need you · waiting on Dr. Lee 2, Dr. Morgan 1". The server's
  rows and labels support it; the string is built in `src/features/inbox/selectors.ts` (`waitingLine`).
- **Castillo wording.** "Sent the FMX without the perio chart", not "instead of"; the request should send the perio
  chart and re-attach the FMX. This is seed and agent-script text, not changed here.
- `docs/STATUS.md` is not updated in this branch, to keep the coordinator's merge clean (as rt-truth).
## rt-flash

Two fixes from the final red team: the Approve flash in the Inbox, and the last of Foster #4772's old figures in the
design file. Judgment calls went to one red-team subagent (the hiring Director of Engineering, TanStack-literate). Its
answers were adopted as below. No API change.

### The run pane opens on the click

Before this fix, Approve and ⇧A moved `?item=` to the next item and set `?launch=` only on the 202. For 1–2 s the
next item's pane and its (disabled) Approve showed.

| Decision | Choice | Why / alternative rejected |
|---|---|---|
| Where "Starting" lives | A URL sentinel, `?launch=starting` (`STARTING` in `features/inbox/search.ts`). It is set in the same handler as `mutate()`, with `item` moved to the next item (the cursor) as before. The pane draws "Starting…" from the mutation's variables. | Component state would be a second source of truth for which pane shows. With the URL, the existing rule "selecting drops `launch`" makes J/K leave the Starting pane with no extra code. |
| No frame of the next item | `mutate()` is called before `navigate()`. `useMutation` reads the observer through `useSyncExternalStore`, so any render after `mutate()` sees `isPending`, including the one that commits the URL. Before the URL commits, the approved item's id still names the pane. After the answer, the attempt keeps the pane until the URL catches up. | Rendering only on `isPending` leaves a frame at the 202 (pending is false, the URL still says `starting`), which is the flash again. The red team caught this. |
| Same panel | `ProgressPanel` takes `starting` rows (relay row per claim, "Starting…", the claim's own baton). It is keyed by the attempt (`approve:<submittedAt>`), so when the 202 records the launch, the same instance shows it. Heading focus is applied once per pane. The live line goes "Your approval is on its way to the server." → "Started. The steps show as they run." | A remount would re-run the heading focus, and a screen reader would read the same heading twice. |
| The 202 | `openLaunch` reads `router.state.location`. If the pathname is `/inbox` and `launch` is still `starting`, `launch` becomes the run id. Otherwise the run is only listed under "Runs you started". | Hook-level callbacks run after the reader has left (J/K, `g c`). A `navigate({ from: '/inbox' })` with no `to` would drag them back. |
| A refusal (409 `claim_busy`, 403, network, 409 `file_departed`) | Still on Starting: the URL goes back to the item (and its group) with no `launch`, and the server's reason shows inline under the buttons (`role="alert"`, `data-testid="refused"`). There is no toast, so the reason is said once. Moved on: a toast with "Back to <patient> #N". `useApprove` / `useApproveGroup` take `onRefused(refusal, variables)`. Without it they toast, as before (the claim page). | Pulling the reader back from another item would be worse than a toast with a way back. |
| ⇧A | Same path. The Starting pane has one row per member. `from` (the member the pane showed) is where a refusal returns. | — |
| A / ⇧A while Starting | A toast: "#4705 B. Brooks is starting. Approve opens when the server answers." | Previously the key did nothing. |
| No run expected | An owner sign-off or an eligibility flag (`approveStartsRun`, mirroring the API's `_approve` branches) advances as before, with no Starting pane. | — |
| Reload on `?launch=starting` | The selected item shows. The approval's fate is the server's, and the run is not in this tab's launches. | Showing "started in another tab" would be wrong. |

**Tests.** `InboxPage.test.tsx`, "the run pane opens on the click". Each test holds the approve POST on a promise and
records every decision pane React mounts, from the DOM's own mutation records:

- Starting shows before the answer, and no decision pane mounts. Steps then stream into the same DOM node, and the
  URL goes `starting` → run id.
- A 403 returns to #4705 with the reason, once. Nothing is in `launchStore`, there is no `launch` in the URL, and the
  only pane mounted is #4705's.
- ⇧A: a three-row Starting pane, then three runs in the same node. J leaves the pane.
- J while Starting leaves the pane. A says why it waits. The 202 lists the run and does not pull the pane back.

Three of the four fail on the old code. The ⇧A test fails on an old `doApproveGroup`.
`e2e/run-pane-starting.spec.ts` (@demo, real target only, because MSW's worker answers before a Playwright route can
hold the request): the run pane with "Starting…" shows while the approve POST is held, then the steps follow.
`reload-mid-run.spec.ts` now waits for `launch=run_` before reloading. `launch=` matched `starting`.

### Foster #4772 in `mocks.html`

Changed in both copies, `docs/design/mocks.html` and `apps/web/public/design/mocks.html` (they are identical). The
figures are the seed's: share $33.60 (20% of $168 allowed, deductible met 05/12), $25.60 Cigna underpaid and held,
no refund.

- **Patients (r7):** the row now reads "share $33.60 · paid $33.60 · **$25.60 held** · Cigna underpaid · not hers".
  The design-notes bullet is restated.
- **Round 6 patient-billing options:** the A row reads "share $33.60 · $25.60 held · hold · no refund". The
  true-up table reads "Cigna underpaid $25.60 · PR-1 applied though met". "Nobody bills her the $25.60 Cigna owes"
  replaces "nobody is charged the $32". The Pros line and the intro sentence are updated.
- **Denials footer:** "Payments 5 · $1,175.20 (… Foster $25.60)" replaces $1,181.60 / "Foster $32", in the screen,
  its note and the Round 6 change list.
- **Left as is, because they are the 835 itself:** PR-1 $32.00 and PR-2 $27.20 on the remit line and in its totals,
  "Cigna applied a $32 PR-1", and Foster's own question "Why $59.20?".
- **"Paid at checkout":** this was the mock's existing story. The seed's ledger generates checkout payments, and I
  did not check Foster's in particular.

### Checks

- `make lint`: green. `make test`: API 639, web 152 (28 files).
- MSW e2e: 7 passed, 1 skipped (the real-only spec).
- Real-target `@demo`: 4/4, against the API on :8161 over `apps/api/rt-flash.db` and the web on :5261.

### Left

- `docs/STATUS.md` is not updated, to keep the merge with `rt-signer` clean.
- The rt-seed leftover above ("The Patients design still shows Foster's old numbers") is done.
