# Red team: onboarding tours implementation, D13–D19 (2026-11-09)

Given: CLAUDE.md, `docs/design/onboarding/DECISIONS.md` (D1–D12, settled), `apps/web/src/features/tour/*`, `shell/RootLayout.tsx`, and the supporting files I followed from them (`ModeControl.tsx`, `UserSwitcher.tsx`, `state/session.ts`, `shell/nav.ts`, `readmodels/claims.py`, the tour e2e/Vitest setup) in the `onboarding-tours` worktree, with `registry.tsx` uncommitted and being edited while I read it.
Not given: the author's reasoning for D13–D19 beyond the code comments and `docs/plans/onboarding-tours.md`. I did not see a running app. Nothing was executed except grep and read. ADR-0009 does not exist yet, though `e2e/tour.spec.ts:2` cites it.

Persona: a senior full-stack engineer on the hiring panel who will click through the app and read this code.

## Verdicts

### D13: "Try it" presses the real control. **Agree.**
This is the most defensible choice in the feature, and a reviewer can check it by grep: `anchors.ts:13-19` refuses a disabled button and surfaces its `title`, and the tour imports no mutation hook. If the tour called `useApproveGroup` itself, it would need its own copy of what the decision panel already wires up (Idempotency-Key, opening the run pane, toasts, selection, the `changes` read). The two copies would drift, and the line "the tour has no approve of its own" (`registry.tsx:287`) would be false. `button.click()` still dispatches while the shell is `inert`. Inert blocks user-initiated events, not synthetic ones, and the @demo e2e exercises this. Two things are weak:

- **The synthetic hover is never un-hovered.** `hover()` (`anchors.ts:25-27`) sends only a `mouseover`. The preview clears on `onMouseLeave` of the radiogroup (`ModeControl.tsx:30`). No `mouseout` is ever sent, and the shield takes the real pointer. After the Settings Try-it (`registry.tsx:796`), the preview panel keeps showing "Runs without review" with nothing hovered, even after the tour exits, until the user happens to mouse in and out of that row. **Fix:** on step unmount or exit, dispatch the matching `mouseout` (relatedTarget `document.body`). `focus()` can't replace it, because inert elements can't take focus.
- **A Try-it cannot be cancelled** (see the other findings). The trouble is not "press the real control". It is that the tour keeps pressing after the user has taken the app back.

Failure if this were reversed: a second approve path that skips the button's guards. A reviewer who diffs the two finds that the tour can do something the UI can't.

### D14: Tour memory is per browser, not per persona. **Agree.**
Seen tours and Hide code describe the person at the keyboard, and that person is the evaluator, not Dana. Keying by user id would flip the code pane mid-tour, because the main tour switches to Dr. Morgan and back (`registry.tsx:375-379`). It would also re-open every screen tour each time the evaluator switches persona to compare views, which is exactly when they least want a modal. The comment at `store.ts:4` gives the reason.

The real persona problem is elsewhere. **The main tour is Dana's story, but it neither checks nor sets the persona.** The persona persists (`torch.session`, `session.ts:37`), and the main tour auto-opens on every load whoever is signed in (`TourProvider.tsx:86-88`). As Dr. Lee, `visible_inbox` (`readmodels/claims.py:125-131`) shows dentists only the items assigned to them. Steps `how`, `policy` and `decide` then show their `missing` copy: "The Delta group is no longer open … (it was approved, or the clock moved on)". That is a confident and false diagnosis. Tasha gets the same. The overnight Try-it then ends with `switchUser('usr_dana')` whoever started the tour, so an evaluator who began as Dr. Morgan finishes as Dana. The finish modal (`TourLayer.tsx:275`) then hides the Cash tour from them. **Fix:** "Start the tour" switches to Dana with a visible line ("You're Dana, the billing coordinator") and records the original persona. Exit restores it, and the Try-it restores the persona it found, not a hard-coded Dana. Also pin or reset the location, because the inbox query is keyed by location.

### D15: Tour state lives in React state, not the URL. **Agree, with one change.**
The URL rule covers filters, sort, selection and tabs, the things a user would bookmark or share. A tour step is transient chrome, like an open menu. `?tour=main&step=3` would have to survive every `router.navigate` the steps and the app make (each one replaces `search`). A pasted link would also open a modal for the recipient. The main tour already reopens on load, so URL state would buy only "resume at step N", and that isn't worth it.

What is wrong is the history handling. `navigate` (`TourProvider.tsx:59-64`) **pushes** history entries, and the route effect (`:102-117`) depends on `[active, step]`, not on location. Press browser Back during "Dana decides" and the app returns to the pre-tour URL while the card stays on the step. You then get the false `missing` copy ("Reset demo to Wed 10:40"). Back and forward are not covered by `inert`. **Change:** navigate with `replace: true` for step routes, and either re-run the route effect when the location changes or exit the tour on `popstate`.

