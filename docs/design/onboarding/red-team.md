Given: CLAUDE.md, spec 06 (demo script), spec 07 §1–3, ADR-0008, the seven questions with the applicant's leans, and the captured payloads/screens in scratchpad/{payloads,cap/png}; I also read executor.py, the 4744 plan JSON and all canonical cassette headers.
Not given: the applicant's reasoning beyond the leans, the tour HTML itself, or any draft step copy. Persona: hiring Director of Engineering + staff engineer who has shipped Anthropic-API agents.

# Red team: onboarding-tour mock decisions

## Q1 Screen fidelity: B (DOM snapshot), with three conditions
**Reason:** it is the only option where "this is the real app" is literally true. A reviewer who opens devtools on the mock sees the same class names and DOM as the running app. A hand recreation (A) drifts within a week, and screenshots (C) can't be anchored, highlighted or read by a screen reader.
**Conditions:**
- Capture `document.body`, not `#root`. Popovers, the Settings hover preview, toasts and dialogs render in portals outside `#root`, so a `#root` snapshot silently drops exactly the states the tour wants to show.
- Make every control the tour doesn't drive visibly inert (cursor, "snapshot: try it in the app" tooltip), and rewrite or neutralize router `href`s. A link that 404s inside the artifact breaks the repo's own no-dead-links rule.
- Label it "snapshots of the real app at commit <sha>, captured <date>", and ship the capture script next to the README, not just prose about it.
**Failure if wrong:** with A, the evaluator diffs a hand-made screen against `make dev` and finds a mismatch (spacing, a label, a count). After that, nothing in the tour is trusted.

## Q2 Model in/out on #4821: C, with the model pane on the right step
**Reason:** #4821 is scripted in deterministic mode, and it would be planned by the model in live mode. Its own cassette `clm_4821_group.jsonl` exists, and it is synthetic. Showing its real CASE FACTS is honest only with that sentence attached. Moving the model's output shape to #4744 keeps the two stories separate.
**Additions:**
- Put CASE FACTS, tools and the plan on the **inbox recommendation** step, not the Approve step. The Approve-3 run is `ApprovedPlanPlanner`: no reads and no model call in *either* mode. Its SSE events still say `"planner": "scripted"` and stream an "Investigate" step that reads nothing. Say so in the pane: "approval run: executes what Dana approved; Policy re-checks; no model in any mode."
- Say "in live mode this block is the first user message", not "the model gets exactly this message". The real request also carries the system prompt and tools, and the E1–E5 handles map back to `ev_*` ids. Show that mapping.
- Label every #4744 transcript, and the #4821 live-mode note, "hand-authored in the live wire format (cassette `synthetic: true`); no captured API response exists yet."
**Failure if wrong:** with B, a staff engineer opens `clm_4744.jsonl`, reads `"synthetic": true`, and concludes the applicant passed off fiction as model output. That ends the interview.

## Q3 AI wording: B, tightened
**Reason:** B is the only version a reviewer can't catch out. A ("the model proposes") is false for every run in the default mode.
**Change:** "must produce runs of the same shape" implies parity was verified against Claude. It was checked only against hand-authored cassettes. Suggested copy: "Agents propose; the Policy layer decides whether anything runs. The demo runs deterministic by default (no model calls). Live mode sends the same case to Claude with the same tools and rules; the parity tests replay hand-authored cassettes until a live recording is made." Never write "the AI decided", "the agent chose" or "the model found" for a scripted or approval run.
**Failure if wrong:** the evaluator runs `grep -r synthetic apps/api/cassettes` (5 of 5 hits) right after reading "live mode produces identical runs".

## Q4 Clock state: A (Wednesday 10:40 everywhere outside the main tour's Try-it steps)
**Reason:** spec 06's acceptance bar is "no two screens disagree". A fixed baseline is the only way every screen tour agrees with every other screen tour.
**Additions:**
- Stamp each snapshot with its viewer and clock, read from the captured `/clock` and the user switcher (e.g. "as Dana · Wed 10:40"). Cash is Morgan's view; Dana's inbox reads 11 and Morgan's doesn't.
- Where the demo script quotes a Thursday number, give both numbers with their basis: days in A/R 27 on Wednesday, 26 on Thursday; Denied 5 → 9.
**Failure if wrong:** with B, the Denials screen tour shows 9 and the strip text in an earlier step says 5, and the evaluator files it as a counting bug.

## Q5 Owner-only clock: A, driven by the app's real user switcher
**Reason:** the role gate is a feature. Showing Dana press a button she doesn't have contradicts the "Clock control: Dr. Morgan" label on the same screen.
**How:**
- The Try-it switches to Morgan through the real "Signed in as (demo)" switcher, using a Morgan snapshot. Then it presses Morgan's real control and returns to a Dana-at-Thursday snapshot for the badge-14 payoff.
- The copy names the switch: "the tour switched to Dr. Morgan (owner); only the owner moves the clock."
- Reject a pure B: a Dana sidebar with a clock that moves anyway reads as a permissions bug.
**Failure if wrong:** the evaluator sees Dana's foot text "Clock control: Dr. Morgan" while the clock advances, and asks whether the role check is UI-only.

## Q6 Mock-only Payments/Patients: A
**Reason:** the app itself shows an iframe of a design page under the real banner. A screenshot under the real DOM banner reproduces what the user sees without importing a second page's links and scripts, each a dead-link risk.
**How:** capture the screenshot from inside the app at the same viewport width, and add one step on why: the no-dead-links rule, and "Designed, not built".
**Failure if wrong:** with B, inlined design links that go nowhere, or design styles that leak into the snapshot, in the one place the tour claims there are no dead ends.

## Q7 What I would ding (five)
1. **"Recorded from a live run" overclaim chain.** The repo says it in spec 06 step 3b, spec 07 §2.1, `clm_4744.plan.json` (`recorded_from: "live triage (claude-sonnet-5-5…)"`), and the UI label "recorded agent plan". Two more problems in the plan JSON:
   - Its `recorded_from` path `cassettes/canonical/followup/unknown/clm_4744.jsonl` does not exist; the file is `cassettes/canonical/clm_4744.jsonl`.
   - It says `reviewed_by: usr_dana`: a fictional persona signing off a dev artifact.

   All five canonical cassettes are synthetic. The tour must not inherit any of this wording. Fix the repo text in a separate change, because an evaluator will grep it.
2. **Model pane on an approval run.** See Q2. The Approve run's events say `planner: scripted` and include an Investigate step with no reads. Explain it or the evaluator will call it theater.
3. **Ids that disagree across panes.** The harness-built 4821 plan cites `ev_run_4821_1`, but the captured inbox item cites `ev_4821_pa`, and CASE FACTS shows E1–E5. Rebuild the plan from the seeded evidence, or annotate the handle → id mapping. Every id and number in a code pane must match the UI next to it.
4. **The code pane hides what it explains.** If the pane is open by default, it must sit beside the anchored element and never cover it. It collapses at narrow widths and the anchor stays visible. A tour whose highlight sits under its own JSON looks unreviewed.
5. **Hand-typed numbers in step copy.** Generate every count and amount in the copy from the captured JSON (`strip.json`, `inbox*.json`, `cash*.json`). Have the build script assert that DOM numbers equal the JSON. One stale "11" after the tour's own approve step undoes the "server computes every number" pitch.
