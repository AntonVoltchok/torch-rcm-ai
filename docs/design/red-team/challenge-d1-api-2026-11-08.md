Red team, written as a dental billing lead, 2026-11-08.
Given: CLAUDE.md, docs/plans/d1-build.md (the Phase 1 (api) notes are the position attacked), copy.json, actions.py, recipes.py, readmodels/claims.py, domain/enums.py, seed facts. Not given: the d1-api session's conversation.

# Challenge: d1-api phase 1 notes

## 1. Verdict per item

**1. Whose move: change.**
- *Rule 1:* "closed" means `closed_reason is not None` only. Otherwise #4748 (paid, with an open $38 item) shows "Finished" while it sits in Dana's Inbox.
- *Rule 2:* count only runs that are running, or queued and due now. If a day-30 status check is a queued run, #4733 reads "With the agents" for a month while Delta actually has it.
- *Paused runs:* go by the pause reason. A payer outage goes to `payer` ("Cigna portal down, retrying"); a run waiting on a person goes to `practice`. Otherwise #4851 contradicts its own copy, "This stays in your Inbox".
- *Rule 4:* `awaiting_primary_eob` goes to `payer`, naming the primary payer, only while the primary has no remittance. Once it has one, the move is `practice`: "Attach the primary EOB".
- *Rule 6, `rejected`:* goes to `practice`, always. The payer never adjudicated it.
- *Rule 6, `denied` and `partial`:* go to `payer` only if a submission, request or appeal left after the last 835. Otherwise `practice`: "Denied, nothing filed" / "Underpaid, nothing filed". An 835 with a payment on it is finished adjudication.
- *Rule 6, `ready`:* goes to `agents` only under an Act rule. Under Observe or Ask, it goes to `practice`.
- *Rule 6, `sent`:* goes to `payer`, labelled "Sent 10/27, no acknowledgment yet". After 2 business days without a 277CA, it goes to `practice`.

**2. `lands`: change.**
- `status_check` and `payer_rep_call` keep the claim's current move.
- `post_era_line` that queues reprocessing lands on `agents` ("Reprocessing request queued for Cigna"), or on `practice` if that request carries drafted text. It never lands on `payer` at run end.
- `patient_transfer` on an unpaid claim keeps the current move, not `payer`.

**3. `action_label`: change.**
- `drafted` changes the wording but not the tier. `reprocessing_request` is tier 1 with `carries_text=None`, yet its recipe sends `ctx.draft.text` to Delta. Add `reprocessing_letter` (tier 2, `carries_text`) and make "Send this note to Delta" its label.
- "Hold for reprocessing" should be "Post Cigna's payment, dispute $32".
- "Sign write-off and bill patient" should be "Sign write-off, move $1,012 to patient". Nothing sends a statement.

**4. `touches`: change.** Give reversibility per effect.
- PA group: "3 x-rays uploaded to NEA (permanent)" and "3 claims in the 11:15 AM Delta file (can be pulled until then)".
- Work out the file time at approve. With the 30-minute NEA lead, an approval at 10:50 misses 11:15.

**5. Step labels: adopt, plus one rule:** show only steps that exist.
- The copy has steps no recipe runs: "Post the Aetna line", "Set a status check for day 30", "Attach Delta's 03/2022 EOB".
- Worse, `reprocessing_request` drops `ReprocessingParams.attach`, so #4733 would go to Delta without the EOB that proves the mix-up. Pass `attach` through and add a step for it, "Enclose Delta's 03/2022 EOB".

**6. `signer_note`: change.** Build it from the users who hold `TIER3_ROLES`. `formal_appeal` allows a dentist, so "only Dr. Morgan" would be false there.

**7. `changes`: change.** Leave `move.*` rows out, or recompute them when the launch ends. Otherwise #4705 shows "Agents +1" beside "Waiting on MetLife". Note text: "Stays denied until Delta processes the resubmission".

**8. `claim_outcome`: adopt.**

**9. `TimelineEntry.who`: change.**
- `who` is the actor, always. A human approve is `practice`.
- Reject acks (`FILE_999_REJECT`, `*_277CA_A7`) and a $0 835 with no item go to `practice`.

**10. `procedures_plain`: change.** Show "D2740 Crown, tooth 30 + 1 more". Billing staff work by CDT code.

## 2. Strongest case against the whole position

The baton has no clearinghouse and no patient. Its status fallbacks fire in exactly the cases where nobody is working the claim (denied, rejected, partial with no open item), and there they say "Waiting on Delta". Finding unworked A/R is the billing lead's job, and this hides it behind a reassuring label.

Name a payer only on evidence that the payer owes a response. The 4 itemless partials are the test: I expect them to read "Waiting on Cigna" with nothing filed.

## 3. Three likely failures

1. **Wrong holder.** Scheduled checks put appealed and sent claims under "With the agents", and `rejected` reads "Waiting on Cigna".
2. **Wrong wording.** #4611 says "$228 written off", but `recipes.py` says no code performs a tier-3 action.
   - If nothing posts the write-off, the touch is false, and `lands=nobody` closes a claim whose ledger never changed.
   - Choose one. Either the signed run posts it (and the header is reworded), or the touch reads "Write-off to post in the PMS" and the claim lands on `practice`.
3. **Misleading number.** Dana's `inbox_claims` counts #4611, which she cannot approve, and #4748, which is paid and so not in `moves`. That shows 9 Inbox claims, 8 in practice and 8 mine side by side. Count `inbox_claims` over `move.mine`.

## 4. Wrong wording, with replacements

| Current | Replace with |
|---|---|
| "Record the $6.40 refund owed" (#4772) | "$6.40 more to patient if Cigna reprocesses". It is the coinsurance on the disputed $32, not a refund. |
| "Bill the patient $27.20" | "Move $27.20 to patient balance" |
| "Subscriber ID updated in the PMS" | "Subscriber ID on this claim changed". `patch_claim` changes the claim only; also fix the coverage record, or the next claim rejects. |
| "write NEA# to remarks" | "Write the NEA# and original ICN in the claim remarks" |
| "Write off $228 contractual", signed by the owner | "Adjust $228 to the Delta fee schedule". Signer note: "Closing insurance and billing the patient is Dr. Morgan's call." |
| "Finished", with a patient balance | "Insurance done · R. Diaz owes $1,012" |

## 5. What to keep

- **One server function for whose move, first match wins.** It is testable and gives one answer.
- **`mine` computed by the approve authority rule.** The browser cannot disagree with what approve allows.
- **`claim_outcome` in `RunShape`.** It is the honest check that deterministic and live mode agree.
- **Rejecting "touches = step labels".** Counted effects outside TorchRCM are what a billing lead signs off on.
- **"Resend" as a new original for rejections.** That is correct.
- **The `lands` == `claim_outcome.move_to` test.** Keep it, but only after the item 2 fixes, or it locks in wrong answers.
