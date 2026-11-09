# Plan: build variation D1 (Dashboard) into the app

The owner picked D1 from round 2 (`docs/design/variations/round-2/variants/d1.js`, artifact https://claude.ai/artifact/FrNNQtYKNHQcBxhF7JSDUK). D1 is the visual and behavioural target for the shell, Inbox, Claim and Denials. Every other screen gets D1's shell, tokens and type, with its layout tidied but not redesigned. The demo script stays at 8 steps. Work lands on `feat/d1-dashboard`, then a PR to `main`.

The prototype took its copy from a hand-written `copy.json` and derived whose-move in the browser. The app may do neither (CLAUDE.md: never render a number or fact the server didn't compute). So the build has a server half. These decisions were red-teamed (`docs/design/red-team/challenge-d1-build-2026-11-08.md`, read it) and the result is adopted below. When merged, fold this into ADR-0008 and delete the plan.

## Decisions

1. **Whose move is a server field, and it knows the viewer.** `ClaimSummary.move = {who: practice|agents|payer|nobody, holder_role, holder_user_id, label}` built in `readmodels/claims.py summarize()`. A claim with a queued or running run is `agents`. The UI says "You" when `holder_user_id`/`holder_role` match the viewer, else names the holder ("Dr. Morgan signs"). `Strip.moves[{who,count,cents}]` beside `tiles`, per-tile `by_holder` (for the Denied tally), and `inbox_claims` for the KPI line. Invariant test: moves sum exactly to open claims; tile `by_holder` sums to the tile count.
2. **Action wording comes from the action catalog,** so "what this does" is what runs. `ActionSpec.phrase(params)` gives `InboxItemOut.action_label` ("Send 3 x-rays and resubmit"); `touches: list[str]` comes from the recipe step labels (`executor.py` ~827) plus `hold_window`; `signer_note` when the required role isn't the viewer's. Reuse `phrase` for `Run.action_label` (today the lower-cased enum name, `services/inbox.py` ~77). No new headline fields: use `recommendation`/`summary`/`title`. The client `stepLabel()` in `src/lib/runEvents.ts` goes; show `RunStep.label`.
3. **What changed is computed in the approve service, not the executor.** `ApproveOut.changes` and `GroupApproveOut.changes: [{label, from, to, note?}]`, computed in one transaction in `services/inbox.py` (approve resolves the item before the run starts, a group makes several runs, and the executor has no viewer). "Denied stays 5" is a row with equal from/to. Plus `Run.claim_outcome` (the run's own claim after it ends), added to the eval `RunShape` so deterministic and live must agree.
4. **Where the baton lands** is the post-run claim `move`. For a group, read it after every run in the launch has finished.
5. **The run owns the pane (fixes R1, R2).** Build on the existing `Launch` and `?launch=` URL state with one shared `useActiveLaunch` hook (the claim page approves too). While a launch runs, Approve is disabled only for items on the same claims; J/K/Next stay live. The detail pane shows steps live, then `changes`, then Next.
6. **Styling: keep the token names, change their values** (`border-line`, `text-soft` etc. are used across every feature). Add party tokens (`practice`, `agents`, `payer`), `act` (cobalt, the only action colour), `risk`. Geist is self-hosted (npm `geist` or `@fontsource`), not Google Fonts. Scale 12/13/14/16/22/34. Shared components are restyled in place.
7. **Tests.** Keep landmarks, `data-*` and test-id selectors; visible copy may change where D1 changes it, with the spec updated in the same commit. Pipeline cells stay links. "Runs you started" stays, collapsed. `demo.spec.ts` is split into one file per screen so sessions don't collide. New tests: moves invariant; MSW `move`/`changes` parity with the API on the canonical seed; no Approve enabled for a claim under a running launch.
8. **D1's rough spots are not copied:** the long history label masked by a halo is fixed properly; the Inbox nav count uses `strip.inbox_open`.

## Sessions (at most two at once)

Only `d1-contract` and `d1-api` touch `generated.ts`, `schema.ts` and the snapshot.

| Phase | Session | Owns |
|---|---|---|
| 0 | `d1-contract` | Schema-only: all new fields as stubs in `schemas.py`, `make gen-api`, `schema.ts` names, MSW placeholders in `mocks/`; split `e2e/demo.spec.ts` per screen. Green and committed. |
| 1 | `d1-api` | Real values for every new field in `apps/api/**`, the same in `mocks/db.ts`, invariant + parity tests. |
| 1 | `d1-shell` | `styles.css`, fonts, `src/components/**`, `src/features/shell/**`, a `Baton` component, KPI cards and pipeline bar (moved out of `InboxPage.tsx` into the shell). |
| 2 | `d1-inbox` | `src/features/inbox/**`, `ProgressPanel`, `useRun`, `lib/runEvents.ts`, launches and `useActiveLaunch`, inbox e2e file. |
| 2 | `d1-claim-denials` | `src/features/claim/**`, `src/features/denials/**`, their e2e files; uses `ProgressPanel`/`useActiveLaunch` without editing them. |
| 3 | `d1-rest` | Every other feature folder and e2e file; `make lint test e2e eval`; ADR-0008; decisions-log row; STATUS. |

Each session branches from `feat/d1-dashboard`, commits to its own branch, and stops; the coordinator reviews and merges in order. Decisions a session meets go through `/challenge --red-team` per `docs/SESSIONS.md`.

## Phase 0 notes (`d1-contract`)

Judgment calls met while writing the schema-only change. Lean first; red-teamed below.

1. **The `{label, from, to, note?}` row.** `from` is a Python keyword. (A) `from_` with `alias="from"`, as `AdvanceAccepted` does; (B) wire names `before`/`after`; (C) `from_value`/`to_value`. **Lean B:** no alias to forget on construction (`populate_by_name` is off), reads plainly in TS, and the values are strip numbers before/after one approval. Type `int` (counts; money stays cents if a row ever needs it). Model name `StripChange`.
2. **A stable key on that row.** D1 finds the Denied row by `label === 'Denied'`, so copy edits would break the tally. (A) label only; (B) add `key: str` (a tile status, `inbox`, or `moves.<who>`). **Lean B.**
3. **`by_holder` shape.** (A) `list[HolderCount{who, holder_role, holder_user_id, count}]`, same holder fields as `ClaimMove` so the web compares with the session user one way; (B) `dict[MoveWho, int]`, which can't tell "you" from "Dr. Morgan". **Lean A.** `Strip.moves` is `list[MoveCount{who, count, cents}]`: viewer-neutral, "Yours" comes from `inbox_open`/`inbox_claims`.
4. **Required vs default.** Read-model fields in `schemas.py` are required with no default (the convention there; generated Zod then makes them non-optional in both directions, and MSW must send them). `Run.claim_outcome` is a stored entity field, so `= None` like its neighbours (old rows load). `action_label`/`signer_note` are `str | None` (None when there is no proposed action / the viewer can sign), not `""`.
5. **`MoveWho` lives in `domain/enums.py`,** because `Run.claim_outcome` (domain) needs it; `ClaimOutcome` is a value in `domain/values.py`.
6. **Stubs.** `move = {who: nobody, holder_role: null, holder_user_id: null, label: ""}`, `moves = []`, `by_holder = []`, `inbox_claims = 0`, `action_label = null`, `touches = []`, `signer_note = null`, `changes = []`, `claim_outcome = null`. Same in the API and MSW. Nothing renders them yet; phase 1 replaces every one and adds `claim_outcome` to the eval `RunShape`.
7. **Splitting `demo.spec.ts` while steps share state.** The MSW db lives in the tab's sessionStorage, so state can't cross files or browser contexts. (A) one test whose body calls per-area step functions; (B) Playwright's documented "test list" pattern: `e2e/demo.spec.ts` declares a serial describe with one page made in `beforeAll` and imports one registration function per area from `e2e/demo/*.story.ts`, each adding its own `test()`; (C) each area file replays earlier steps as setup. **Lean B:** each area reports pass/fail on its own, a failure skips the rest as before, the order lives in one 20-line file, and sessions edit only their `*.story.ts`. C doubles run time and duplicates the story. The two standalone tests become their own spec files.

**Red-team result, adopted** (`docs/design/red-team/challenge-d1-contract-2026-11-08.md`, hiring Director of Engineering persona):

- 1: `before`/`after`, int, and `note` has no default.
- 2: `key` is a closed `StripChangeKey` Literal: `inbox`, `inbox_claims`, `tile.<status>`, `move.<who>`.
- 3: `HolderCount` and `ClaimMove` both carry `mine: bool`. The server owns the one "is this mine" rule, and the web never compares holders itself. d1-api threads the viewer into `summarize()`.
- 4, 5: kept. A paused run has no `claim_outcome`; it is set at a terminal status.
- 6: stubs satisfy the invariants:
  - `moves` has four rows, with every open claim under `nobody` (matching each claim's stub `move`), and `by_status` filled for that row.
  - `by_holder` is one `nobody` row equal to the tile count.
  - `inbox_claims` and `inbox_visits` are real distinct counts.
  - `test_invariants.move_totals` and the MSW `invariants()` check all of it now.
- Fields the red team found missing, added as stubs:
  - `InboxItemOut.lands`
  - `Strip.inbox_visits`
  - `MoveCount.by_status`
  - `TimelineEntry.who`
  - `InboxGroup.action_label` / `touches`
- Not added: "paid claims still in your Inbox" (drop that D1 tooltip) and plain procedure names. d1-api decides the second and may add the field, since it owns codegen. Recommendation to the coordinator: route later contract gaps through d1-api or a coordinator contract commit, not the browser.
- 7: changed to A. `e2e/demo.spec.ts` is one test that calls per-step functions in `e2e/demo/NN-*.ts`, split by step with an owner table in `e2e/demo/README.md`, and step 10 is split into Cash and Denials. Not adopted: a `goto` plus "inherited state" assertion at the start of each step. It would change what is asserted, which phase 0 must not do. Owners may add it.

## Phase 1 (shell) notes (`d1-shell`)

Judgment calls met while building the shell. Lean first; red-teamed below.

1. **Where page content sits.** D1 is a grey canvas with white panels. Every feature today paints flat on white. (A) The shell wraps `<Outlet/>` in one white panel (border, radius 10) on the canvas; a route opts out with `staticData: { panel: false }` (typed via `StaticDataRouteOption`) when it draws its own panels, as Inbox/Claim/Denials will in phase 2. (B) Pages sit on the canvas and each feature adds its own panels. (C) Keep the main area white; only the sidebar and header change. **Lean A:** every screen gets D1's look now without touching feature folders, and the opt-out is one line in a route file the phase 2 owner already edits.
2. **Which header where.** The prototype shows the KPI cards + to-scale bar on Inbox and a one-line pipeline on Claim and Denials. (A) Full header on `/inbox` only, the one-line pipeline on every other screen; (B) full header everywhere; (C) one-line pipeline only on Claim/Denials, nothing on the rest. **Lean A:** step 5 clicks a pipeline cell "from any page", the strip is the product's spine, and the one line costs 44px. On `/claims` with one status filter, that cell shows as active.
3. **The "Yours" card's numbers.** `Strip.moves` is viewer-neutral; the contract says "Yours" comes from `inbox_open`/`inbox_claims`. (A) Big number `inbox_open` items, sub "`inbox_claims` claims, `inbox_visits` upcoming visits"; agents card `moves.agents.count` claims with its `by_status` as the sub; payers card `moves.payer.count` claims, sub "`money(cents)` waiting on a reply". (B) Show `moves.practice.count` claims as the big number. **Lean A** (contract as written; it matches the Inbox nav count, which D1 fixed to `strip.inbox_open`).
4. **The "⚑ N claims need action" link** on today's strip. D1 dropped it. (A) Keep it in the full header's top line, (B) drop it. **Lean A:** the derived `needs_action` flag is a hard-rule concept and the link is the only path to `/claims?flag=true` outside the Claims screen.
5. **Persona switcher.** D1 draws two names as a segmented control; the demo has four users and `e2e/demo/shared.ts` (coordinator-owned) drives a `<select aria-label="Switch user">`. **Lean:** a native select styled as D1's segmented well, showing the name only.
6. **Outage.** Today a full-width banner over every screen. D1 moves it to one muted line in the sidebar foot. **Lean:** D1's line, `role="status"`, full sentence in its title and as visually hidden text, plus the payer's name, so a reader learns it once per screen without a banner pushing the page down.
7. **Type scale on the existing names.** `text-2xs`/`xs` → 12, `sm` → 13, `base` → 14 (body), plus `text-md` 16, `text-title` 22, `text-kpi` 34. Nothing under 12. Arbitrary `text-[Npx]` in files I own are replaced; the rest are left to their phase owners, listed in the hand-over.
8. **Colour tokens.** Existing names keep their roles with D1 values (`ink`, `mid`=ink2, `soft`=ink3, `line`, `fill`=sunk, `acc`=act cobalt, `bad`=risk red, `warn` takes D1's amber ink). New: `canvas`, `hover`, `track`, `line-strong`, party triples `practice|agents|payer` (`-ink`, `-bg`, `-line`), `act` (+`-hover`, `-bg`, `-line`), `risk` (+`-ink`, `-bg`, `-line`). `acc` and `act` are the same value; `act` is the name new code uses.

**Red-team result, adopted** (`docs/design/red-team/challenge-d1-shell-2026-11-08.md`, hiring Director of Engineering persona):

- 1 + 2: one typed switch, `staticData.chrome = { header: 'full'|'slim'|'none', panel }` read from the leaf match (`features/shell/chrome.ts`); default `{ slim, panel }`. The panel is the scroll container. `/inbox` sets `header: 'full'` (one line in `routes/inbox.tsx`). The active pipeline cell comes from `useMatch('/claims/')` search, with `aria-current`.
- 3: as leaned; every big number prints its unit; payer sub says "billed"; no "these add up" tooltip.
- 4: kept, from `strip.flagged_count`, in ink (red is for money at risk and "ours" only).
- 5: native select; option text is name · role ("Dr. Morgan · Owner"); "(demo)" stays visible.
- 6: hybrid. The sidebar line is the global indicator (full sentence in text, not a tooltip). A per-item "came back because the Cigna portal is down" note is phase 2 (d1-inbox / d1-claim-denials).
- 7: line-heights set with each size; all ten routes checked at 1280×800 (`e2e/shell.spec.ts` asserts no horizontal scroll).
- 8: `acc*` are aliases of `act*` (deprecated; d1-rest replaces them). `warn*` is neutral (ink on grey), so amber only ever means "yours". `bad*` aliases `risk*`; every `text-bad` use is the phase owner's to check (list in the hand-over).
- Missed, done here: the pipeline renders `open_count`, `ar_cents`, `flagged_count` (no client sums); KPI batons and legend marks are `aria-hidden`; the bar has a label with its counts; skip link; global reduced-motion rule. Left for d1-rest: `openTotals`/`arTotals`/`flaggedTotal`/`tileFor`'s zero tile in `lib/strip.ts` (still used by Claims).
