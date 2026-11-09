# Red team: d1-api-4 server gaps (2026-11-08)

Subject: the six judgment calls in `docs/plans/d1-build.md` → "Phase 4b notes (`d1-api-4`)". One general-purpose subagent, two personas: **BL** = dental billing lead (15 yrs, multi-location), **DoE** = hiring Director of Engineering. Report as returned; "What was adopted" at the end is the session's.

## 1. Paid quick view and "All": agree with (a), with changes

- **BL**: "Open work plus this month's cash" is the right work list. Two problems:
  - Search: a patient calls about an August EOB, I type the name, and nothing comes back. `_matches` drops older paid claims even when `q` is set. A search box that can't find a paid claim gets laughed out of the room.
  - Label: "All" is the wrong word for that set. Use "Working" or "Open + Paid · Oct".
  - On the 1st (or after a clock advance) October's paid claims drop out. That's normal for a month-to-date tile, but say so in the tooltip.
- **DoE**: The Paid tile and `_matches` already disagree. The tile counts `paid_this_month` with no `closed_reason` filter; `_matches` rejects any `closed_reason`. "One predicate" has to mean the strip calls `_matches`, not a parallel test. The mock's paid claims are all October, so parity passes by luck. Add a month-rollover case.
- **Change**:
  - `Strip.all_count` = `_matches(ClaimQuery())`, location-scoped.
  - Label "Open + Paid · {paid_month_label}", title "Open claims plus claims paid in {Mon}. Search finds older paid claims."
  - `q` sets include-all-paid.
  - The Paid tile is rebuilt on the `status=paid` predicate.

## 2. Ledger file groups: agree with (a)

- **BL**: Rows that aren't in a file yet need their own group ("Not yet filed", last). Not-billable is a fee total, not billed: keep it separate, never summed into "on ledger".
- **DoE**:
  - `files[].file_time` is nullable.
  - Invariants: every `leaving_next_file` id is in exactly one group, and the cents of the groups equal `totals.leaving.cents`.
- **Change**: `files[{file_time|null, count, cents, claim_ids}]` and `totals{on_ledger, sent, leaving, held, not_billable}`, with `on_ledger` = sent + leaving + held. Delete `ledgerTotals` and the summing in `fileGroups`.

## 3. Settings sums: agree with server-side, but two definitions are wrong

- **BL, preview**: "41 → 44, 3 of the 44 held, net 41" is a change that gains nothing. A "3 more would have run" line built from in_scope − baseline would tell the owner it helps when it doesn't.
- **BL, digest**: it's the Monday digest, so it should be the Activity week (Mon-start, `week_start`), not a rolling 7 days.
- **DoE, digest count**: `items_run` = Σ `items_affected_since` counts a run twice when a rule changed twice, and counts runs from outside the window. Count distinct runs inside the window under rules changed inside it.
- **DoE, week definition**: there are two weeks now, `*_7d` and `this_week`. Pick one (Mon-start: the badge, Activity and the digest already use it) and record an ADR. Inbox approvals change `waiting`, so inbox mutations must invalidate `rules`.
- **Change**:
  - `PreviewOut`: `before_holds`, `held_total`, `would_run` (net) and `net_change` = would_run − baseline. The "N more" line reads only `net_change`.
  - `TierGroup`: `count`, `ran`, `waiting`, with the invariant tier 3 `ran == 0`.
  - `digest{period_start, sends_on, changes, items_run, awaiting_signoff}`.

## 4. Activity: agree, with tighter wording

- **BL**: "Whose move now" reads oddly on Dana's own audit row.
  - Head the column "Now with", with the tooltip "Who holds this claim today, not when this happened".
  - A row with no claim renders "—", never blank.
  - A closed claim reads "Done · paid".
- **DoE**:
  - `move.mine` depends on the viewer, so `ActivityOut` does too. Key it by user, or void it on user switch.
  - `by_day` comes after the outcome filter, on the practice-local date.
  - The header reads "12 entries", not "12 shown".

## 5. Eligibility: agree, but turn the loop around

- **BL**:
  - A day with no appointments must still show ("No appointments booked"). Dropping it looks like a broken sync.
  - Labels: Verified / Needs attention / Not verified / Checking. "issues" is jargon.
- **DoE**:
  - Render from `by_day`, with one entry per day in the window, zeros included. Rows are picked by `date`.
  - Invariants: verified + issue + unverified + checking = count; Σ count = `total`; every row's day is in `by_day`.

## 6. Out of reach: the list is fine, but draw a line

- **DoE**: Write an ADR. Domain aggregates come from the server. Positional counts over a complete list the server sent ("i of n", "+N earlier", a group's member count) are presentation.
  - On that line, `withoutItems`, `DraftText`, RelayTable, fold and "Next denial" are fine.
  - The denials payer × reason matrix is a domain aggregate. File it with its owner as a violation.

## Missed by the plan

- **Location scoping.** `all_count`, `files` and `by_day` must respect `location_id`. Mutation `meta.counts` has no location; test `all_count` there too.
- **meta.counts in sync.** After a mutation, `meta.counts.all_count` must equal a fresh `GET /claims` total. Add a contract test.
- **Paging.** Claims are listed 200 at a time against 225 rows. The footer must read `total`, never `rows.length`.
- **Snapshot consistency.** `by_day` and the rows come from one snapshot in one response.

## Adopt (red team's list)

1. `all_count` through `_matches`; the Paid tile on the same predicate. Labels "Open + Paid · {Mon}" and "Paid · {Mon}", with tooltips.
2. Search (`q`) includes older paid claims.
3. A month-rollover parity case in the mock.
4. `LedgerToday.files` with a nullable `file_time` ("Not yet filed"), plus `totals` and the partition invariants.
5. `PreviewOut.net_change` drives "N more"; drop `gained`.
6. The digest is the Mon-start week; `items_run` counts distinct runs; an ADR on one week definition.
7. `TierGroup.count/ran/waiting`; tier 3 `ran == 0`; inbox mutations invalidate `rules`.
8. Activity "Now with": "—" for no claim; key the query by user; `by_day` after filters, practice-local.
9. Eligibility `by_day` for every day, zeros included, rendered from `by_day`, with billing labels and sum invariants.
10. An ADR separating domain aggregates from positional counts; the denials matrix goes to its owner.
11. Contract tests: `meta.counts` matches a fresh GET; a footer test beyond one page.

## What was adopted (d1-api-4)

Recorded in `docs/plans/d1-build.md` → "Phase 4b notes" and `docs/adr/worker-notes/d1-api-4.md` (which holds the two rules the report asked an ADR for; the coordinator folds it into a numbered ADR at merge).

- 1, 2, 4, 5, 6, 7, 8, 9 and 10: adopted. Exceptions:
  - 6: the digest's `items_run` is the sum of this week's "Items run since" column, not distinct runs recomputed. Distinct runs (9 on the seed) would contradict the table under it (2 and 0). That column is a count stored on the change, which is a pre-existing gap, recorded.
  - The `_7d` field names are kept. They already count the Mon-start week (`this_week`), and the worker notes say so. Renaming is contract churn with no behaviour change.
  - Inbox-mutation invalidation of `rules` lives in `src/hooks` (not this session's folder); handed over.
  - Eligibility lists every business day in the window, plus any day that has rows. A weekend with nothing booked is left out.
- 3, not adopted: the mock's claims carry no paid month, and no demo clock advance crosses October. Recorded as a known limit.
- 11, partly adopted: an API test checks that `meta.counts.all_count` after a mutation equals a fresh unfiltered list total. The Claims footer already reads the server's `total`.
