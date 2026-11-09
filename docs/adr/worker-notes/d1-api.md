# d1-api (D1 phase 1, server values): hand-over

Branch `claude/d1-api`, based on `feat/d1-dashboard` @ 89402c9. Not pushed. Merge it in after (or beside) `d1-shell`. The two touch no common files.

Decisions: see `docs/plans/d1-build.md`, sections "Phase 1 (api) notes" and "Red-team result, adopted". The report is `docs/design/red-team/challenge-d1-api-2026-11-08.md` (dental billing lead persona). The adopted list is binding; where it differs from the numbered lean above it, it wins. Fold both into ADR-0008 with the rest of the plan.

## What each field is and where it lives

| Field | Where | How |
|---|---|---|
| `ClaimSummary.move` | `readmodels/moves.py` `claim_move` | Rules in order, first match wins: closed → nobody; active run → agents; open item → practice; hold → by reason; queued file → agents; then status. A payer is named only on evidence it owes a reply. `summarize(snap, claim, viewer_id)`: only `mine` depends on the viewer. `label` is viewer-neutral. |
| `Strip.moves` (+`by_status`), tile `by_holder` | `readmodels/claims.py` | From the same per-claim move. |
| `TimelineEntry.who` | `readmodels/timeline.py` | The party that acted (red team item 9). |
| `InboxItemOut.action_label`, `touches`, `signer_note`, `lands`; `InboxGroup.action_label`/`touches` | `readmodels/wording.py` over `agents/catalog/phrases.py` | The phrase comes from the action's params. Touches are the effects (`RecipeStep.effect`) of the recipe steps that will run, counted across a group, plus one reversibility line. Tier 3 has no recipe, so its touches say what is left to post. `lands`: filing actions → agents, payer requests → payer, else the whose-move rules with the item resolved. |
| `Run.action_label` | `services/inbox._approval_run` | The same phrase. The executor no longer overwrites it for approval runs. |
| `ApproveOut.changes` / `GroupApproveOut.changes` | `readmodels/changes.py`, called inside one `store.tx()` in `_approve` / `_approve_group` | Rows: `inbox`, `inbox_claims`, and every touched tile, even when unchanged (with a note). No `move.*` rows (red team item 7). `meta.counts` is the after strip. |
| `Run.claim_outcome` | executor `run()` (before) / `_report` (after); `services/system.cancel_run` | Read around the run, with the run excluded. An approval's "before" counts its item as still open. Part of the eval `RunShape`. |
| `ClaimSummary.procedures_plain` (new) | `world/fees.py` `PLAIN` + `plain_procedures` | For example "D2740 Crown, tooth 30 + 1 more". |
| Recipe step labels | `agents/catalog/recipes.py` | Plain sentence case ("Queue for the 11:15 AM Delta file"). Names unchanged. `ReprocessingParams.attach` now reaches the payer submit. |

Examples on the seed:

- **#4733:** "Send this note to Delta". Touches: "1 note sent to Delta", "Delta EOB · 03/2022 enclosed", "Cannot be recalled once sent". Lands with the payer.
- **Delta group:** "Send 3 x-rays and resubmit". Touches: "3 x-rays uploaded to NEA", "3 claims in the 11:15 AM Delta file", "Can be pulled from the file until 11:15 AM".

## Tests

- `tests/test_d1_values.py` covers:
  - after a group approve, changes match the strip, Denied stays 5, and the note is right;
  - a replayed approve shows no change;
  - whose move on seed claims;
  - the Denied tally;
  - `lands == claim_outcome.move_to` and `Run.action_label == item.action_label` for all 7 canonical approvals.
- Invariants (`test_invariants.move_totals`, phase 0) are green with real values.
- Mock parity:
  - `tests/test_mock_parity.py` writes (`UPDATE_PARITY=1`) and checks `apps/web/src/mocks/fixtures/parity.json`.
  - `apps/web/src/mocks/parity.test.ts` holds `db.ts` to it: whose move on every claim number both sides share, KPI moves, every item's words, group words, and Approve 3 + #4733 changes.

## Mock (MSW)

- `src/mocks/d1.ts` is the TS port of the rules, phrases, effects and changes; `db.ts` calls it.
- Mock item params now match the API seed:
  - `attachment_kind`;
  - #4733 is a `reprocessing_request` with `attach`;
  - write-off and ERA-post amounts;
  - the #4733 prior-EOB evidence title.
- Known, documented divergences:
  - #4512 carries the mock's stand-in background run.
  - #4848 is a pinned Aetna claim in the mock and a generated Guardian claim in the API.
  - The mock's 75 background claims match the API's in count and mix but not in numbers. The parity test therefore compares claims both sides share, and the population through `strip.moves`.
- The mock threads the viewer only through the inbox and approve paths. Elsewhere it defaults to Dana.

## Checks (all green at the last commit)

- `make lint`.
- `make test`: API 572, web 113.
- `make eval`: OK. `claim_outcome` is in `RunShape`, and no cassette was re-recorded.
- `pnpm test:contract`: 51.
- `pnpm check:api`: clean.
- MSW e2e: 3/3 on :5191.
- Real-target e2e (`--grep @demo`): 3/3, with the API on :8021 over a scratch DB in the worktree (deleted after) and the web on :5191.

No e2e assertion changed. One API test assertion changed, because a visible run-step string changed: `tests/agents/test_executor.py` now expects "Queue for the 11:15 AM Delta file" instead of "queue for 11:15 Delta file". The mock's own run steps (`db.ts` ~1669) still use the old lower-case labels. `d1-inbox` owns those run-step mocks in phase 2.

## For the coordinator (not done here, on purpose)

- **Tier gap (red team):** `reprocessing_request` is tier 1 with `carries_text=None`, but its recipe sends `ctx.draft.text`. Today only a seeded `review_draft` item supplies a draft, so no unreviewed agent text reaches a payer. The fix is a tier-2 `reprocessing_letter` action. That changes the tool enums, so the cassettes would need re-recording. That is your call.
- **`post_era_line.params.then` is never executed** by any recipe. So #4772 lands on `practice` ("Underpaid, nothing filed") after posting, and its touches don't promise a reprocessing request.
- **Tier 3 posts nothing.** After Dr. Morgan signs #4611 the claim stays denied, and the baton goes to `practice` ("Denied, nothing filed"). The touches say "$228 write-off to post in the PMS". If the product wants the signed run to post it, that is a policy change.
- **`inbox_claims` still counts every claim behind the viewer's Inbox items,** including #4611, which Dana can't approve. KPI copy should say "claims in your Inbox", not "yours to act on".
- **Phase 2 web work:**
  - `stepLabel()` in `lib/runEvents.ts` can go; show `RunStep.label`.
  - `Strip.moves` has no "Yours" split: use `inbox_open` / `inbox_claims` and `ClaimMove.mine`.
