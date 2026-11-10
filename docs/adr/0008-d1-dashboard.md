# ADR-0008 — D1: the dashboard redesign, and the server half it needed

Status: accepted · 2026-11-08

## Context

The owner picked variation D1 from round 2 (`docs/design/variations/round-2/variants/d1.js`). D1 is the target for the shell, Inbox, Claim and Denials. Every other screen took D1's shell, tokens and type without a redesign, and the demo script stayed at 8 steps.

The prototype read its copy from a hand-written `copy.json` and worked out whose move it was in the browser. The app may do neither: the server computes every fact and number the UI shows. So most of D1 is a server change. Ten sessions built it in phases (contract, API, shell, Inbox, Claim and Denials, the other screens, two API gap passes and this one). Each phase red-teamed the calls a reviewer could have made differently. This ADR folds in the plan (`docs/plans/d1-build.md`, now deleted; the worker notes and red-team reports cite it, and its last full text is at commit b8e13bf) and each phase's adopted result. The hand-overs are in `docs/adr/worker-notes/d1-*.md`.

Red-team reports, all in `docs/design/red-team/`:

| Phase | Report | Persona |
|---|---|---|
| Plan | `challenge-d1-build-2026-11-08.md` | hiring Director of Engineering |
| 0 contract | `challenge-d1-contract-2026-11-08.md` | hiring Director of Engineering |
| 1 API | `challenge-d1-api-2026-11-08.md` | dental billing lead |
| 1 shell | `challenge-d1-shell-2026-11-08.md` | hiring Director of Engineering |
| 2 Inbox | `challenge-d1-inbox-2026-11-08.md` | Director of Engineering with a dental billing lead |
| 2 Claim, Denials | `challenge-d1-claim-denials-2026-11-08.md` | dental billing lead |
| 4a API (headline, learnable, 409) | `challenge-d1-api-3-2026-11-08.md` | dental billing lead with the Director of Engineering |
| 4b API (server totals) | `challenge-d1-api-4-2026-11-08.md` | Director of Engineering |

Phase 3's other screens (d1-rest) were red-teamed inside the session, and only the adopted result was kept (worker note `d1-rest.md`). The phase 3 API pass (d1-api-2) carried out coordinator decisions and needed no red team.

## Decisions

Each entry gives the decision, the reason that carried it, and what a reviewer could question, with the answer.

### 1. Whose move is a server field, and it knows the viewer

`ClaimSummary.move = {who, holder_role, holder_user_id, label, mine}`, from one function (`readmodels/moves.py`). The first matching rule wins: closed → active run → open item → hold → queued file → status. `Strip.moves` and `by_holder` are built from it, and an invariant test says the moves sum to the open claims.

- **Reason that carried** (billing lead): a payer is named only on evidence that the payer owes a reply. Unworked A/R must not hide behind "Waiting on Delta". So `rejected` goes to the practice. `denied`/`partial` go to the payer only if something left after the last remittance. `sent` goes to the practice after 2 business days with no acknowledgment. `ready` goes to the agents only while send-claim is Auto.
- **`mine` is a server bool** (contract red team), so the browser never compares holders. `label` is viewer-neutral.
- **Reviewer:** "Why not derive it from status in the browser, as the prototype did?" **Answer:** the rules need runs, items, holds, file entries, rule modes and the clock. A browser copy would be a second policy that drifts. The hard rule is that the server computes every fact.

### 2. Action wording comes from the action catalog

`action_label`, `touches`, `lands` and `signer_note` come from `ActionSpec` (`catalog/phrases.py`). `RunStep.label` is shown verbatim, and the client `stepLabel()` is gone.

- **Reason that carried:** "what this does" must be what runs. `lands` comes from the class of action plus the whose-move rules with the item resolved, not from a per-action table. A test checks `lands == claim_outcome.move_to` for every approvable canonical item.
- **Reviewer:** "Tier 3 says it signs a write-off, but nothing posts it." **Answer:** that is correct. Tier 3 is human-only, and posting in the PMS is a person's job. The label says "Sign $228 write-off, $1,012 to patient", and `touches` names what is left to post.

### 3. What changed is computed in the approve service

`ApproveOut.changes` / `GroupApproveOut.changes` are rows of `{key, label, before, after, note}`, built by comparing `strip(viewer)` before and after, inside the approve transaction. `Run.claim_outcome` records the claim's status and move before and after, and it is part of the eval `RunShape`, so live and deterministic mode must agree.

