# Plan — web-shell (S1 worker, `apps/web/`)

Owner: `apps/web/`. Status in `docs/STATUS.md` → "web-shell". This file records judgment calls and every assumption
about the API contract that 02-api / 01-domain-model leave open.

## 0. Environment blocker (read first)

The session's egress proxy refuses `registry.npmjs.org` (403 on CONNECT; policy denial, not retried or routed around).
Nothing from `package.json` could be installed, so **`pnpm install / lint / typecheck / test / build` have not run.**
What was verified locally with the tools present on the image (TypeScript 6.0, zod 3.25, esbuild, tsx):

- Every `.ts/.tsx` file parses (esbuild transform).
- Every React-free module typechecks under `strict` + `noUncheckedIndexedAccess`: `api/schema|client|endpoints|queryKeys`,
  `lib/*`, all search-param schemas, inbox selectors, nav, stores, the whole mock server (`mocks/db.ts` + fixtures).
- The pure Vitest suites run green through a 40-line `describe/it/expect` shim kept outside the repo: 36 tests
  (search params, money/date formatting, strip selectors, SSE reducer, inbox selectors, mock-API invariants and demo
  steps 3/3b).
- Not verified: anything importing React/TanStack/MSW types (components, hooks, routes, the two component tests, the
  Playwright spec). Those were written against the documented v5/v1 APIs and reviewed by hand.

First thing on a machine with the registry: `cd apps/web && pnpm install` (commits `pnpm-lock.yaml`; MSW copies
`public/mockServiceWorker.js` via `msw.workerDirectory`), then `pnpm lint && pnpm typecheck && pnpm test -- --run && pnpm build`.

## 1. Decisions (options → pick)

| # | Question | Options | Pick | Why |
|---|---|---|---|---|
| W1 | URL format for array/boolean search params | TanStack default (JSON in the query) · custom serialiser | **custom** (`lib/searchSerde.ts`): repeated keys → arrays, everything else strings; Zod `validateSearch` types it | Demo step 5 reads "`/claims?status=denied` — URL shows it". JSON-in-URL renders `status=%5B%22denied%22%5D`. |
| W2 | Where the open ProgressPanel lives | URL `?run=` only · client store only · both | **both**: `?launch=<id>` selects the panel; a sessionStorage "launches" list remembers which runs this tab started | Demo step 4 returns to the Inbox *via the nav* and opens the completed Owens run — a URL param alone is lost on that navigation. Run *state* stays server data in `['run', id]`; the store only holds ids + labels. Reload mid-run → URL + store → refetch snapshot → resubscribe with `Last-Event-ID`. |
| W3 | SSE transport | `EventSource` · fetch + stream parser | **fetch** (`lib/sse.ts`) | Needs the `X-Torch-User` header and an explicit `Last-Event-ID` after reload; `EventSource` can do neither. Polling fallback (`GET /runs/{id}` every 2 s) after 3 failed connects. |
| W4 | Out-of-order / duplicate SSE events | trust order · dedupe by id · monotonic merge | **monotonic merge** (`lib/runEvents.ts`): step status only moves forward, run status never leaves terminal, progress lines/evidence de-duplicated, `last_event_id` = max | Replays and late `started` events become no-ops; the same reducer is used as the query's `structuralSharing`, so a stale refetched snapshot cannot move the view backwards either. |
| W5 | Inbox optimistic approve and group counts | keep server group counts stale until refetch · project | **project** (`withoutItems`): drop the item, subtract its server `cents` from its group, drop groups below 2 | The projection only removes server numbers, never invents one; `onSettled` refetches. Badges never move optimistically — they move from `meta.counts`. |
| W6 | Inbox group selection | group as its own selection · first member | Clicking a group selects its **first member** (`?group=&item=`); a collapsed group is one j/k stop | Demo step 2: "Open the Delta group … Selected item #4821". |
| W7 | `enter` vs `g c` in the Inbox | — | both open the claim (`enter` is the list-wide "open" of `useListKeys`; `g c` is the explicit chord) | 05-frontend lists both; one module, no special case. |
| W8 | Nav / guards | separate | **one table** (`features/shell/nav.ts`): the sidebar is built from it and `beforeLoad` reads it | No link that would redirect. Front desk loses Denials/Payments/Cash/Settings (final-rev). |
| W9 | User switch | invalidate · reset | `queryClient.resetQueries()` + `router.invalidate()` | Every cached read is another user's view; guards must re-run (an open `/cash` redirects for Dana). |
| W10 | Lint preset | `strictTypeChecked` · `recommendedTypeChecked` | **recommendedTypeChecked** + `no-explicit-any: error` + a rule banning `Date.now()` / `new Date()` outside the mock and SSE plumbing | Code could not be linted in this session; the stricter preset would very likely fail on first run on stylistic rules. Tighten later. |
| W11 | #4821 tooth | spec #30 · mocks #19 | **#19**, matching api-core D11 | Keeps the mock layer and the real seed identical. |
| W12 | Mock persistence | memory · sessionStorage | **sessionStorage** snapshot of the mock DB | Step 5 refreshes the page; without persistence mock mode would forget the approvals. Unfinished runs resume from the last ok step, like the real worker. |
| W13 | Mock-only design embeds | screenshots · iframe of `public/design/mocks.html#anchor` | **iframe** + banner | The anchors exist (`r3-pay`, `r7-s2`, `r6-s2`); no image pipeline needed. Tailwind scans `src/` only so the 450 KB page doesn't bloat the CSS. |

