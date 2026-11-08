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