### D16: A localStorage flag turns auto-open off for tests. **Agree.**
It is set by the shared seams (`src/test/setup.ts:16-18`, `e2e/demo/shared.ts:26`), read fresh on every call (`store.ts:46`), and cleared by the tour's own tests. That is the right shape. The alternatives are worse here:

- **`navigator.webdriver`** would hide the tour from the tour's own Playwright spec. It would also hide it from an evaluator who drives the app through Playwright MCP or Claude in Chrome, and this audience does that.
- **A build-time env var** needs a second dev-server build, but `make e2e` reuses :5173.
- **A URL param** would have to be threaded through every `goto`, and in-app navigation drops it.

Nit: the prefix `torchrcm.tour.*` doesn't match the session's existing `torch.session` key. Pick one.

Failure if this were reversed: either the tour is untestable end to end, or it is invisible to automated evaluators.

### D17: The shell is `inert` and a shield blocks clicks on the spotlit element. **Change: keep the block, add feedback.**
Blocking is right. Otherwise someone clicks Approve on the "policy" step, and every later step is out of sync or shows `missing`. `TourLayer.tsx:316` also documents that a stray `a` keypress mustn't approve behind the card. But the first thing a hands-on evaluator does is click the outlined button. The shield (`TourLayer.tsx:137`) eats the click silently, and that reads as broken. **Change:** when a click on the shield lands inside the hole rect, pulse the Try-it button, or show "Use Try it, or Exit tour to use the app yourself". Wheel over the shield also scrolls nothing, so the user can't scroll a table to read context around the spotlight. If the shield is kept, at least forward wheel to the anchor's scroll container.

Failure as shipped: "the highlighted button doesn't work" ends up in someone's interview notes.

### D18: The menu and finish modal list only the role's screen tours, plus claim detail. **Agree.**
`toursFor` derives from `navFor` (`screens.ts:31-35`) and route guards read the same table, so the menu can never offer a tour of a route that redirects. A Cash tour for Dana would be a dead link, against a hard rule, and the registry test pins this (`registry.test.ts:23-29`). The defect is upstream, in D14's persona handling. Because the overnight Try-it forces Dana, the finish modal's list is always Dana's, whoever started the tour.

Failure if this were reversed: a menu item that navigates to a redirect, with the tour then pointing at nothing.

### D19: A screen tour auto-opens on the first navigation to its screen, not on load and not where the main tour was dismissed. **Agree.**
`TourProvider.tsx:91-97` does this cheaply. `lastPath` advances while the main tour is active, so its own navigation never queues a screen tour, and exiting doesn't count as arriving. That prevents the bad case of two tours back to back on one screen.

Edge to know about: a role switch whose route guard redirects counts as a navigation, so a screen tour can open right after a persona change. That is acceptable. The alternative, auto-opening on load, would collide with the settled every-load main tour.

Failure if this were reversed: two overlays in a row on the evaluator's first screen.

## What else I would ding in an interview

- **Try-its keep driving the app after Esc.** `runTry` (`TourLayer.tsx:109-126`) has no abort, and `exit` only clears state. Press Esc while the overnight Try-it is waiting, and it still signs in as Dr. Morgan, presses Skip and switches users after the user has "taken the app back". If the 90 s wait times out, `switchUser('usr_dana')` is never reached (`registry.tsx:375-379`, no `finally`), and the user is left as Dr. Morgan. **Fix:** pass an `AbortSignal` in `TryCtx`, have `until` honour it, and restore the persona in `finally`.
- **Likely race in the overnight wait.** `useSwitchUser` calls `qc.resetQueries()` (`UserSwitcher.tsx:19`), so the clock's data is briefly `undefined`. `ctx.clockNow() !== before` (`registry.tsx:378`) then counts `undefined` as "advanced", and the step can report "Next morning" before the advance lands. **Fix:** require a defined `now` that differs from `before`. Verify against the real API, where the refetch is slower than on MSW.
- **`missing` copy guesses causes it never checks** (`registry.tsx:196, 277`). With a different persona or after browser Back, it tells the evaluator the group "was approved" and to reset the demo. Say what is observably true ("#4821's item is not in this viewer's Inbox"), or check the reason.
- **The Welcome step shows "Deterministic (default)" while `mode` is still loading or the request has failed** (`registry.tsx:99`). That is a server fact rendered before the server answered, in a demo whose headline is "never render what the server didn't compute". Use `<Server>` or a placeholder.
- **Hygiene a reviewer will notice:**
  - `registry.tsx` is 836 lines mixing step copy, pane factories and Try-it scripts. Splitting it by tour would make diffs reviewable.
  - `e2e/tour.spec.ts:2` cites ADR-0009, which doesn't exist until the plan is folded in.
  - The code toggle changes its label and flips `aria-pressed` together (`TourLayer.tsx:168-172`), so screen readers hear the state twice. Keep one stable label.
