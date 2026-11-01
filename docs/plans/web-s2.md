# Plan — web-s2 (S2 worker, `apps/web/`)

Owner: `apps/web/`. Builds on `docs/plans/web-shell.md` (read its §0 first: the npm registry is still refused here).
Status in `docs/STATUS.md` → "web-s2".

## 0. What could be verified offline

`pnpm install / lint / typecheck / test / build / e2e` have **not** run (registry refused, same as S1). Verified:

- **Parse:** every `.ts/.tsx` in `src/` and `e2e/` (140 files) through esbuild.
- **Strict typecheck, real libs:** every React-free module (`api/*`, `mocks/db.ts` + all fixtures, every `selectors.ts`
  and `search.ts`, nav/guards) and the pure test files, with `tsc` (TS 6, `strict` + `noUncheckedIndexedAccess`).
- **Strict typecheck, stubbed libs:** all of `src/` against hand-written typed stubs for React / TanStack Query
  (discriminated `useQuery` result) / Router / react-hook-form (kept in `/tmp/tc2`, outside the repo). The S2 files
  come out clean except implicit-`any` event/search callback parameters, which the real library types supply.
  This does **not** prove the real TanStack/RHF generics accept the code; the first `pnpm typecheck` does.
- **Tests:** 69 pure Vitest tests (S1's 36 + 33 new) pass through the `describe/it/expect` shim, in `TZ=UTC` and
  `TZ=Asia/Tokyo`. Not run: the component tests (`*.test.tsx`, incl. the new `SettingsAgentsPage.test.tsx`) and
  Playwright.
- **API parity:** the mock fixtures were built from a dump of the API's own read models (`ledger_today`, `activity`,
  `eligibility` + `benefits`, `cash`, `denials`, `list_rules`, `preview`) run on the canonical seed, Wed 10:40 and after
  `run_due(Thu 07:10)`.

## 1. Decisions (options → pick)

| # | Question | Options | Pick | Why |
|---|---|---|---|---|
| S1 | Who may open Settings › Agents | owner only (05-frontend `beforeLoad`) · owner + billing (mocks, Engineering notes §8 "Billing: Settings is read + propose") | **owner + billing** (nav table + guard) | Demo step 7 has Dana try a tier-2 flip and get 409; the API lets billing PATCH tier 1, accept proposals, and turns her tier-2 PATCH into Dr. Morgan's sign-off item. Front desk and dentists still redirect. **05-frontend to be edited.** |
| S2 | Demo step 6 "flip Status check → 41 → 44 of 54" | script as written · the API's computed preview | **computed**; the e2e hovers *Missing PA x-ray → Runs without review* | Status checks are routine runs, not decisions (API `is_decision`), so flipping them previews 41 → 41. The Delta rule previews exactly the mocks' line: **41 → 44 of this week's 54, but 3 of the 44 are root cause: ours → held for Dana · net 41** (`would_run` 41 + `held_by_root_cause.ours` 3, total 53 + the 3b triage). **06-demo-script step 6 to be edited** (api-core §3 raised the same). |
| S3 | Preview state | URL · component state | hovered/cap-trial target = **component state**; selected rule = **`?rule=`** | Hover is ephemeral; selection is shareable. With nothing hovered the panel previews the selected rule (default the Delta rule) at "Runs without review". |
| S4 | PATCH optimism | whole row · mode only | **mode only**; rollback on any error; `409 owner_signoff_required` → revert + toast "Sent to Dr. Morgan for sign-off" + refetch strip/inbox | Only the mode is known before the server answers. The error envelope carries no `meta.counts`, so the badge moves from a refetch of server counts — and it moves for Dr. Morgan (item assigned to her; API `visible_inbox`), not for Dana. |
| S5 | Practice-wide cap editor | none (no endpoint) · edit every tier-2 rule's `max_cents` · new endpoint | **assumed `PATCH /settings/practice`** (owner) + a per-rule "Cap per item" editor on the existing `PATCH /rules/{id} {max_cents}` with `GET /settings/preview?max_cents` | The cap is a practice field (`Practice.practice_cap_cents`) the API reads but cannot write. Against today's API the practice editor shows the 404 inline; the per-rule editor works. |
| S6 | Proposal "Edit" | edit the draft then accept · open the base rule | **open the base rule** in the Rules tab (`?tab=rules&rule=`) with its live preview | `POST /proposals/{id}:accept` takes no body; an "Edit" that silently dropped edits would be a dead button. |
| S7 | Clock-advance completion | firehose handler · poller · both | **one hook** (`useAdvanceCompletion`) watches `['advance', id]` and runs `queryClient.invalidateQueries()` once per advance id, whichever channel wrote `done` | S1 only invalidated on the firehose path; when polling, nothing refreshed. The firehose also patches `['clock'].advancing` so an advance started elsewhere disables the control. |
| S8 | Mock overnight (step 8) | move the clock only · scripted phases | **scripted, derived phases** on the first crossing of Thu 07:10: files leave (10:45, the 11:15 resubmits), Vyne A1s, payer 277CAs, four 835 denials, six paid, posting runs, morning status checks | The brief said "Owens group → sent", but the API keeps them **denied, in flight** (its step-8 test asserts it) and Denied → 9 requires that. Six new items reach Inbox 16: Ito, Castillo, Moreno, Morris, Lindgren (built 10:51, held), one held ERA line. |
| S9 | Castillo CO-16·M127 root cause | API seed `payer` · mocks `ours` ("wrong chart sent") | **ours** in mock mode | The records rule is Auto; only an `ours` root cause sends it to Dana as the mocks show. The API's agents must decide the same, or the screens differ by mode. |
| S10 | Mock Cash A/R | copy 04-seed buckets · compute from mock claims | **compute** (aging, by payer, insurance A/R, days in A/R) | Cash then always equals the strip, before and after step 8. The mock's generated claim ages do not reproduce 04-seed's bucket split (the totals do); the real API does. |
| S11 | Activity "Observe mode preview" | filter `outcome=would_have_run` · presentation toggle | **both**: the outcome filter is the API's; `?observe=true` restyles what ran without review as "would have run · Observe", labelled a preview | The canonical seed has no `would_have_run` rows (every rule is past its 14-day Observe), so the filter alone shows nothing in step 9. |
| S12 | How far to reconcile `schema.ts` | everything · what S2 reads/writes + shared | **S2 + shared** (Strip, AgentsStatus, advance, `ApproveResponse.run` nullable) | The S1 shapes (Inbox, ClaimRow, ClaimDetail, Run) differ structurally from the API (nested refs, `RunDetail` wrapper, `itm_` ids); migrating them blind would break the S1 screens without a way to check. Listed in §3. |
| S13 | Mock fixture drift vs the API seed | keep · align | **align** where screens cross: today's 11 claims and their amounts, Morris #3561, Moreno → Aetna, #4611 tier 3 (write-off), #4772 tier 2 (post ERA), the 3 eligibility items' facts, 19 rule ids/labels/modes, 5 changes, 3 proposals | Mock and real must tell the same story; the e2e selects by rule ids and claim numbers the two share. Totals (strip, 107 open, 41/12) unchanged. Mock DB storage key → `torch.mockdb.v2`. |
| S14 | Frequency "last done" on the benefits card | API (null in the seed) · mocks' dates | **mocks' dates** for J. Chen / S. Kim in mock mode | The card is the point of the screen; the seed gap is listed for api-core. |

