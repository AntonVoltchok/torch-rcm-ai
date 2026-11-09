_Red team, 2026-11-02. Persona: staff engineer who has shipped production agents on the Anthropic API and reviews money-touching systems for dental practice owners._
_Given: the coordinator's position in full (`docs/plans/first-run-decisions.md`), the owner's own words, the repo on `chore/first-run`, and leave to run read-only checks. Not given: the coordinator's reasoning beyond the plan, or any hoped-for outcome._

# Red team: first-run decisions

Tags: **[ran]** reproduced on throwaway DBs, a scratch server or a scratch vitest; **[read]** traced in code; **[infer]** my inference. The repo is unchanged; `git status` shows only the plan file.

## 1. Strongest case against

The options chosen are mostly sound. The safety sentences that justify them are not. "A retry cannot duplicate" and "Observe runs open no item" are false. "Can only tighten the `ours` guard" holds for row 10 but not for learning. "The overlap needs a reproduction" reproduced on the first try. Call 1 also exposes an old authorization hole.

## 2. Three likeliest failures

**A. Billing can sign a tier-2 rule. [ran]**
- `_check_can_approve` returns on an approved item before the owner check (`inbox.py:95-96`, `:111`).
- `_approve` then re-enters `_approve_signoff` with no state check (`inbox.py:135-136`), which signs as the caller (`rules.py:129-130`).
- Sequence: Dana requests auto, Morgan approves, Morgan sets `ask`, Dana POSTs approve again. Result: `auto v4 signed_by usr_dana`, and `rules_valid` fails.
- The code dates from 5818c6d. Before 5c1ea05 the web's key (`client.ts:68`) rolled the item back, so call 1 makes it reachable there [infer]. It needs a direct POST; I traced no UI button to it.

**B. The clock moves under a running approval. [ran]**
- The worker checks `advance_lock` once, then awaits the job unlocked (`runner.py:252-255`). An advance never waits for it (`:199`, `:216`).
- On the real API I approved #4836 and advanced 1.2 s later. Steps 0–2 are stamped Wed 10:40 and steps 3–7 Thu 05:45. Step 6 reads "queue for 11:15 Delta file · 07:45".
- A presenter who clicks Skip while the run streams will hit this [infer].

**C. Call 2's hard-rule claims fail. [ran]**
- *Observe:* row 5 precedes row 7 (`policy.py:311,313`). With every rule on `observe`, #4744, #4709 and #4731 each opened an item, status `succeeded`, carrying the observe rule's id. Spec row 5 allows this; the hard rule does not.
- *Payer contact:* those runs logged `portal.correspondence` under `payer:*` (`adapters.py:222-230`). No invariant catches either problem.
- *Reuse:* `_open_item` returns at `executor.py:505-507`, before the record at `:546`. I forced this on #4797: rule on `ask`, item opens `payer`, attachment restored by hand, clock +1 h. The run computed `ours`; claim and item stayed `payer`; the invariant stayed silent because they agree; `always_auto_run` passed; accepting created an `auto` learned rule. Row 10 still stops that claim, but the learning rule breaks. The natural trigger is inferred.
- `guard_root_cause_ours` is called only from `learning.py:84`; the API guards are inline (`inbox.py:274`, `rules.py:376`) [read].

### The traces requested

- **Q1. Can recording loosen a guard? No. [read]** Every guard tests `ours`, and `case.py:71-73` keeps it sticky, so `payer` never overwrites `ours` through the record. A stale overwrite would need a second active triage (`runtime.py:573-575`), and approval runs open no item (`executor.py:758`). `sim.py:534-539` resets the denial to PAYER on re-adjudication, so stickiness lasts one denial.
- **Q2. Does recording change a re-run? Only for `ours`.** Computed is never `unknown` with a denial (`situations.py:204-215`), so a stored value matters only as `ours` [read]. Open items aren't refreshed, and confidence is base rate only [read]. With the write stubbed, shapes still pass and `make eval`'s harness fails in both modes: "item says ours, claim 4797 says payer" [ran].
- **Q4. Sign-off path. [ran]**
  - Same key after resolution creates `_2`.
  - Same key with a different body creates `_3`, no 422.
  - A 500-character key is accepted.
  - Concurrent requests, same or different change, raise an unhandled `DuplicateError` (`rules.py:246-249`, no handler in `app.py:131,135`). One item survives; the other request gets a 500 [infer].
  - Two open changes are both approvable, and the second keeps a stale preview.
  - The payload lacks the `before` that spec 07:382 requires.
  - `RulePatchIn` has no text field (`schemas.py:526`). Only a second requester's identity would be lost, and the seed has one billing user.