- **Reason that carried:** approve resolves the item before the run starts, a group makes several runs, and the executor has no viewer. `key` is a closed Literal, so the UI never matches on a label.
- **Reviewer:** "Why no `move.*` rows?" **Answer:** at approve time they only say "agents +N". Where the baton lands comes from the claim's `move` after the run.

### 4. The run owns the pane, and a busy claim is the server's word

Launches live in `?launch=` and sessionStorage. One `useActiveLaunch` hook serves the Inbox and the claim page. Approve, Reject and Snooze lock when `item.claim.move.who === 'agents'` or when this tab has a launch run on the claim that is not yet terminal. J/K/Next stay live. The server enforces the same predicate as `409 claim_busy` (`moves.active_runs`, all or nothing for a group, never stored under its Idempotency-Key).

- **Reason that carried:** R1/R2 from the UX audit. The old panel hid the run's steps and armed the next item while a job was still running. Covering runs the rules started and other tabs needs the server's word, not this tab's memory.
- **Reviewer:** "One predicate, or two that could disagree?" **Answer:** one. An invariant test says that for every open item, `move.who == agents` exactly when approve answers 409.

### 5. The Inbox reads what the server says, up front

`headline` is built from the code's situation key (never a live model's), so both modes give the same words. Every canonical item has a golden string. `learnable: {ok, code, reason}` is the same function `POST …:always-auto-run` calls. "Propose always auto-run" shows only when `ok`. `Confidence` gains required `k`, `n` and `outcome`. A validator enforces `pct` exactly when n ≥ 5. The client bolds `k of n` and never parses `basis`.

- **Reason that carried:** the Policy layer is the only thing that decides. A link that offers and then refuses (audit A6) is a policy the browser guessed.
- **Reviewer:** "Stored Confidence changed shape." **Answer:** yes. A database from before this change needs `make seed` after merge.

### 6. Tier gap and #4772: closed with a Policy guard, not a new action

`policy.unreviewed_text()` sends text that a recipe step sends only if it is, word for word, the body of an approved `review_draft`. The executed `then` of a `post_era_line` becomes its own Policy-decided action in the same run.

- **Reason that carried:** a new tier-2 action would change the tool enums and force a cassette re-record. The guard closes the same hole (agent text reaching a payer unreviewed) and is tested in `tests/adversarial/test_reprocessing_text.py`.
- **Reviewer:** "Is a guard weaker than a separate action?" **Answer:** no. Triage proposes the text as a `review_draft`, and approval refuses anything that isn't the approved body. No mutating tool is exposed to the model either way.

### 7. Styling keeps the token names and changes their values

`border-line`, `text-soft` and the rest keep their roles with D1 values. New tokens: party triples (`practice` amber, `agents` teal, `payer`), `act` (cobalt, the only action colour), `risk` (red, for money at risk and root cause "ours" only). Geist is self-hosted. The scale is 12/13/14/16/22/34, with nothing under 12. The chrome is one typed `staticData.chrome = {header, panel}` per route. The full KPI header is on `/inbox`, and a one-line pipeline is on the other screens.

- **Reason that carried** (shell red team): every screen got D1's look without touching feature folders, and the opt-out is one line in a route file. Amber only ever means "yours", so a caution is ink on grey and says itself in words.
- **d1-final:** the deprecated `acc*`/`bad*`/`warn*` aliases and the unused `text-2xs` step are deleted. Chip tones are named `act`/`risk`/`caution`. The warning toast's amber glyph is now neutral.
- **Reviewer:** "Why keep old names with new values instead of renaming everywhere?" **Answer:** the change stayed reviewable, phase by phase. The only names that lied (`acc`, `bad`, `warn`) are now gone.

### 8. Claim and Denials

History lanes are an HTML grid with Practice, Agents and the payer's short name as rows, so text wraps instead of overlapping. Every remittance leg, the fix and the now leg are pinned against folding. On an estimate, the money card has two columns: Expected (the contract's estimate) and Per the 835. A `review_draft` has no send on the claim page: the primary is "Read and send in Inbox". Denials rows sort by deadline inside the server's groups. They support J/K/Enter with `?row=`, and the claim page has "Next denial".

