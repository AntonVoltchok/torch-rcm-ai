# Red team: d1-api-3 leans (2026-11-08)

Persona: a dental billing lead (15 years of denials, A/R and payer portals) together with the hiring Director of Engineering. Input: `docs/plans/d1-build.md` → "Phase 3 (api) notes" → "Leans for what is left", items 1–5. One pass, by an independent subagent with read access to the repo. What was adopted is in the plan under "Phase 4a notes".

**1. headline: CHANGE.** Keep the field as a required `str`. Build it only from `classifier_situation`, never `model_situation`, so live and deterministic runs give the same text (assert this on the cassettes). Wording fixes:
- CO-119: "Delta denied this crown as too frequent; its tooth history doesn't match our chart." In the original, "conflicts with ours" collides with "Root cause: ours".
- Deductible: "Cigna applied a deductible the patient already met." Payers apply deductibles; they don't charge them.
- Alternate benefit: "Aetna paid the alternate benefit; the difference may be billable to the patient." The original's "$38 goes to the patient" is server-formatted money, which breaks the integer-cents rule. It also states as fact that the patient can be billed, which depends on the contract.
- Prompt pay: "MetLife hasn't paid in 64 days, past the prompt-pay limit." "Clean claim" is a legal claim the system can't vouch for. Take the 64 from `ctx.now`.
- run_failed: "The agents couldn't finish this; it's back with you."
- Test: a golden string for every canonical item, plus "no canonical item falls back to `title`".

**2. learnable: CHANGE.**
- Put `learnable()` in `agents/policy.py` (or `agents/learning.py`) and have it call `assert_learnable`. The lean's own "payload or claim denial" check would duplicate the guard.
- Add an evidence check after the outcome-metric check: `n < MIN_BASE_RATE_N` → `{ok: false, code: "not_enough_evidence"}`. Otherwise the line promises something that accept later refuses.
- Strings:
  - Tier 3: "A person always does this one. It never runs on its own."
  - Tier 2: "The owner sets this rule. It isn't learned from approvals."
  - Ours: "Root cause: ours. Fix where it starts (charting, coding or front desk); this kind always gets a review."
  - ok: "You can propose running this without review. The owner decides." The lean's "can learn" sounds automatic.
- Test, parametrized over every open item: `learnable.code` equals what `:always-auto-run` actually returns (200 when ok), including a claim where ours is computed now rather than in the payload.

**3. Confidence k/n: CHANGE.**
- Make `k: int` and `n: int` required, not nullable; `n` is 0 with no history. Add `outcome: str` ("paid within 30 days"), so the client bolds `{k} of {n}` and never parses `basis`.
- Validator: `k <= n`, and `pct == round(100k/n)` if and only if `n >= 5`.
- Drop "30 d". Basis wording: "Only 3 past cases like this, too few for a track record yet." For n = 0: "No past cases like this yet."

**4. 409 claim_busy: CHANGE.**
- Use one predicate, the same one `moves.py` uses for `who=agents` (`ACTIVE_RUN_STATUSES`). Place the check after the approved/edited replay return, so a replay with a new key stays 202.
- A 409 is not stored under its Idempotency-Key, so the same key succeeds once the run ends. Test that.
- Groups are all-or-nothing: if any member is busy, nothing is created and details are `{busy: [{item_id, claim_id, run_id, move_label}]}`.
- Messages:
  - Running: "Agents are working on #4821. Approve again when they finish."
  - Paused: "Agents paused on #4821. Resume or cancel that run first."
- Invariant test: for every open item, `move.who == "agents"` if and only if approve returns 409.

**5. Mock divergence: ADOPT.** Generate `approve_runs` from the API, never by hand, and add the 409 fixture to `contract_dump.py`.

**Missed entirely:** the UI only gets a 409 when its cache is stale. The 409 body should carry the fresh `item` (with `claim.move`), or the client should invalidate the inbox query on `claim_busy`. Without that, the lock never appears and the biller just sees an error. Cover it with a two-tab e2e.
