> Written as a red team by a hiring Director of Engineering persona.
> Given: the plan with its leans and the listed files. Not given: the conversation, the API source, or the worker's reasoning beyond the plan.

# Red team: web contract pass

## 1. Strongest case against the position

The plan opens by saying the web app is green against the real API contract, and nothing committed proves it. `wire.test.ts` proves the mock parses under the schemas. Mock-mode Playwright proves the UI works against the mock. The only link from those schemas to a running server is a scratch harness the plan says is not committed. CLAUDE.md says a feature without its invariant test is not done, and `package.json:16` has an `e2e:real` script the evidence never mentions. For an app first compiled today, that is the call that matters, and it is not one of the eight.

The leans were also decided one at a time. Option C in call 6 makes `default_factory` fields required, so every fixture that call 2 lets omit them stops compiling. Nobody planned for that. The `??` in call 6 turns a missing field into an empty value, which is the failure `schema.ts:4` claims to prevent.

## 2. Three likely failures in front of a reviewer

1. **"Run it against the API."** `pnpm e2e` hits the mock, and the 535-response claim cannot be reproduced from the repo.
2. **A dental reviewer reads claim detail.** `cdt.ts:42` calls D9941 an occlusal guard; D9941 is the athletic mouthguard. `MoneyMath.tsx` never renders `writeoff_cents` or `patient_resp_cents` (`generated.ts:551-552`), though spec 05:47 lists write-off.
3. **The reviewer clicks evidence.** `Timeline.tsx:26-36` has no pending state, no retry (spec 05:53 requires it) and no empty state. The count comes from the entry and the cards from one run, so "3 evidence items" can open onto nothing. Line 70 drops evidence silently when an entry has no `run_id`.

## 3. Verdicts

| # | Verdict | The one reason |
|---|---|---|
| 1 | Adopt A | The worker is inert until registered, so stripping it adds build logic to hide nothing. |
| 2 | Adopt A, and fix `wire.ts:2` | The client's parse is the thing under test. But Pydantic sends every default, so the mock does not write "what Pydantic would send". |
| 3 | Adopt A, plus pending, empty and retry states | One cached run fetched on click is not N+1, and it is the only fix the worker owns. |
| 4 | Adopt A, fix D9941, drop the `PAYER_NAME` comparison | A code label is display-only. The comparison fails because the API sends `PayerRef.name` and sends no CDT name. |
| 5 | Adopt A, and report spec 05:55 as stale, not as a gap | `InjectIn` offers `portal_outage` and no Vyne event (`generated.ts:1047`), so the contract cannot stage the outage the spec names. |
| 6 | Adopt A now, recommend C, and state the fixture cost | Only C makes the document true; B hand-patches a generated cascade. |
| 7 | Adopt A | `*Out` is a server direction convention the client has no use for, and each alias is one `tsc`-checked line. |
| 8 | Adopt A, plus the arithmetic for 26 sent with the report | B loosens an assertion and C edits to match a mock. Replacing 27 with the app's output is a snapshot update until someone derives 26 from the formula and the seed. |

## 4. What I would change beyond the eight

- **Commit the harness** under `apps/web/scripts` as a named command, and report an `e2e:real` result. This outranks everything below.
- **Nullable money is not integer.** 21 `*_cents` lines in `generated.ts` are `z.union([z.number(), z.null()])`, including `:546-552`, while `schema.ts:7` promises integer cents. A float `paid_cents` parses. Fix it in `gen-api.mjs`, the file the worker owns.
- **`MoneyMath.tsx:8`** branches on `basis`, a free-text `z.string()` (`generated.ts:553`). A copy change marks every paid claim "est.". Ask for an enum or boolean.
- **`MoneyMath.tsx:12`** negates client-side, so a zero contractual becomes `-0`, and `Intl` prints `-$0.00` (I ran it). I was not given `lib/format`; check whether it guards this.
- **`MoneyMath.tsx:14`** uses `patient_est_cents` on finalised claims when `patient_resp_cents` exists. The comment on line 7 needs a test behind it.
- **Strictness is inconsistent.** `schema.ts:225-226` calls SSE deliberately not strict so an extra field cannot stall the panel, yet `schema.ts:272` derives `AdvanceSnapshot` from a strict schema, and strict REST schemas fail a whole screen on an additive field. API and web deploy separately (Fly, Vercel). Pick one posture and write an ADR.
- **`wire.test.ts:62`** says "every mutation" but never parses `RulePatchResponse`, `ProposalResponse` or `ClockReset`. It also calls `MockDb` directly, so handlers are untested.
- **`gen-api.mjs:15-17`** exits 0 when the snapshot is missing, and its message describes a hand-written `schema.ts` that no longer exists (also `:2-3`, `:28`). Fail hard, and add a drift check that regenerates and diffs. CLAUDE.md still says `/api/openapi.json`; report that.
- **`OutageBanner.tsx:3`** says failures are not turned into work for Dana; line 12 says steps come back to the Inbox. One is false.
- **`runEvents.ts:7`** claims applying an event twice is a no-op. A duplicate `running` step after `paused` flips the run to `running` (line 90; ranks tie at lines 19-20). Add the case to the reducer test, then fix it.

## 5. What I would keep

- `generated.ts` as the single source, with hand-written schemas limited to what OpenAPI cannot describe, each with its reason.
- The monotonic reducer and the `desynced` path. A `done` with no status refetches and never assumes success. That is the right instinct for agent software.
- `runViewOf` as the only constructor of `RunView`.
- The refusal to touch server numbers, and rejecting option B in call 8.
- `—` for an unknown CDT code: honest beats invented.
- `test/setup.ts`: the shim is small and its comment explains the real failure.
