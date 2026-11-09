# d1-shell (D1 phase 1): hand-over

Branch `claude/elegant-cray-4f7042`, on `feat/d1-dashboard` @ 89402c9. Not pushed. Decisions and the red team are in `docs/plans/d1-build.md` under "Phase 1 (shell) notes" and `docs/design/red-team/challenge-d1-shell-2026-11-08.md`.

## Tokens (`apps/web/src/styles.css`)

Old names keep their roles with D1 values, so unchanged features restyle on their own. Text pairs are AA on white and on the canvas. The amber rod has an ink ring for 3:1 non-text contrast.

| Token | Value | Use |
|---|---|---|
| `ink` / `mid` / `soft` | #161A22 / #4B5364 / #5C6577 | text, strongest to quietest |
| `line` / `line-strong` | #E7E9EE / #D8DCE3 | panel borders / control borders |
| `light` / `fill` / `hover` / `track` | #EEF0F4 / #F8F9FB / #F2F4F7 / #E6E9EF | neutral chip / sunk well / row hover / baton track |
| `paper` / `canvas` | #FFF / #F6F7F9 | panel / page behind panels |
| `practice` (`-ink`, `-num`, `-bg`, `-line`) | #F2B01E (#8A5B00, #9C6600, #FEF5DF, #F7E2AE) | the practice's move, "yours" |
| `agents` (`-ink`, `-bg`, `-line`) | #0E929B (#0B7480, #E4F4F5, #C6E6E8) | the agents hold it |
| `payer` (`-ink`, `-bg`, `-line`) | #8A3FBC (#7A32A8, #F5EDFA, #E4D0F1) | a payer holds it |
| `nobody` | #8A93A3 | system, nobody's move |
| `act` (`-hover`, `-bg`, `-line`) | #2A55D6 (#2348BC, #EFF3FE, #CBD8F9) | the only action colour: primary buttons, focus, selected row |
| `risk` (`-ink`, `-bg`, `-line`) | #BC2A22 (#A8231C, #FDECEA, #F6CFCB) | money at risk, root cause "ours", errors |
| `ok` (`-bg`, `-line`) | #18703E (#E6F4EC, #B9E0C8) | paid, done |
| `acc*` | = `act*` | **deprecated alias**: new code uses `act` |
| `bad*` | = `risk*` | alias |
| `warn*` | ink on `hover` / `line-strong` | neutral on purpose: amber only means "yours" |

Type: `text-2xs`/`text-xs` 12, `text-sm` 13, `text-base` 14 (body), `text-md` 16, `text-title` 22, `text-kpi` 34, each with its line-height. Nothing under 12. `b`/`strong` render 600. Utilities: `panel` (white card: border, radius 10, faint shadow) and `nums-proportional` (big numbers). Font: `@fontsource-variable/geist`, imported in `styles.css`; no Google Fonts.

## Components to use in phase 2

- **`components/Baton.tsx`**
  - `<Baton who size? held? next? count? label? decorative? />` is the three-stop track. Give it `{...batonProps(claim.move)}`, which sets `who`, hatches the rod when `!mine`, and uses `move.label` as the name. For a row with you, set `next={item.lands}` for the ghost and `count` on a group row.
  - A change of `who` on the same element glides the rod, so keep the element keyed by claim, not by holder.
  - Also exports `PartyMark` (mini rod), `BatonLegend`, `partyWord`, `PARTIES`, `PARTY_TEXT`, `PARTY_PANEL` (hue classes; never spell party colours by hand).
- **`components/HolderTally.tsx`**: `<HolderTally rows={tile.by_holder} fill? />` draws one tick per claim, plus `holderSentence()`. Use it for the Denials summary (D1 `.tally.big`: pass a `className` for size).
- **`components/PipelineStrip.tsx`**: `variant="card" | "line"`. The shell renders it; features should not.
- **`features/shell/chrome.ts`**
  - Set `staticData: { chrome: { header, panel } }` on a route. The default is `{ header: 'slim', panel: true }`, and `/inbox` already sets `header: 'full'`.
  - **Inbox, Claim and Denials owners: set `panel: false`** and draw D1's own panels with the `panel` utility, `gap-3` and `px-4 pb-4`.
