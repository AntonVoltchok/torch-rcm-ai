# d1-api (D1 phase 1, server values): hand-over

Branch `claude/d1-api`, based on `feat/d1-dashboard` @ 89402c9. Not pushed. Ports reserved for this work: API :8021, preview :5191, scratch DB inside the worktree.

Decisions: `docs/plans/d1-build.md` → "Phase 1 (api) notes" and "Red-team result, adopted"; report in `docs/design/red-team/challenge-d1-api-2026-11-08.md`. The adopted list is binding. Where it differs from the numbered lean above it, the adopted list wins.

## Done (commit 75fe905, `make test` api green: 564 passed, ruff + mypy clean)

- `readmodels/moves.py`: `claim_move(snap, claim, viewer_id, basis)`, the whose-move rules (first match wins). It also holds `sees`, `can_approve`, `can_act` and `approver_roles`, plus `TIER3_APPROVERS`; `services/inbox._check_authority` now uses those. `MoveBasis(exclude_run, open_item)` exists for `claim_outcome`.
- `summarize(snap, claim, viewer_id)`: the viewer is threaded through every caller (inbox, claims, screens, denials, ledger/held rows). `item_out`, `item_detail`, `claim_row` and `query_claims` take `viewer_id`.
- `strip()`: real `moves` (+`by_status`), and per-tile `by_holder` from the same per-claim move (`_by_holder`, `_moves`).
- `readmodels/changes.py`: `strip_changes(before, after, viewer, items)`. Its rows are `inbox`, `inbox_claims`, and the tile of each touched claim's status, always present. No `move.*` rows (red team item 7). A note goes on an unchanged tile. `_approve` and `_approve_group` run before → mutate → after in one `store.tx()`, and `meta.counts` is the after strip.
- `tests/test_d1_values.py`: changes match the strip after a group approve, and Denied stays 5 with its note. Also: a replayed approve reports no change, whose move holds on seed claims, and the Denied tally shows billing/mine 4 and owner 1.

## Remaining, in order

1. **`agents/catalog/phrases.py`**: `phrase(action, params, *, payer, n=1, drafted=False)` and `touches(...)`; `ActionSpec.phrase` delegates to it.
   - Wording comes from the adopted list item 3: "Send x-ray and resubmit" / "Send 3 x-rays and resubmit", "Send this note to Delta" (only for `review_draft`), "Send prompt-pay request", "Update ID and resend", "Move $38 to patient", "Post Cigna's payment, dispute $32", "Sign $228 write-off, $1,012 to patient".
   - Eligibility flags read "Note it for the front desk" with the touch "Note added for the front desk".
   - Touches come from a new optional `RecipeStep.effect`, counted across a group, plus one reversibility line per action, derived from `reverses_in` and the predicted file time.
     - Resubmit: "3 x-rays uploaded to NEA", "3 claims in the 11:15 AM Delta file", "Can be pulled from the file until 11:15 AM".
     - Payer request: "1 note sent to Delta" or "1 request sent to MetLife", "Cannot be recalled once sent".
     - Day-close actions: "Can be undone until day close".
   - Tier 3 has no recipe, so its touches say what is left to post: "$228 write-off to post in the PMS", "$1,012 to move to patient balance".
   - Money in prose follows the existing precedent (timeline titles format dollars server-side). Integer cents stay in every numeric field.
2. **Recipe step labels** (`catalog/recipes.py`), plain sentence case: "Fetch the PA x-ray from imaging", "Upload to NEA", "Write the NEA# and original ICN in the claim remarks", "Queue for the 11:15 AM Delta file". Names stay unchanged.
   - Pass `ReprocessingParams.attach` into the `payer_submit` args.
   - Check `grep -rn` on e2e/vitest for old step-label strings. Report any visible-string e2e change.
3. **Inbox fields** (`readmodels/inbox.py`):
   - `action_label`, `touches`.
   - `signer_note` when `not can_approve(viewer, item)`, built from the users holding `approver_roles(item)`: "Writing off money commits the practice, so only Dr. Morgan can sign this."
   - `lands`:
     - filing action → `agents`;
     - reprocessing/records/appeal → `payer`;
     - else `claim_move` with the item treated as resolved (add a `MoveBasis.closed_item`);
     - claimless → `None`.
   - `InboxGroup.action_label`/`touches` with `n` = the member count. `item_out` needs a CaseFile-free file-time prediction: build a `PayerView` from `snap.payers` and reuse `predicted_file_time`.
4. **`Run.action_label`** in `services/inbox._approval_run`: the phrase, not `action.value.replace("_", " ")`. Also the executor's `action_label=first_spec.label` (executor.py ~800).
5. **`Run.claim_outcome`**: in `Executor.run()`, after the state loads, `state.setdefault("claim_before", …)`, using `MoveBasis(exclude_run=run.id, open_item=run.inbox_item_id if approval)`. At `_report`, pass `claim_outcome=ClaimOutcome(...)` into `rt.runs.finish(**extra)` with the run excluded. Do the same on cancel (`services/system.py:134`). Add `claim_outcome` to `RunShape` in `agents/eval/harness.py`. `make eval` must stay green with no cassette re-record; if it needs one, stop and say so.
   - Test: for every approvable canonical item, approve → advance → `run.claim_outcome.move_to == item.lands`.
6. **`TimelineEntry.who`** = the actor (adopted item 9): human → practice, agent → agents, payer/ack/remittance → payer, visit → practice, file entry → agents.
7. **`ClaimSummary.procedures_plain`**: "D2740 Crown, tooth 30 + 1 more", from a new short-name column in `world/fees.py` `CODES`. It is a new schema field, so add it to `schemas.py`.
8. **`make gen-api`**, then `schema.ts` names if new types appear, then `apps/api/openapi.snapshot.json`.
9. **MSW** (`apps/web/src/mocks/db.ts`, around lines 108, 346, 375, 413, 424, 463, 1300 are the phase-0 stubs): mirror `move`, `moves`, `by_holder`, `action_label`, `touches`, `signer_note`, `lands`, `changes`, `claim_outcome`, `who` and `procedures_plain`.
   - MSW has no holds, file entries or remittances per claim. Have an API script dump a per-claim `move` basis on the canonical seed to `apps/web/src/mocks/fixtures/parity.json` (with a pytest that fails when the committed file drifts). TS then computes the dynamic rules (active run, open item, status) and reads the static facts from that file.
   - MSW has a stand-in running run `run_bg_hill_rep` on `clm_4512` that the API seed lacks. Exclude it from parity by name, with a comment.
   - Parity vitest `src/mocks/parity.test.ts`: on the seed and after the Delta group approve, compare `move` per claim, `strip.moves`, every item's `action_label`/`touches`, and the group-approve `changes`.
10. **Checks**:
    - `make lint`, `make test`, `make eval`.
    - `pnpm test:contract`.
    - After commit: `pnpm check:api`.
    - MSW e2e: `pnpm e2e`.
    - Real-target e2e: `E2E_TARGET=real` against API :8021 with a scratch DB and preview :5191 only.
11. **Not adopted, for the coordinator**:
    - The red team found `reprocessing_request` is tier 1 with `carries_text=None` while its recipe sends `ctx.draft.text`. Today only a seeded `review_draft` item ever supplies a draft, so no agent text reaches a payer unreviewed. But the catalog should get a tier-2 `reprocessing_letter`. That changes tool enums, so cassettes need re-recording: a coordinator call.
    - `post_era_line.params.then` is never executed by any recipe.
