Final red team, written as the hiring Director of Engineering and a dental billing lead.
Given: the repo, the PR and a running copy of the app. Not given: the builder's conversation.

---

How I checked: I read the spec, ADR-0008, STATUS and PR #1. I seeded a scratch DB, ran the API on :8111 and a production build on :5211, and walked steps 1, 2, 3, 3b and 8, then Denials and Payments, at 1440×900. I also queried every claim's timeline over HTTP. The owner's :8000/:5173 were not touched.

## 1. Verdict on the work (Director of Engineering)

This is a strong candidate. The architecture holds up under questioning:
- The Policy layer is the only thing that executes.
- Whose move is one server predicate, and the same predicate drives the 409.
- Deterministic replay comes with a cassette eval.
- The full `@demo` script passes against the real API.

**The strongest case against it** is that the product's thesis is "every number is computed and traceable", and the cracks are exactly there. They are not in the architecture. They are in hand-typed seed strings and seed timestamps that no invariant covers. A billing lead in the room finds them in minutes, and the obvious next question is: "you have 625 tests; why did none catch this?"

Two more things make that worse:
- The PR is +37k/−7k over 378 files and carries an unmerged branch.
- The browser keeps a 2,122-line TypeScript copy of the server's read models (`apps/web/src/mocks/db.ts`).

Together these invite "how much of this do you own?" Be ready to explain `readmodels/moves.py` without notes.

### Top five findings, ranked by damage

**1. The Foster variance math is wrong. The repo's own design has it right.**

What the app says, in the Inbox and on the claim page, for #4772: "PR-1 $32 … Patient owes $27.20 now; $32 disputed; refund $6.40 owed". The source is hand-typed at `seed/canonical/agents.py:1237`, with `patient_cents: 2_720, disputed_cents: 3_200` a few lines below.

What is right: allowed is $168 and the deductible is met, so Cigna owes 80% = $134.40 and the patient owes $33.60. Cigna paid $108.80, so it is short **$25.60**, not $32. The patient owes **$33.60**, not $27.20. There is no refund.

`docs/design/mocks.html` (Payments, "short $25.60 … Patient share should be $33.60") gets this right. The app shipped the other mock's wrong numbers.

The tier-2 action would post a $27.20 patient balance and refund $6.40, then re-bill it after Cigna reprocesses. That breaks product rule 10 ("patients are never surprised").

The same screen also contradicts itself:
- The header says "Patient owes, per the 835 $59.20".
- The denial card says "Denied PR-1" on a claim whose status is **Partial**.
- The Lines table shows only "CO-45 $87" and hides the PR-1 and PR-2 being disputed.

This also breaks the CLAUDE.md hard rule "never render a number the server didn't compute".

*Fix:* derive the recommendation's numbers from the ERA line and the tracked benefits. Show PR adjustments on the lines.

**2. Claims leave in the file before they exist.**

14 pinned claims have their 999 and 277CA timestamped before the visit was completed. On #4772, Foster's history reads: 999 accepted at 2:47 PM, Vyne A1 at 2:49, visit completed at 2:50, claim built at 2:53. The History lanes draw "Cigna 10/16 Accepted" *before* "Practice 10/16 Visit".

Affected demo claims: #4611, #4709, #4731, #4748, #4772, #4797, #4800.

The cause is in `pinned.py`: `make()` defaults to `visit_minutes=50` and the build happens at +53 min (`pinned.py:211`), but the `sent()` calls use `at+45`. The only invariant, `tests/test_invariants.py:83-88`, checks built ≥ visit and never checks sent ≥ built.

*Fix:* send at the first file slot after the build, and add `ack ≥ sent ≥ built ≥ completed` as an invariant. About 1 h.

**3. One Denials row names two different signers.**

On screen, the Morris #3561 row reads "Dr. Lee signs" with "Dr. Morgan signs" directly under it. Dr. Morgan is the rendering dentist.

The cause is `readmodels/moves.py:134-142`. `_sole(snap, Role.DENTIST)` returns the only user whose role is dentist, which is Dr. Lee, because Morgan's role is owner. That happens whenever the item has no `assignee_user_id`. The Denials signer comes from the rendering provider. The Inbox move label and the Denials header ("2 with the dentist") both inherit the error.

That fails the acceptance criterion "no two screens disagree".

The domain is wrong too. A CO-29 dispute backed by the payer's own 277CA proof of receipt is an administrative reconsideration. Billing staff send it in ten minutes. It is not a clinical "formal appeal" where "the rendering dentist signs the attestation" (`agents/planner/scripts/appeals.py:52-64`). That is exactly the distinction product rule 9 exists to make.