- **Q5. `useRun`:**
  - No leak: the server closes on terminal and cleanup aborts [read].
  - Double invalidation is real. The API appends `status` plus `done{run_id}` after the real `done` (`system.py:153-157`, captured [ran]).
  - `useRun.ts:107` lets the later frame overwrite `finished`. A scratch hook test on those bytes gave mode `desynced`, strip invalidated three times, 23 invalidate calls [ran].
  - The fixture at `useRun.test.tsx:51` omits those frames. It is invisible because the UI shows the mode only for non-terminal runs [read].
  - Two observers mean two streams and an idempotent reducer, so harmless [read]. `ProgressPanel` sits on separate routes.

## 3. Call by call

1. **Adopt with changes.**
   - Blocker: run the owner check before the state return, and let replay skip `_approve_signoff`.
   - Put read and insert in one `tx()`.
   - Store the key on the request: same key returns that item in any state; a different change gives `idempotency_key_reused`. Validate the key before the branch.
   - Pin `rule_version` and `before`, and refuse a stale approval with a 409.
2. **Adopt with changes.**
   - Record before the reuse return, and refresh the item's payload.
   - Route the API's learning guards through `guard_root_cause_ours`, fed the computed cause.
   - Make item insert and record one transaction, with an audit event. #4797's write left none [ran].
   - `timeline.py:84-106` back-dates the finding to ERA receipt with fixed "wrong attachment" text [read].
   - Make rows 4–5 yield to row 7 under an observe rule and amend the spec; the hard rule wins. Add the invariant, and relabel or gate the payer read.
   - Add tests: 9c96de3 touched no test file.
   - Record the residual: an Observe run says `ours` while Denials says `payer` [ran]. The source is `sim.py:538` hard-coding PAYER; fix that next.
3. **Reject "C now".** The owner said "no contract changes", and it isn't needed for green. The lean contradicts its own reason. Record it as next: `errors=` already exists, and only `table_document()` emits it (`contract.py:426-430`). Assert the real 409 in `pnpm test:contract`, which never mentions it [read].
4. **Reject A.** The frame is also location-blind (`executor.py:328`) but lands in a location-keyed cache (`useRun.ts:58`), so a Riverside viewer gets practice-wide tiles [read]. `meta.counts` has the same flaw (`context.py:39`, `router.tsx:27`), under a 30 s `staleTime`, so "corrected in milliseconds" doesn't hold there [read]. Web-only fix: drop the write at `useRun.ts:58`, because `done` refetches. When a location is selected, invalidate instead of writing `meta.counts`. The server keeps publishing the frame, so nothing changes in the contract.
5. **Split.** Adopt A for the handlers; the README lists them. Reject it for the overlap: it reproduced. Hold a job lock around the worker's `run_one` and around `execute_advance`. Queued approvals sort first anyway [read]. Add a gated test.
6. **Adopt, with these edits.**
   - README:18 states live-mode parity in the present tense, though live mode has never reached the API.
   - Stale: STATUS head and README "How this was built" (never compiled, old test counts); WALKTHROUGH:17,23; CLAUDE.md's "hand-maintained".
   - ADR-0005's "not yet in CI" contradicts `ci.yml:71`.
   - Say plainly that eval checks shape against hand-authored cassettes. #4797 itself runs `scripted_fallback` in live mode [ran].
   - CI has no e2e step, so real-API e2e is local only.

Also fix `useRun.ts`: first terminal frame wins, correct the comment at `:78`, and make the fixture carry the real ending.

## 4. Keep

- **Call 1's shape:** the 409 stays, per spec 07:382. Option B generalises for one call site; option C breaks the contract.
- **Call 2's location:** on the claim. Option B reverts when the item resolves; option C writes under Observe.
- **The eval invariant:** it has teeth for Castillo [ran].
- **Removing `terminal` from the effect's dependencies:** correct, with no leak.
- **Deferring the handlers, and call 6's honesty about what was not run.**
- **Policy row 10:** it held in every sequence I ran.