## 2. Contract assumptions the API must meet (or the coordinator renames)

Shapes 02-api leaves open. Entity fields follow `apps/api/torch/domain/entities.py` as of this session; fields marked
*optional* degrade gracefully when absent.

1. **`GET /summary/strip`** → `{tiles: [{status, count, cents, flagged, cents_basis?}], inbox_open, paid_month_cents, paid_month_count, paid_month_label?, nav_badges?: {payments, eligibility, activity}}`. Every mutation response carries the same object at `meta.counts`, scoped to the request's `location_id`.
2. **`GET /inbox?group=true`** → `{items, total, next_cursor?, groups: [{group_key, title, count, cents, item_ids, summary?}], facets?: {kind: {<kind>: n}}}`. `items` holds **every** matching item (grouped ones too); `groups` reference them by id.
3. **InboxItem** list rows: entity fields plus *optional* `subject {claim_number, patient_name, payer_key, label}`, `root_cause`, `reversibility {editable_until, then}`. Without `subject` the header uses `title`; without `root_cause` the detail uses `claim.denial.root_cause`.
4. **`GET /inbox/{id}`** → the item with `evidence: Evidence[]` (hydrated) and `claim: ClaimRow | null`.
5. **`GET /claims`** rows (`ClaimRow`): Claim core + `patient_name`, *optional* `provider_name`, `procedures_label`, `age_days` (days since sent), `agent_chip {agent, label}`, `last_activity {at, label}`. Query params: repeated `status=` (not `status[]=`), `needs_action=true`, `payer`, `provider`, `age_bucket ∈ 0_30|31_60|61_90|90_plus`, `q`, `sort ∈ [-](number|patient|payer|dos|billed|status|age|last_activity)`, `cursor`, `limit=200`.
6. **`GET /claims/{id}`** → Claim + `patient {id, name, dob?}`, *optional* `provider_name`, `plan_label`, `age_days`, plus `lines`, `attachments`, `acks`, `timeline`, `open_inbox_items`. `TimelineEntry = {id, at, lane: agent|payer|human|system, title, detail?, agent?, actor?, run_id?, tier?, root_cause?, evidence: Evidence[]}`.
7. **Runs**: `GET /runs/{id}` includes `evidence: Evidence[]` (hydrated) and `last_event_id` (the snapshot's SSE cursor). SSE `step` events may carry `policy_verdict`; `status` events may carry `model_situation_label`/`planner`; `done` carries `{status, audit_line, result_summary}`. The client refetches the run once when a step with a verdict completes, to pick up `plan.rationale`.
8. **Firehose** `GET /runs/stream`: `event: run {run_id, agent, status, claim_id?}`, `event: agents {paused, by, at}`, `event: advance {advance_id, now, events_fired, runs_started, live_runs, done}` (02-api). "N running" comes from `GET /agents/status`, refetched on each `run` event.
9. **Errors**: `{error: {code, message, details?}, alternatives?}` — for `409 file_departed` the client also reads `details.alternatives`.
10. **`POST /views`** → the saved view; `GET /views` → `{items, total}`.
11. **`GET /_world/status`** → `{outages: [{system, since, message}]}` for `OutageBanner` (404 = no banner).
12. Demo users are the four seeded ids; the client hard-codes them for the switcher (no `/me` endpoint in 02-api).

## 3. Open / for the coordinator

- 04-seed puts #4821 on #30; api-core (D11) and this worker use #19. Fix the spec.
- CI runs `pnpm install --frozen-lockfile`; there is no `pnpm-lock.yaml` until someone installs with registry access.
- Settings › Agents is a read-only shell here (tabs, rules, proposals, changes, kill switch); the interactive table,
  preview and PATCH flow belong to the S2 settings worker.
- Clock advance in mock mode only moves the clock and emits progress; the overnight scenario (step 8) needs the real API.
