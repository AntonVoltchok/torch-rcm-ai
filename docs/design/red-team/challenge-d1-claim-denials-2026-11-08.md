# Red team: D1 phase 2, Claim and Denials (2026-11-08)

Written as a red team (persona: dental billing lead / appeals specialist, three-location group). It was given the "Phase 2 (claim/denials) notes" in `docs/plans/d1-build.md`, `CLAUDE.md`, the D1 prototype's claim and denials code, and the canonical seed's facts for #4733, #4611, #4821 and the Denials worklist. It was not given the builder's reasoning beyond the plan, or the code. The adopted result is in the plan under "Red-team result, adopted".

## 1. Strongest case against
The plan spends three of eight calls on the handoff picture and treats the worklist as links into claim pages. A daily denial pass is deadline → reason → evidence → send → follow-up date → next claim; the plan is thin after "reason". The claim card's primary action sends agent-written text ("Send this note to Delta") while showing only the recommendation and why it stopped, so nobody reads the letter before it goes out, and its touches say it cannot be recalled: a tier-2 review collapses into a one-click send. Money misleads: #4733 is CO-119 (the 835 says patient owes $0; CO means the patient cannot be billed) yet the card shows "Patient, estimate $482", and the header calls billed $1,240 "at stake" in red when the contractual write-down was never collectable; what is at stake is the insurance share (`insurance_est_cents`). There is no follow-up date and no "next denial".

## 2. Three likely failures
1. Money: patient estimate on a CO denial; billed as "at stake" in red; #4611 shows $1,240 at stake when the decision is $228 written off and $1,012 to the patient.
2. Deadlines: every row says "Appeal by" though CO-16 "ours" rows are a corrected claim against timely filing; "No deadline / Nothing to appeal" is only true for PR rows; client day counts risk a timezone off-by-one.
3. Whose move: the practice lane labelled "You" while the next step is Dr. Morgan's signature; the summary resolving a person from a role on the client; row → claim → back with no J/K or Next.

## 3. Changes by call
1. Keep.
2. Lanes are Practice / Agents / {payer}; "You" only in the now leg when `mine`. A remittance entry never merges into a neighbour. Drop the `audit_line` parse; cut the entry title at its first clause and ask for `TimelineEntry.short`.
3. Fold above 6, but pin every remittance leg (a second denial decides the appeal level).
4. On a denied claim show Expected (estimate) beside Per the 835; when the 835's patient share is $0 under CO, say "Patient cannot be billed (CO)"; header "Billed" neutral plus "Expected from Delta, est." from `insurance_est_cents`; #4611 "Patient owes $1,012 (835)".
5. A `review_draft` card's primary is to read the note; send only after. Always show `touches` and `lands` by the button. "Switch to Dr. Morgan" marked "(demo)".
6. Keep total, tile cents "billed", server `by_holder` rows; never resolve a person from a role on the client: print the role until `HolderCount.label` exists.
7. Keep groups and the ERISA checklist; sort by deadline within a group; the deadline verb from `deadline.kind`; "No deadline on file", "Nothing to appeal" only on PR rows; a denial date column; J/K + Enter with the selected row in the URL; `move.label` for holder text; Payer × reason for billing too.
8. Keep; test the open-item button and denial code are above the fold at 1280×800.

## 4. Missing, ranked
1. Read the draft before sending (correctness). 2. "Next denial" on the claim from Denials, plus J/K. 3. Expected vs 835 with per-line group codes and a CO/PR call-out. 4. Copyable ICN, member ID, DOS. 5. Rep-call reference in the denial section. 6. URL filters (payer, root cause). 7. `#number` + DOS beside the name.
Needs a server field: `deadline.days_left`, `HolderCount.label`, row `at_stake_cents`, `follow_up_by`, `last_activity`, `location`, `TimelineEntry.short`, a denial date.

## 5. Keep
Name + `#number`, one destination per row; codes as `<abbr>`; "Patient can/cannot be billed if lost"; "ours" red, payer grey; server groups; ERISA checklist and workbench link; ghost leg from `lands`; `signer_note`; the `useClaimApprove()` seam; the 1280 clamp.