**4. The first screen contradicts itself, and the tier-3 item is a contractual adjustment.**

Step 1 says "12 items need you" and "Yours 12", yet R. Diaz #4611 sits under "Not yours to do", signed by Dr. Morgan only. The 12 counts it anyway.

That item is "write off $228 (contractual)", tier 3, owner-only (`seed/canonical/agents.py:1349-1368`). Its lines carry CO-45 $198 + $24 + $6. Contractual adjustments post with the ERA, and nobody "signs" them. The real decision is a tier-2 move of $1,012 to the patient plus a statement.

A billing lead will say so out loud during step 1.

**5. The "unknown" triage shows borrowed certainty.**

After step 3b, the #4744 item carries `confidence 94% · 91 of 97 paid within 30 days`. That is the generic records-request rule's base rate, applied to a case the classifier could *not* name. Castillo (root cause ours) shows the same 91/97.

This breaks product rule 6 ("no fake certainty"). It is also the one screen where an interviewer will ask how confidence is computed.

Smaller problems:
- The #4744 headline is just its title: "Records request · MetLife · #4744".
- Its audit line reads "rule … (auto) · propose".

**Near misses worth knowing:**
- **Approve flashes the next item.** `InboxPage.tsx:91-94` calls `removeAndAdvance` before `onLaunched`. After ⇧A I saw J. Chen's decision pane, greyed, for about 1–2 s before the run took over. That is the R1 pattern the ADR says is fixed.
- **Payments shows the design exploration first.** The page opens on the mocks' top page ("All data is fake", "hiring-interviewer red team", Round 1–7 navigation) before it scrolls to `#r3-pay`. It then shows a second TorchRCM sidebar inside the first.
- **Run labels are confusing.** The run footer reads "scripted, live" in deterministic mode ("live" there means the stream). Running claims show "Step 1 of 1".
- **Stored text goes stale.** Brooks's headline says 65 days while its recommendation still says "Clean claim, 64 days", because the recommendation is a stored string.

**Repo hygiene:**
- STATUS says "not pushed", but the PR exists.
- `CLAUDE.md` still says "Torch".
- STATUS explains that "the sandbox refuses the word in a command". That line will be read aloud.

## 2. How realistic is the demo (billing lead)

**Score: 7/10.** The vocabulary, the code pairs and the workflow are better than most real vendor demos. The money math on the one variance item, the out-of-order timestamps and the signer mix-ups are what make it read as staged.

Step by step:

**Step 1. Inbox.**
- Rings true:
  - The headlines read like a coordinator's notes. "MetLife hasn't paid in 64 days, past the prompt-pay limit" is a good example.
  - J. Chen's "Quote $470 at check-in, or move D2392 after 1/1" is exactly right.
  - S. Kim's frequency flag offers the non-covered acknowledgment.
- Rings false:
  - The 12 includes an item that isn't Dana's.
  - #4733, #4611 and #4821 are all "D2740 + 2 more · $1,240". Three identical crowns look generated.
  - Two Diaz patients appear on one screen.
  - The sidebar outage names Cigna, but N. Park's flag says MetLife portal *and* IVR have been down since 05:40.

**Step 2. Delta group.**
- Rings true:
  - CO-16 with N29 is the correct pair.
  - The rep-call note ("send the PA through FastAttach and resubmit with the claim number; no appeal needed") is a realistic call.
  - "Root cause: ours" with a guard is the most credible thing in the product.
  - The 835 line, the IVR transcript and the portal evidence all carry references.
- Rings false:
  - The group header says "not the PA of #14" for three different teeth, and the wording changes with whichever member is selected.
  - A lead will also ask how a plain resubmit avoids a CO-18 duplicate. Is it frequency 7 or a reconsideration?

**Step 3. Approve.**
- Rings true: NEA# 26-4463084, the NEA# and original ICN written to remarks, "Can be pulled from the file until 11:15", and the claim staying `denied` while it is in flight are all right.
- Rings false: the flash of the next item.

**Step 3b. #4744 triage.**
- Rings true: the missing-tooth clause, "date of extraction / initial or replacement", and the 2019 D7140 note are spot on.
- Rings false:
  - The 94% confidence.
  - The claim timeline jumps from 09/17 to 10/28. The day-30 check on 10/16 and the 10/22 correspondence the triage just read are not in History.

