Red team, written as the hiring Director of Engineering.
Given: CLAUDE.md, the plan, repo read access. Not given: the coordinator's conversation or the owner's feedback.

# Challenge: D1 build plan (`docs/plans/d1-build.md`)

## 1. The strongest case against

The plan treats "the server computes it" as the cure, but it puts two of the new facts in the wrong layer. `Run.changes` sits in the executor, where it measures the wrong time window. And every new field has to be written a second time in the 1,761-line MSW server (`apps/web/src/mocks/db.ts`), which e2e runs against by default. Nothing checks that the two give the same values. So the plan swaps "logic in the browser" for "logic in the API plus a TypeScript copy that nobody checks", which is the duplication Decision 1 rejects. Meanwhile it skips the parts of D1 that carry the demo: the plain-language headline and run steps, a group shown as one run, and the per-holder tally on the Denied tile. Each session will then quietly work these out in the browser, or ship D1 without its voice.

## 2. Three likely failures

**A. `Run.changes` measures the wrong thing.** Approve marks the item resolved before any run starts (`api/services/inbox.py:135-148`; for a group, `:213-221`). By the time the executor could take its "before" strip, the Inbox count has already dropped. A group of three approves creates three Runs. Each one would hold a partial change list, while D1 shows a single combined "What changed" (`variants/d1.js:450-466`).

The strip also depends on who is viewing (`readmodels/claims.py:114-131,162`), but the executor builds it with no user (`agents/executor/executor.py:328`). The window is also unsafe:
- Approval runs execute inside an advance's `run_due` batch, alongside payer events (`scheduler/runner.py:218-222`).
- Paused runs resume later (`executor.py:680-689`).

So a before/after diff would count other jobs' effects as this run's. Finally, `RunShape` does not include it (`agents/eval/harness.py:41-50`). A difference between live and deterministic mode would pass `make eval`.

**B. `move` ignores the viewer and has a second implementation in the mock.**
- `summarize()` gets no viewer (`claims.py:90-108`), and `needs_action` means "the claim has any open item" (`readmodels/snapshot.py:187-188`). A claim waiting on Dr. Morgan's signature is therefore "you" to Dana, and D1 draws exactly that case as a hatched baton (`d1.js:264,423`).
- The "Yours" KPI counts items (`inbox_open`), while `moves.you` counts claims. D1 reconciles the two with arithmetic in the browser (`d1.js:195-205`).
- The Denied tally needs a per-tile split by holder (`d1.js:209-226`), and `Strip.moves` does not give one.
- `db.ts:381-403` already recomputes the strip in TypeScript. `wire.test.ts` and `real.contract.ts` check the shape of responses, not their values.

**C. The e2e promise conflicts with D1 and with the session table.**
- D1's pipeline is a `role="img"` bar plus cells that are not links (`d1.js:232-244`). The spec needs a "Claim pipeline" region with clickable tiles and "$61,300" (`e2e/demo.spec.ts:37,45,81,118`).
- The spec clicks "Runs you started" → "Approve 3" (`:103-105`), and D1 has no place for that.
- The spec expects one `section[data-run]` per run inside "Agent progress" (`:71-79`). D1 shows one step list for the whole group.
- Decision 7 says to update the spec in the same commit as the copy change, but the session table gives `e2e/` to `d1-rest` in phase 3. Either two phase-2 sessions edit `demo.spec.ts` at the same time, or every break waits until phase 3.

## 3. What I would change

1. **Change.** Keep `move` on the server, but:
   - Use `who: practice|agents|payer|nobody` plus `holder_role`/`holder_user_id`, so the web hatches by comparing the holder with the session user.
   - A queued or running run on the claim means `agents`, not just status.
   - Add `Strip.tiles[].by_holder` and `Strip.inbox_claims`, so every KPI line is a server number.
   - Define the invariant exactly. "Sums to open claims" is false once `nobody` and paid-with-open-item are counted.
   - Add a parity test: the API dumps the per-claim `move` for the canonical seed and after the group approve, and a vitest asserts that `db.ts` matches.
