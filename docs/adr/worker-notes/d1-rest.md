# d1-rest (D1 phase 3, web screens): hand-over

Branch `claude/youthful-hertz-05f2b9`, on `feat/d1-dashboard` @ 761943f. Not pushed. No API, codegen or `src/mocks/**` change; no `docs/STATUS.md` change. Decisions, red team and server gaps: `docs/plans/d1-build.md`, "Phase 3 (rest) notes".

## Step 1 (combined e2e on the merged tree)

Green before any change: MSW 6/6, real-target `@demo` 3/3. No fix needed. Note: :5195 was held by a stale vite from the `nostalgic-kowalevski` worktree, and Playwright's `reuseExistingServer` silently ran the suite against that old code (2 false failures). Runs here used :5197 (MSW) and :5198 + API :8061 over a scratchpad DB.

## What shipped

| Screen | Changes |
|---|---|
| Claims | "Whose move" column (`components/MoveCell.tsx`: small `Baton` + server `move.label` in the holder's hue). Header reads `open_count`/`ar_cents`; quick views read `flagged_count` and tiles; tabs styled like the Inbox's; filters on `line-strong`/`act`. |
| `lib/strip.ts` | `openTotals`, `arTotals`, `flaggedTotal`, `AR_STATUSES` deleted. `tileFor` returns `undefined` instead of an invented 0 tile; `stripTiles` leaves a missing tile out. Tests updated. |
| Today's claims | `MoveCell` on leaving, sent and held rows; section heads `text-md`; risk red only for ≤ 30 d timely filing and rejects; agent-written text in agents teal; no-wrap short cells. |
| Cash | KPI numbers `text-kpi`; insurance A/R title from the `insurance_ar` KPI (was a sum of buckets); no invented zero KPI for contractual write-offs; bars grey, 90+ risk red; plural fixes. |
| Eligibility | Checking = agents teal, unverified = dashed, ⚑ via `FlagPill`, note under the status chip, sentence-case headers, selected row `act-bg`. |
| Activity | Agent names teal; "Awaiting you" chip and stat in practice amber; sentence-case headers. |
| Settings › Agents | Tabs like the Inbox's; Ask mode practice amber; preview panel neutral; proposals teal, root cause "ours" risk red; no caps eyebrows; wider Action column. |
| Payments, Patients | Unchanged `MockOnlyBanner` routes. |

Leftovers from `d1-shell.md` for these folders: no `text-bad`/`bad-*`, `acc`, `text-2xs` misuse, arbitrary px sizes, `font-bold`/`extrabold` or uppercase eyebrows remain (grep is clean).

## Checks (at the last commit)

- `make lint` green; `make test`: API 572, web 130.
- MSW e2e 6/6; real-target `@demo` 3/3.
- No e2e assertion changed.

## Gaps and follow-ups

- Server gaps: see the plan section (ledger totals, all-claims count, eligibility day tallies, rules count, activity move).
- `MockOnlyBanner` on Payments shows the mocks' Overview (anchor `r3-pay` doesn't land) and the old "Molar" name inside `docs/design/mocks.html`. Shell component / design doc, not changed here.
- Claims table still scrolls inside its panel at 1280 (it did before; the whose-move column adds 210px).
- Plan's phase-3 row also lists ADR-0008, the decisions-log row, `make eval` and STATUS; this session's brief excluded STATUS, so those are left for the coordinator.
- Screenshots: session scratchpad `shots/` (real API; Cash as Dr. Morgan).