- **Reason that carried** (billing lead): a denial pass goes deadline → reason → evidence → send → next. Nothing on these screens may make a biller bill the wrong party or send agent text nobody read.
- **Reviewer:** "Why not D1's SVG with a text halo?" **Answer:** the halo hid overlaps. A grid makes the text real (selectable, zoomable, in screen-reader order) and needs no measuring.

### 9. Domain aggregates come from the server; positional counts may not

Any count or sum of rows that a screen presents as a fact about the practice is a server field, with an invariant test that it equals its rows. The fields added under this rule:

- d1-api-4: `LedgerToday.totals` and `files`, `Strip.all_count`, `EligibilityOut.by_day` and `total`, `RulesOut.rules_count`, `TierGroup` counts, `PreviewOut.held_total`/`before_holds`/`net_change`, `RuleChangeList.digest`, `ActivityRow.move` and `ActivityOut.by_day`.
- d1-final, the last one: `DenialsOut.matrix`. It holds `{columns, payers[{payer, cells, total}], totals, total, excluded}`, one cell per column with zeros included, and plan limits (PR-*) left out and counted in `excluded`. The tests are `test_server_totals.py::test_denials_matrix_*` (over HTTP, with an independent recount by CARC) and `selectors.test.ts` (the mock after the overnight). `parity.json` holds the mock's matrix equal to the API's on the seed.

Presentation over a complete list the server sent is allowed, and these stay in the browser on purpose: "i of n" for Next denial, "+N earlier" on a folded history, `RelayTable count={members.length}`, `DraftText` sentence counts, `ProgressPanel` step and run counts, the Inbox's optimistic `withoutItems` (replaced on refetch), and picking file-group rows by `claim_ids`. Each of these indexes or counts a list the server sent whole. None is a business number a second screen could disagree with.

- **Reason that carried** (4b red team): this keeps every business number single-sourced without paginating every list into facets.
- **Reviewer:** "Draw the line at *all* counts on the server?" **Answer:** that is possible, but "3 of 5" over five rows the server sent cannot drift from anything. A count that summarises the practice can, so that is where the rule sits.

### 10. One week

"This week" means the practice week starting Monday (`activity.week_start`) everywhere: Activity, the nav badge, `this_week`, the rule rows' `*_7d`, the preview and the owner digest. The `_7d` names are historical and were not renamed, to avoid contract churn. The Paid view is month-scoped like the strip ("Paid · Oct"). "Open + Paid · Oct" is what an unfiltered `GET /claims` returns. A search (`q`) reaches older paid claims.

## Smaller calls

- Plain procedure names come from the server: `procedures_plain` = "D2740 Crown, tooth 30 + 1 more" (billing staff work by code). There is no CDT dictionary in the browser.
- `TimelineEntry.who` is always the actor. The persona switcher is a native select ("Dr. Morgan · Owner", "(demo)" visible). The outage shows as one line in the sidebar, not a banner.
- `demo.spec.ts` is one test that calls per-step files in `e2e/demo/NN-*.ts`, with an owner table in `e2e/demo/README.md`.
- An Inbox decision refetches the rules table and the Denials worklist (`settle()`, tested).
- The designed mocks that the mock-only routes frame now say TorchRCM.

## Consequences and what is left

- After merge, run `make seed`: stored `Confidence` gained required fields.
- `RuleChange.items_affected_since` is a stored, hand-authored count that no run backs. It needs a derived field and run history older than this week.
- The mock's Paid view is "every paid claim". This equals October on the demo clock and would diverge only past Oct 31.
- ~~The Claims table scrolls inside its panel at 1280 px.~~ Superseded 2026-11-09: no screen scrolls sideways at 1280 px, in the page or in any panel (`e2e/shell.spec.ts` checks every scroll panel under `<main>`). Tables stay tables. Plain tables stack related fields in one cell (procedures under patient · payer, scope under the rule, time over agent) and let long labels wrap (`MoveCell wrap`, notes, ack chains broken only at their arrows). The virtualised Claims table keeps one-line rows and fits through `minmax` column widths. Cards per row were rejected: these are scan-and-compare screens.
- The Payments mock-only banner opens the mocks at `#r3-pay`, and an earlier session saw it land on the Overview. Unverified here.
- Asks still open for the API: `TimelineEntry.short` (the leg word is cut from the title today), `HolderCount.label`, a denial date and follow-up date on Denials rows, and `deadline.days_left`.