2. **Change (where it lives, not what).** This is not overreach, as long as it is built from the action catalog rather than strings assembled in `readmodels/inbox.py`.
   - Add `ActionSpec.phrase(params)`.
   - `touches` = the recipe step labels from the same `RecipeCtx` that `_act_layout` uses (`executor.py:827-831`). "What this does" then literally is what runs.
   - Use the same phrase for `Run.action_label` at approval. Today `services/inbox.py:77` writes the lower-cased enum name, while the executor writes the catalog label (`executor.py:800`).
   - `signer_note` comes from `role_required`/`TIER3_ROLES`.
   - For headline and why, use the existing `recommendation`/`summary`; do not invent fields. Send the plain CDT names from the server or don't show them; no CDT dictionary in the browser.
3. **Drop as written.** Replace it with:
   - (a) `ApproveOut.changes` / `GroupApproveOut.changes`, computed in the service from `strip(user)` before and after, in one transaction.
   - (b) `Run.claim_outcome {status_from, status_to, move_from, move_to}`: the run's own claim only, safe from races, and added to `RunShape`.
   - "Denied stays 5" is then (a) plus each member's (b), plus a note from the server.
4. **Adopt.** Read the move from the claim refetch that `useRun.ts:40-50` already does. For a group, wait until every run in the launch has finished.
5. **Change.** Build on the existing `Launch` and `?launch=` (`state/launches.ts`; `InboxPage.tsx:3`), so the pane survives a reload. Put the lock in one shared `useActiveLaunch` hook, because the claim page approves too (`features/claim/OpenItemsPanel.tsx:12,31`). Block only approves on the same claims, and keep J/K/Next working. A group can take 45 s (`demo.spec.ts:75`), and locking the whole Inbox for that kills the pace.
6. **Change.**
   - Keep the token names and change their values. `border-line` is used 79 times and `text-soft` 58 times, in files other sessions own.
   - Add `--color-you/agents/payer` alongside the existing tokens.
   - Map D1's type scale onto the existing `--text-*` names.
   - Self-host Geist (npm package). No Google Fonts request at runtime in a demo shown on borrowed wifi.
7. **Change.**
   - Keep the landmarks and the `data-*` and test-id selectors; let copy change.
   - Make pipeline cells links: the no-dead-links rule and `:118` both need them.
   - Keep "Runs you started" as a collapsed strip.
   - Replace "Run.changes matches the strip" with tests on the approval change list and on `claim_outcome` in `RunShape`.
8. **Adopt.**

**Session split:**
- **Phase 0 (coordinator, an hour):**
  - Schema-only PR: the new fields with stub values, `make gen-api`, `schema.ts`, MSW placeholders.
  - Split `demo.spec.ts` into one file per screen.
  - After this, only the coordinator touches `generated.ts`.
- **Phase 1:**
  - `d1-api`: the values, tests, `db.ts` and the parity test.
  - `d1-shell`: tokens, fonts, shell, the Baton component, and the KPI cards and pipeline, moved from `InboxPage.tsx:143` into the shell. The header gets one owner.
- **Phase 2:**
  - `d1-inbox` owns `inbox/**`, `useRun`, `runEvents`, `ProgressPanel`, `state/launches.ts`, and `db.ts` edits.
  - `d1-claim-denials` uses `ProgressPanel` without editing it.
  - Each session owns its own e2e file.
- **Phase 3:** as planned.

## 4. What I would keep

- **`move` on the server.** It is the right instinct, and it is the CLAUDE.md rule an interviewer will test first.
- **Labels from the action catalog.** That is the only version that stays honest in live mode.
- **The run owning the pane through the existing SSE hook.** That hook is already monotonic and safe on reconnect.
- **Restyling Tailwind v4 in place,** rather than forking components.
- **At most two sessions at once,** with the coordinator merging in order.
- **Fixing D1's rough spots** rather than copying them.
- **`make eval` as the final gate,** once `RunShape` covers the new outcome.