**Step 8. Overnight.**
- Rings true:
  - CO-50·N10 to a formal appeal, with 180 days under ERISA 29 CFR 2560.503-1 and patient authorization.
  - CO-22 sent to a coverage-order change, with a MetLife-as-primary filing deadline.
  - CO-16·M127 held because the root cause is ours.
  - "If lost: patient can / cannot be billed" on every Denials row. A billing lead will love this.
- Rings false:
  - Morris was accepted with an ICN on 11/04/2025 and then had zero activity for 360 days before CO-29. That contradicts your own "day 30, then every 15 days" cadence.
  - Brooks's first status check is on day 63.
  - The dentist signing a timely-filing appeal.

**Step 10. Cash.**
- Rings true: formulas are shown next to the numbers.
- Rings false: Days in A/R divides A/R carried at *billed* by *net* production, which inflates it. Use gross production, or carry A/R at expected.

**What a billing lead catches in the first five minutes:**
1. The Diaz "write-off" that needs the owner's signature is a contractual adjustment.
2. Foster's $32 should be $25.60, and $6.40 is refunded to a patient who owes it.
3. Acks are timestamped before the visit on the Foster and Diaz claims.
4. Dr. Lee is shown signing Dr. Morgan's appeal.

## 3. What to fix before showing it (value per hour)

1. **Foster numbers** — 1–2 h.
   - Correct the seed string and params to $33.60 patient and $25.60 variance, with no refund.
   - Change "Denied PR-1" to a partial-payment label.
   - Show PR-1 and PR-2 in the line adjustments.
   - Add a test that the recommendation's numbers match the ERA line. Better still, generate the sentence from the ERA line and coverage (+2 h).
2. **Chronology** — about 1 h.
   - Fix the `sent()` times in `pinned.py`.
   - Add the invariant `ack ≥ sent ≥ built ≥ visit completed`.
3. **"Need you" count** — 1 h. Count only the viewer's items (`mine`), or say "12 open · 11 yours".
4. **Signer** — 1–2 h.
   - Set `assignee_user_id` from the rendering provider on items a dentist signs, or have `_practice_label` read the claim's provider.
   - Add a test that the Inbox move label equals the Denials signer.
5. **Confidence on `unknown`** — 1 h. Show "no track record: the classifier couldn't name this" instead of the rule's base rate.
6. **Approve flash** — 1–2 h. Keep the pane on a pending launch until `onLaunched`, then advance.
7. **Diaz tier** — 2–3 h. Make it a tier-2 patient transfer plus statement. The CO-45 posts with the ERA. Update demo step 1 and the e2e test.
8. **Morris** — 3–4 h. Make it a reconsideration with proof of receipt, no dentist signature. This touches step 8, the appeals script and the eval shapes.
9. **Payments** — 1 h. Frame just the screen: a query flag that hides the mocks' overview and navigation, or a static image.
10. **Status-check history** — 2 h. Seed checks for Hale, Brooks and Morris. Re-check the weekly counts afterwards.
11. **Smaller fixes** — about 1 h together.
    - Days in A/R denominator (30 min).
    - "scripted, live" label (15 min).
    - Stale "64 days" text (30 min).
    - CLAUDE.md name and the STATUS state line (15 min).

Items 1–6 take about one working day, and they remove everything on the five-minute list except Diaz.

## 4. What to keep and defend

- **Whose move as a server field, with `mine` computed per viewer.** The predicate behind the UI lock and the `409 claim_busy` is the same one (`moves.active_runs`), and an invariant test proves it. This is the best answer you have to "why not compute it in React?"
- **The Policy layer as the only executor.** No mutating tool is exposed to the model. The root-cause-ours guard, the `unreviewed_text()` exact-body guard and `tests/adversarial/` together make the strongest safety story in the repo.
- **Deterministic by default, with a cassette eval.** `claim_outcome` is part of `RunShape`. "Recorded agent plan" is labelled honestly on screen.
- **Step 3b's transparency.** The reads the agent chose, its own label, the policy verdict and the audit line are all shown. This is what an agentic-RCM buyer wants to see.
- **The URL holds the state** (`?group=&item=&launch=`), and runs resume after a reload. TanStack-literate reviewers will notice.
- **Domain choices that only a practitioner makes.** These read as domain knowledge, not research:
  - Reconsideration, records request and formal appeal are kept separate.
  - "If lost: patient can / cannot be billed" on every denial.
  - Prompt-pay is checked only on insured plans (`self_funded: false`).
  - The ERISA citation.
  - The hold window ("can be pulled until 11:15").
  - "In flight" is a flag on a denied claim, not a new status.
- **The full `@demo` script passes against the real API**, not just MSW. Lead with that whenever the 2,122-line mock DB comes up.
