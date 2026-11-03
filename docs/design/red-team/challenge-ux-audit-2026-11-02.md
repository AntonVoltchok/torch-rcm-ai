# Challenge: UX audit (red team)

Written as a red team by a subagent playing a healthcare-RCM product designer and portfolio reviewer, 2026-11-02.
Given: `docs/design/ux-audit-2026-11-02.md` (first draft), `docs/spec/06-demo-script.md`, nine real screenshots, the owner's words. Not given: the decisions log, earlier red-team reports, or the fixture data. It judged from screenshots and saw nothing post-click.

---

**Verdict:** the audit is right that everything is equally loud. It is wrong about what will sink this demo. It audits resting pixels, but evaluators judge motion and truth.

## 1. Strongest case against the audit

**Biggest miss:** the peak was never watched. The audit admits no item was approved. It has no findings on the ProgressPanel, the after-state, step 3b, the Thursday skip or the failure path. A8 is marked "unverified". All five directions are pre-click designs.

**Real problems with no finding:**
- **"Why did this stop at me?"** Nothing names the rule that gated an item. T1 is a bare chip. This is the product's core claim, and the Inbox never shows it.
- **The owner said five minutes; the script runs ten.** Nobody has cut it. Settings, where the policy story lives (steps 6–7), is out of scope.
- **Truth defects.** The spec says no two screens may disagree. These reads are worse than any type problem:
  - "12 items need you" sits beside "9 claims need action", unreconciled.
  - Today's claims shows "last file —" above rows filed at 9:45 and 10:15.
  - #4854 shows built 2:23 PM on a 10:40 AM clock.
  - Delta claims leave in the 10:45 file, but script step 3 queues for 11:15.
  - Activity shows 2 status checks and 1 payer call. Settings shows both rules ran 0.
  - #4611 carries a T2 chip beside "(tier 3)".
- **Fake evidence.** The audit praises "real provenance". The portal card is a gray wireframe and the x-ray is a gradient blob. Raw ids (`img_diaz_f_1019_pa_14`, `rem_delta_1026`) sit on the hero cards, yet D7 flags ids only on Activity. "Every shortcut must be invisible" fails on the trust surface.
- **Today's claims** gets zero findings.

**Mis-graded or misdiagnosed:**
- **A6 is under-graded.** "Always auto-run this…" appears on #4840, whose root cause is ours, which the hard rule says can never learn into auto-run. That is an evaluator's first gotcha, not a link-weight problem. Make it P0.
- **H3 is not P0.** Nothing is blocked. Steps 1, 3, 5 and 8 all use the strip. Ranking matters; location does not.
- **A4 is not P0.** It is metric theatre: "0 filled buttons". Denials is step 10. A button there adds another approve surface and worsens A2.
- **H1 is P1.** It is a one-line fix, and it collides with A3, because auto-open lands on the unapprovable #4611.
- **S3 assumes the wrong reader.** Evaluators build this software. Gloss Torch's coinages (T1, "no base rate"), not CO-16.
- **S2's fix is dangerous.** "No base rate" is honest. Reword it; don't bury it.
- **D1 misdiagnoses.** The timeline is on screen. Newest-last puts the fold at the denial, so the fix and the outcome are hidden.
- **D2 misses the bigger issue.** Allowed $986 and contractual −$254 sit on a denied, $0-paid claim unlabelled as estimates. Patient shows $482 in the cell and $0 in the table.

Keep P0: A1, A2, A3, S1, H2.

## 2. Three likeliest failures

1. **Beautiful front, old engine.** Dana presses ⇧A in a calm new layout and drops into the unredesigned panel. The evaluator asks, "Show me when a step fails." The prettiest screen becomes the least rehearsed.
2. **Removal kills the proof.** Collapse the strip and "Denied stays 5" and "Denied → 9" happen off-screen. Hide evidence one click away and step 2 loses its argument. The result reads as a generic AI inbox, and every step is a Playwright test, so the demo suite breaks too. Evaluators read thin as shallow.
3. **Hierarchy amplifies the contradictions.** A big "41" invites comparison with Settings. A sticky "Approve 3 · $3,730" beside a red root cause beside "Always auto-run" states the guard violation louder. A spotlit gradient blob is the first thing that gets questioned. Fix truth before volume.

## 3. What I would change

**Principles:**
- **1:** Scope it to decision screens. It breaks on #4611, Denials and Activity. Add: a blocked item says, as visible text, who can act and why.
- **2:** Evidence is "justify", never "audit". Otherwise it contradicts your own survival list.
- **3:** Add where tiers go. They should be neutral. Lead with "23 of 25", not 92%.
- **5:** Rewrite: "the strip stays visible and compressed; only what changed or needs you has weight."
- **6:** Replace "how sure" with "how often this has worked". Add "which rule stopped it".
- **7:** Move it to first. It is the best idea here, and it must be a server-derived field, never client logic.
- **New:** "Design the after-state." Every decision shows what happens next and what changed.
- **New:** "Truth before hierarchy." Any number made louder must first reconcile across screens.

**Directions:**
- **Baseline:** A's type, colour and contrast repairs go into all five, and the truth fixes ship regardless. Otherwise the variations compare skins.
- **A (Quiet):** A and B are currently one design with two knobs. Make A the density-preserving biller's view: the same information with real hierarchy. It must prove H4, H5, C1, C3 and S1.
- **B (Docked):** Make it the decision-first version. The bar must state what gets touched: three NEA uploads, three resubmits, which file, what is irreversible. It must prove A1, A2, A3 and A6. Specify what auto-open does with #4611. Inline the policy preview on "Always auto-run": "41 → 44, 3 held, net 41". That brings the policy story into scope.
- **C (Brief):** At 10:40 AM a "morning" gate fails. Make it the empty-selection state, not a route. It fixes H1 and H2, and it pays off after step 8. It must prove Inbox 10 → 17 reads as a story. Walking the queue must keep J/K and Approve 3.
- **D (Whose move):** Keep it, but not as three columns. The Inbox is all "yours", and lanes plus a detail pane will not fit at 1280. Use a claim-wide state line across rows, Claim and Denials, and show Approve 3 moving ownership. It must prove "Denied stays 5" is understood without narration.
- **E (Spotlight):** Replace it. It is C with a costume. Dimming fights evidence and reintroduces C3. The bold swing should be conceptual: **Run log**. The agents' live stream is the primary surface, and decisions arrive as blocking prompts. Approve is allow-once, "always auto-run" is always-allow, and tier 3 is a hard stop. Evaluators use Claude Code daily and will read it instantly. It must prove the post-click moment, the failure path, D9 grouping and A6. Keep the distinct identity if the owner wants it, as type and colour only.

Each variation should also state which of the five-minute steps it serves. I would cut the script to 1, 2, 3, 4, 6, 8. Make parts genuinely swappable, or per-part tagging will produce unbuildable hybrids.

## 4. What I would keep and why

- **The diagnosis.** Equal loudness matches what the owner said and what I see.
- **A1, A2, A3 and S1.** These are the real action failures. S1 is the single highest-value fix. Keep claim numbers beside names, though, because F./R. Diaz and two K. Owenses collide.
- **Principles 3, 7 and 8.**
- **"Root cause: ours" staying uncomfortable.** It is the most credible thing on screen.
- **The honest base rates, the keyboard model and URL state.** Evaluators reward them.
- **Keeping the original as an option.** It is the control. If a variation cannot beat it on steps 2–3, it loses.
- **N1, with a limit.** Tidy it, but persona and clock must stay one click away, because steps 6–8 depend on them. N4 is right: demote the banner into "1 running", but keep it visible because it evidences the outage path.
