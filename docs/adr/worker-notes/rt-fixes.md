# Final D1 red team: fixes

Findings from `docs/design/red-team/challenge-final-d1-2026-11-08.md`, fixed in two parallel sessions. Each session
writes under its own heading.

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
