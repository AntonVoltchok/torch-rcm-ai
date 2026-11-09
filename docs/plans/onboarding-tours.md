# Plan: onboarding tours in the app

Design: `docs/design/onboarding/` (tour-src.html is the step copy; DECISIONS.md D1–D12 hold). This plan folds into ADR-0009 when merged.

- `apps/web/src/features/tour/`: registry (main + one per screen + claim detail), `TourProvider` in `RootLayout`, spotlight overlay, two-column card, welcome/finish modal, sidebar row + menu, `?` button in `PageHeader`.
- Anchors are `data-tour="…"` on the real elements. A step whose anchor is missing says so in the card instead of pointing at nothing.
- Numbers in step copy come from the app's own query hooks through `<Num>`; a test fails on any digit outside a `<Num>` that is not an allowlisted identifier (claim numbers, CARC/RARC codes).
- Code panes: live API panes read the same TanStack Query cache the screen rendered; model-facing panes are generated text files (`apps/api/scripts/tour_payloads.py`, drift-tested).
- "Try it" presses the real control (one code path, every guard applies); the tour imports no mutation hook.
- Auto-open: main tour on each load (dismissal is per load); a screen tour on the first navigation to that screen (localStorage). `torchrcm.tour.autoopen=false` turns both off for test suites.
- Tests: registry, anchors under MSW, code toggle persistence, the number rule; Playwright main tour on MSW and one @demo pass on the real API.