## 2. Contract assumptions the API must meet (or the coordinator renames)

1. **New:** `PATCH /settings/practice {practice_cap_cents}` → `{practice_cap_cents, meta}`; owner only (`403 owner_only`), `422 invalid_cap`. Not in `openapi.snapshot.json`.
2. `PATCH /rules/{id}` errors exactly as `services/rules.py`: `409 owner_signoff_required {details: {inbox_item_id, rule_id}}`, `403 human_only`, `403 forbidden`, `422 empty_patch`; success `RulePatchOut {rule, change, meta}`.
3. `ApproveOut.run` is `null` for `owner_signoff` (and eligibility flags); the client now accepts that and shows "Signed".
4. `GET /settings/preview` → `PreviewOut`; the UI shows `baseline_would_run → would_run + Σheld_by_root_cause` and the held line; reason keys rendered: `ours`, `over_cap`.
5. Firehose `event: advance` = `runner._progress` payload (`events_fired` a count while running, the list when done); `GET /clock/advance/{id}` = `AdvanceOut` with `meta.counts` once finished (the client's `pushCounts` writes the strip from it).
6. `GET /activity` routine runs (status checks, rep calls) carry `evidence_kinds`; outcome filter values `ran | awaiting | would_have_run`. The client sends no `location_id` to `/activity`, `/ledger/today`, `/eligibility` (the API takes none).
7. `GET /cash` KPI keys the tiles read: `days_in_ar, insurance_ar, patient_ar, collections_month, net_collection_rate, non_contractual_month, contractual_month`; `appeals_12mo` keys `won, total, reconsideration_won, reconsideration_total, formal_won, formal_total`.
8. `GET /denials`: overnight denials need **typed deadlines** (appeal = 180 d from the EOB with its source, timely = from DOS); the world-only advance leaves `{kind: none}` today.
9. `GET /eligibility/{id}`: `frequencies[].last_done` / `ok_from` populated from PMS history (null in the seed today).
10. Strip has no `nav_badges` / `paid_month_label`: without them the Payments/Eligibility/Activity badges are hidden and Paid reads "Paid · month". Add them to `Strip`, or the client derives them (eligibility from `facets`, activity from `/activity` summary).
11. Ids the e2e shares with the seed: `rule_t1_delta_pa`, `rule_t2_post_era`, `rule_t3_formal_appeal`, `prop_delta_pa`, `prop_delta_pa_ours`, learned rule id prefix `rule_t1_delta_pa_learned`, `clm_4796`.
12. Step 8's Inbox 16 needs torch.agents' handlers to turn the four denials (+ Lindgren, + a held ERA line) into items; the world-only `run_due` leaves 12.

## 3. Open / for the coordinator

- **S1 schema migration** (not done, see S12): `InboxItemOut` (nested `claim: ClaimSummary`, `patient`, `evidence_ids`, `priority`, no `subject`/`reversibility`), `ClaimRow` (`patient`/`payer` refs, `procedures`, `last_activity_at`), `ClaimDetail` (`{claim, coverage, money, holds, file_entries, …}`), `GET /runs/{id}` → `RunDetail {run, evidence, last_event_id}`, item ids `itm_*` (the S1 e2e reload test uses `inb_4705`). Do it with `pnpm gen:api` on a machine with the registry.
- Spec edits: 06 step 6 (rule and wording, S2) and "Owens group `sent`" in step 8 (S8); 05-frontend Settings guard (S1); 02-api `PATCH /settings/practice` (S5).
- Castillo's root cause (S9) and the overnight items (§2.12) are for the agents worker.
