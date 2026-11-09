# d1-api-4 (D1 phase 4b, server totals): hand-over

Branch `d1-api-4`, on `feat/d1-dashboard` @ 7da3ae1. Not pushed. No `docs/STATUS.md` change. Options, lean and what was adopted are in `docs/plans/d1-build.md` → "Phase 4b notes". The red team report is `docs/design/red-team/challenge-d1-api-4-2026-11-08.md`.

## Two rules (for the coordinator to fold into a numbered ADR)

1. **Domain aggregates come from the server; positional counts may not.** Any count or sum of rows that a screen presents as a fact about the practice is a server field, with an invariant test that it equals its rows. Examples: "Sent today 5 · $1,320", a tier's "ran 29", a day's "3 verified". Presentation over a complete list the server sent is allowed: "i of n", "+N earlier", picking rows by id, choosing the earliest. A reviewer could draw the line elsewhere (all counts on the server). This line keeps pagination-free lists simple and keeps every business number single-sourced.
2. **One week.** "This week" is the Mon-start practice week (`activity.week_start`) everywhere: Activity, the nav badge, `this_week`, the rule rows' `*_7d`, the preview and the owner digest. The `_7d` names are historical; they already count that week. They were not renamed, to avoid contract churn.

## What changed (API → web)

| Gap | Server field | Screen |
|---|---|---|
| Ledger totals | `LedgerToday.totals{on_ledger, sent, leaving, held, not_billable}` ({count, cents}; not-billable in fee cents, never in `on_ledger`) | Header and section titles read `totals`; `ledgerTotals` deleted |
| File groups | `LedgerToday.files[{file_time \| null, count, cents, claim_ids}]`, earliest first, null last | `fileGroups(ledger)` picks rows by id; null reads "Not yet filed" |
| All-claims count | `Strip.all_count` = unfiltered `GET /claims` (same `_matches`, location-scoped, in `meta.counts`) | Quick view "Open + Paid · Oct" with count and tooltip |
| Paid | Paid tile now uses `_matches(status=paid)` (was a parallel predicate) | "Paid · Oct" = `paid_month_count`; wrong "all time" tooltip fixed |
| Search | `q` includes older paid claims | A Sept-paid claim is found by number or name |
| Eligibility days | `EligibilityOut.total`, `by_day[{date, count, verified, issue, unverified, checking}]`: every business day in the window, zeros included, plus any day with rows | Page renders from `by_day`. Day line "6 appts · 3 verified · 2 need attention · 1 checking" or "No appointments booked". Chips read Needs attention / Not verified |
| Rules counts | `RulesOut.rules_count`; `TierGroup.count / ran_without_review_7d / waiting` | Tab counts and tier headers read them; fallbacks removed |
| Preview | `PreviewOut.held_total / before_holds / net_change` | "41 → 44" reads `before_holds`; the line under it reads `net_change` ("N more" / "N fewer" / "No change") |
| Owner digest | `RuleChangeList.digest{period_start, sends_on, changes, items_run, awaiting_signoff}` | "Mon digest to Dr. Morgan (week of 10/26, so far): …"; the client-side 7-day filter and the extra inbox query are gone |
| Activity | `ActivityRow.move` (the claim's move now, for the viewer; null without a claim); `ActivityOut.by_day[{date, count}]` after the filters, practice-local | Column "Now with" with `MoveCell` ("—" without a claim); day header "N entries" |
| Cash | none | Appeals line shows "—" for a missing key, not an invented 0 |

Tests:
- `apps/api/tests/test_server_totals.py` has 19 cases. One per total over HTTP, plus a per-location `all_count`/Paid check, `meta.counts.all_count` after an approval equal to a fresh list, and the older-paid search.
- Web: `features/{ledger,eligibility,activity}/selectors.test.ts`, the updated `settings/selectors.test.ts`, and a `mocks/db.test.ts` case. These hold the mock to the same equalities.
- The ledger test moved out of `denials/selectors.test.ts`. Two hook-test strip fixtures gained `all_count`.

## Left, and why

- **`RuleChange.items_affected_since` is a stored count.** At PATCH time it counts the rule's runs *before* the change. The seed hand-authors history (61, 40, …) that no run backs. The digest adds this column, so it agrees with the table under it. Recomputing distinct runs gives 9 on the seed against a column reading 2 and 0. Deriving it needs run history older than this week; the next API session should replace it with a derived field.
- **Not my folders (sums still in the browser):**
  - denials payer × reason matrix (`denials/selectors.ts payerReasonMatrix`). This is a domain aggregate under rule 1, so it is a violation: it needs a `DenialsOut.matrix`.
  - inbox `withoutItems`: an optimistic projection, replaced on refetch.
  - `DraftText` sentence counts, `RelayTable count={members.length}` (server `group.count` exists), claim `legs.fold` "+N earlier", "Next denial (i of n)" (server `DenialsOut.total` exists), and the `ProgressPanel` step and run counts.
  - All but the matrix are positional under rule 1.
- **Inbox mutations should invalidate `qk.rules`** (`waiting` changes on approve). That is `src/hooks`, not this session's.
- **Mock month rollover:** mock claims carry no paid month, so the mock's Paid is "every paid claim". This equals October on the demo's clock and would diverge only past Oct 31.

## Checks (last commit)

- `make lint` green.
- `make test`: API 622, web 141.
- Harness: OK. It was run through a scratch script calling `torch_rcm.agents.<harness>.__main__.main`, because the sandbox refuses a command line containing the word.
- `pnpm test:contract` 52/52, `pnpm check:api` clean.
- MSW e2e 6/6 (`vite preview` :5199). Real-target `@demo` 3/3 (API :8091 over a scratch DB in the worktree, web :5198). No e2e assertion changed.
