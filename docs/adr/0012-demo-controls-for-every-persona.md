# ADR-0012 — The demo clock is a demo control, for every persona

Status: accepted · 2026-11-09 · supersedes the "owner-only in the UI" line of spec 02 (Clock)

## Context

The frozen clock's "⏭ Skip to … 7:10 AM" and "Reset demo" were shown only to Dr. Morgan (owner); other personas saw "Clock control: Dr. Morgan". The spec called the control "owner-only in the UI" and "demo-only" in the same sentence. The owner pointed out the contradiction: moving time is not something any user of a real RCM product can do, so giving it to a role makes a fake control look like part of the permission model.

The gate protected nothing. The API never checked a role on `/clock/advance` or `/clock/reset`; the demo's "Signed in as" switcher reaches Dr. Morgan in one click; and the deployed demo is one shared world (ADR-0011). It did cost something: the tour had to sign in as Dr. Morgan and back for its overnight Try-it and for its reset, and that step's copy had to explain the switch.

## Decision

- The clock skip and the reset are shown to every persona, under a **Demo controls** heading in the sidebar footer, together with the "Signed in as" switcher. The heading's tooltip says these are the demo's controls, not the product's. `canSee.clock` is gone.
- The tour presses Skip and Reset as whoever is signed in; no Try-it switches persona any more. `TryCtx.switchUser` stays (and exit still restores the viewer if one ever does).
- Dr. Morgan is introduced through what is really his: the Cash screen and signing off tier-2 rule changes.

## Consequences

- Specs 02 and 05 and ADR-0009 now describe the control this way; e2e flows that switched to Dr. Morgan only to use the clock no longer do.
- Anyone can skip or reset the shared deployed world, as they already could through the switcher.

## Alternatives rejected

Keeping the gate and explaining it in the tour (the explanation was the confusing part); hiding the clock from the product UI entirely and driving it from the tour only (evaluators use it outside the tour).
