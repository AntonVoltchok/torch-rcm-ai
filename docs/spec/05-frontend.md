# Frontend spec (apps/web)

Vite + React 19 + TypeScript strict · **TanStack Router** (file-based, typed search params) · **TanStack Query** · **TanStack Table** + `@tanstack/react-virtual` · **Zod** schemas generated from OpenAPI (`pnpm gen:api`) · Tailwind v4 + shadcn/ui primitives · `react-hook-form` for edit forms · Vitest + Testing Library · Playwright e2e for the demo script.

Visual language: the mocks in `docs/design/mocks.html` (neutral grays, one accent, semantic green/amber/red for status/aging, Inter, dense B2B tables, 36px rows). Desktop only (min 1280). No dark mode in the demo.

## Routes (`src/routes/`)

```text
/                         → redirect to /inbox
/inbox                    search: { state?, kind?, agent?, item?, group? }   split pane; `item` = selected id (URL), survives refresh
/claims                   search: { status?[], flag?, payer?, provider?, age?, q?, sort?, view? }   table; opened pre-filtered from strip tiles
/claims/$claimId          detail + timeline; `?from=inbox:<itemId>` keeps the "‹ Inbox › #4821 · 1 of 3" breadcrumb
/ledger                   Today's claims (static)
/activity                 search: { day?, agent?, outcome? } (static)
/eligibility              search: { date?, appt? } (static)
/cash                     owner only (static)
/denials                  (static list) · /denials/$claimId → mock-only banner + design
/payments  /patients      mock-only routes (design + banner)
/settings/agents          tabs: rules | proposals | changes   (interactive)
```

`beforeLoad` on `/cash` and `/settings/*` checks role (owner) and redirects with a toast. Root layout: sidebar (nav with live badges from `summary/strip`, agents-active indicator from `/runs/stream`, user switcher + clock control in the footer), top bar (search, location switcher).

## State ownership (answer this in code, not in comments)

| State | Lives in | Why |
|---|---|---|
| Filters, sort, selected row/item, active tab | **URL search params** (Zod-validated via route `validateSearch`) | shareable, survives refresh, back button works |
| Server data (inbox, claims, rules, runs…) | **TanStack Query cache**, keyed by `['inbox', params]`, `['claim', id]`, `['strip']`, `['rules']`, `['preview', params]`, `['run', id]` | one source; derived numbers are selectors over it, never duplicated |
| Run progress | Query cache entries patched by the **SSE** hook (`useRunEvents(runId)`) | reconnect with `Last-Event-ID`; on reload refetch `['run', id]` then resubscribe |
| Saved views | server (`/views`) | shared across devices |
| Column widths/density, last used location | `localStorage` behind try/catch | convenience only |
| Edit-form drafts | component state (react-hook-form) | ephemeral |

Counts (sidebar badges, strip tiles, "12 items") are **never stored** — they come from `summary/strip` and from `meta.counts` returned by every mutation, which the mutation's `onSuccess` writes into `['strip']`.

## Mutations

- `approve(itemId)` / `approveGroup(groupKey)`: optimistic removal of the item(s) from `['inbox', …]` with rollback on error; on 202 the returned run id opens the ProgressPanel which subscribes to SSE; `onSettled` invalidates `['inbox']`, `['claim', claimId]`, `['activity']`, `['preview']`; `['strip']` is set from `meta.counts`.
- `409 file_departed` → toast + swap primary action to "Corrected claim (tier 2)" with the one-line explanation.
- `PATCH rule` → optimistic mode change; `409 owner_signoff_required` → revert + toast "Sent to Dr. Morgan for sign-off" + inbox badge bumps.
- The run itself is **not** optimistic — steps stream in.

## Components (`src/components/`)

`StatusChip`, `FlagPill`, `StageTile`, `TierBadge`, `EvidenceCard` (kind-specific renderers), `ProgressPanel` (steps with live status, audit line at the end, "runs in background — you can leave" copy), `Timeline` (agent/payer/human lanes), `MoneyMath` (billed/allowed/paid/write-off/patient), `ReadinessChecklist`, `RuleRow`, `HoldRow`, `KeyboardHints`, `DataTable` (TanStack Table + virtual rows, sticky header, server sort), `EmptyState`, `OutageBanner`, `MockOnlyBanner` (renders the matching mock screenshot + "designed, not built in this demo").

## Keyboard

Inbox: `j/k` move, `enter` open, `a` approve, `e` edit, `r` reject, `s` snooze, `shift+a` approve group, `g c` go to claim. Tables: `j/k/enter`. Implemented once in `useListKeys`.

## Loading / error / empty states (every interactive screen)

Skeleton rows (not spinners) for lists; inline error with retry per query; empty Inbox → "Nothing needs you — agents handled 41 items this week" with a link to Activity; outage → `OutageBanner` ("Vyne is unreachable since 10:52 — sends are queued") driven by `/_world` state; Observe mode → Activity rows styled as "would have run".

## Testing

- Unit: selectors (strip counts from claims), search-param schemas, money formatting.
- Component: Inbox item renders evidence kinds; ProgressPanel handles out-of-order SSE events.
- E2E (Playwright, against `make dev` with the canonical seed): the demo script in `06-demo-script.md` end to end, plus "refresh keeps filters" and "reload mid-run resubscribes".

## Performance

Claims table virtualized; server-side sort/filter; `dso_4000_claims` scenario must scroll at 60fps; no N+1 fetches (timeline comes with the claim).
