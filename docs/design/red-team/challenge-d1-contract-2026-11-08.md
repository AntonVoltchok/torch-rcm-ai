Red team, written as the hiring Director of Engineering (TanStack-literate), 2026-11-08.
Given: CLAUDE.md, `docs/plans/d1-build.md` with its "Phase 0 notes" (the position attacked), the earlier D1 red team, the working-tree `schemas.py` and domain additions, `e2e/demo.spec.ts`, `playwright.config.ts`, `mocks/browser.ts`, and excerpts of `d1.js`. Not given: the `d1-contract` session's conversation.

# Challenge: D1 phase 0 contract (`d1-contract`)

## Verdicts on the seven calls

1. **Adopt B** (`before`/`after`, int). Fix one thing: `StripChange.note: str | None = None` has a default, so the generated Zod is `.optional()`. That breaks call 4's rule. Drop the default.
2. **Change.** Keep the key but make it a closed type. As `key: str`, the contract exists only in a comment. A phase-2 session coding against `"denied"` or `"moves.agents"` gets a row that silently vanishes, and the API↔MSW parity test can't catch it because both sides would agree on the wrong string. Use a Literal (`inbox`, `inbox_claims`, `tile.<status>`, `move.<who>`) so a wrong key is a tsc error.
3. **Change (small).** Keep A and add `mine: bool`. `strip()` already takes the viewer. Without `mine`, the web has to re-implement `visible_inbox`'s "role match when `holder_user_id` is null" rule, and that is server business logic.
4. **Adopt.** Apply it to `note` (call 1). For `Run.claim_outcome`, write down when a *paused* run counts as ended.
5. **Adopt.**
6. **Change.** The stubs are valid empty states, but some break the schema's own contract: `moves=[]` breaks "one row per MoveWho; sums to open_count". d1-shell builds the KPI cards in phase 1, in parallel with d1-api, against zeros and never sees a populated state. Make the stubs satisfy the invariants:
   - `moves`: four rows, with every open claim under `nobody`.
   - `by_holder`: one `nobody` row equal to the tile count.
   - `inbox_claims`: compute it for real (a one-line distinct count).
   - Write the invariant test now, so it is green from day one.
7. **Change to A.** B buys nothing:
   - Serial mode skips everything after a failure, and later tests depend on earlier state anyway.
   - `test.step` already reports each step.
   - B swaps the `page` fixture for a module-level `let page`.

   Split by **step, not area**, because the story interleaves areas (Inbox 1–4, Claims 5, Settings 6–7, Inbox 8, Activity 9, Cash + Denials 10). Use `e2e/demo/NN-*.ts` with an owner table, and split step 10 into Cash and Denials. Make each step start with a `goto` plus an assertion of the state it inherits. Shared helpers go in a file owned by phase 0.

## Playwright claims, with confidence

- `browser.newPage()` in `beforeAll` inherits `use`: ~80%.
- Tracing a context shared across tests: ~60%.
- Serial mode skips the rest after a failure: ~95%.
- Files run in alphabetical order with one worker: ~85%, and the docs say not to rely on it.
- `*.story.ts` is not picked up by the default `testMatch`: ~90%.
- sessionStorage state can't cross contexts or files: correct.

## Strongest case against

Phase 0 freezes a contract before the producer has found the semantics, and it forbids anyone but d1-api from fixing it. Gaps that phase-2 sessions find have no owner, so those sessions will stall or derive the values in the browser. Codegen should be *serialised through the coordinator* rather than forbidden.

## Likeliest downstream failures

1. Missing facts get derived in the browser, copied from d1.js (`LANDS`, `legs()`, `totals()`).
2. "Is this mine" diverges across the Baton, inbox rows and the claim header. Fix it with a server-side `mine`.
3. The e2e handoff breaks: d1-inbox changes where step 4 leaves the page, and step 5 still assumes the old URL.

## Missing from the schema

- `InboxItemOut.lands` (where the baton goes before approval; d1.js:47, 264, 415, 621, 709).
- `Strip.inbox_visits` (d1.js:133, 204), and paid claims still in the Inbox, or drop that tooltip (:203).
- A per-status split on `MoveCount` ("N ready, M sent", :197).
- `TimelineEntry.who` (baton history, `legs()` :535–547).
- `InboxGroup.action_label` and `touches` (:278, :413).
- Plain procedure names (d1.js:52, 266): send them from the server, or decide to show codes.
