# Final red team fixes (challenge-final-d1-2026-11-08)

Two parallel sessions fixed the top five findings; each keeps its notes under its own heading.

## rt-seed

Findings 1 (Foster money) and 2 (claims leave before they exist).

**Foster #4772.** The 835 line is billed $255.00 = paid $108.80 + CO-45 $87.00 + PR-1 $32.00 + PR-2 $27.20. The
tracked benefits say the deductible was met 05/12 and basic restorative is 80%, so Cigna owed 80% × $168 allowed
= $134.40. It is **$25.60 short**. The patient owes **$33.60**, not the 835's $59.20. There is no refund.

- The seed adjudicates the claim a second time at the tracked benefits (`Pinned.expected`, the same function with
  no posting error). The remit line's `variance_cents`, its note, the claim's reason, the ERA evidence excerpt
  and the item's recommendation and params are all built from those cents. They are formatted with the same
  `dollars()` the run effects use. `tests/test_seed_variance.py` recomputes the figures from first principles
  (allowed × plan % with the deductible met) for every variance item.
- A dental billing-lead red team (a subagent) settled the judgment calls, and I adopted its answers:
  - Move $33.60 to the patient now. That is what the patient owes whichever way Cigna rules, so no refund and
    no second bill.
  - Hold $25.60, the money actually in question, and ask Cigna to reprocess the $32 PR-1.
  - Label the claim card "Underpaid", not "Denied". PR-1 is never a denial: the line paid.
  - Never headline the 835's $59.20.
- Claim screen:
  - API `money()`: a partial payment with a held benefit variance shows the expected figures (basis "expected
    at tracked benefits") beside the 835's.
  - Header: "Expected from Cigna, tracked benefits $134.40".
  - Web only: `DenialCard` says "Underpaid" with the server's reason on a partial claim where every line paid.
  - Web only: the Lines table lists PR adjustments after CO/OA. The API already sent `patient_adj`.
  - No schema change.

**Chronology.** 17 claims (the report said 14) were sent at hh:45 after a visit that ran to hh:50. Each now
leaves in the first file slot after its build. The Castillo FMX is now attached after the build (11:55).
`Builder.send` asserts the file time is not before the build. `test_invariants.py` checks visit ≤ built ≤ sent ≤
acks ≤ remitted, plus agent attachments ≥ build, over the whole seed. #4860 is a real resend (its first file was
rejected at 09:45, resent 10:15), so for that claim the newest 999 follows the send. Visible demo times are
unchanged. Today's 10:45/11:15 files are untouched.