- Restyled in place: `Chip`/`StatusChip`, `TierBadge`, `AgentChip`, `FlagPill`, `DataTable`, `SimpleTable`, `EmptyState`, `QueryError`, `EvidenceCard`, `MoneyMath`, `Timeline`, `ReadinessChecklist`, `ConfidenceMeter`, `KeyboardHints`, `MockOnlyBanner`, `ui/Button` (sizes sm 28 / md 32 / lg 40; `primary` is cobalt), `ui/Kbd`, `PageHeader` (22px title; search and location; the clock moved to the sidebar).
  - Status pills are grey, except denied/rejected (red) and paid (green).
  - Tier badges show weight, not hue.
  - The ⚑ flag is practice amber.
  - Timeline entries carry `PartyMark` from `entry.who ?? lane`.
- Not touched (owner: d1-inbox): `ProgressPanel` picks up the new tokens only.

## What moved out of `InboxPage.tsx`

I removed the `<PipelineStrip />` and the "This week agents ran … · See what they did" band (12 lines and one import). Both now live in the shell: the pipeline in `ShellHeader`, and the week line in the sidebar's `AgentsIndicator`. I added one line to `routes/inbox.tsx`: `staticData: { chrome: { header: 'full' } }`. Nothing else in `features/inbox` changed.

## Left for phase owners

- **Hues to check:** `text-bad`/`bg-bad` uses outside components (red now means money at risk or "ours"): settings/ProposalsTab 4, CapEditors 2, PreviewPanel 1, ledger 2, inbox/InboxDetail 4, ItemForms 4, InboxList 3, eligibility 1, denials 1, claim/ClaimDetailPage 3, ClaimSections 1. `acc` uses: 19 feature files (d1-rest: rename to `act`, or the party hue where it meant "agent").
- **Sizes:** `text-[10px]` ×2 in `inbox/InboxList.tsx` (under 12px). Arbitrary 17–24px sizes in activity, cash, claim, eligibility and inbox detail should map to `text-md`/`text-title`/`text-kpi`. `font-bold`/`font-extrabold` classes still render 700/800, mostly in InboxList, EligibilityPage and DenialsPage.
- **Outage note per item:** the sidebar line is global. The note on the item or claim saying "this came back because the Cigna portal is down" belongs to d1-inbox / d1-claim-denials.
- **lib/strip.ts:** `openTotals`/`arTotals`/`flaggedTotal` add up tiles on the client, and `tileFor` invents a 0 tile. Claims and SavedViews still use them. The server sends `open_count`, `ar_cents` and `flagged_count`; switch to those (d1-rest).
- **Claims at 1280:** the DataTable grid is wider than the panel, so the table scrolls inside its own container ("Last activity" is clipped). The page itself does not overflow.
- **Location** stays in localStorage. It is tenant scope, so it is not URL state. That is stated in `TopBarControls`.
- **Flaky test:** `InboxPage.test.tsx` "removes the item optimistically…" failed once while `make test` ran in parallel with Playwright. It passed 3 of 3 runs on its own and in the full suite. It is not a shell change; d1-inbox may want a longer `findBy` timeout.

## Tests

- `components/Baton.test.tsx` covers rod stop and shape, nobody, labels, hatch, decorative, tick count and order, and the holder sentence.
- `e2e/shell.spec.ts` (standalone, MSW only) checks that each of the nine nav routes has no horizontal scroll at 1280×800. It also checks the full header on the Inbox and the one-line pipeline elsewhere, `aria-current` on the filtered stage, and the skip link.
- The demo steps' strip and badge assertions are unchanged. Link names are still "Denied 5" and "Paid · Oct 118" (the money shows but is not part of the name).
