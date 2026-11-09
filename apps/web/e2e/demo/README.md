# Demo e2e: who owns which step

`e2e/demo.spec.ts` is one Playwright test that calls these step functions in order, on one page. It is one test on purpose. The MSW db lives in the tab's sessionStorage, so state can't cross tests, files or browser contexts. A failure stops the story, as it did before the split. `test.step` still reports each step. Each file below has one owner, so parallel D1 sessions don't edit the same file. Only the coordinator edits `demo.spec.ts` (the order) and `shared.ts` (helpers).

| File                 | Steps   | Owner            | Starts from                                                     |
| -------------------- | ------- | ---------------- | --------------------------------------------------------------- |
| `01-inbox.ts`        | 1, 2, 3 | d1-inbox         | fresh demo, /inbox, Dana                                        |
| `02-claim-triage.ts` | 3b      | d1-claim-denials | Inbox after the group approve                                   |
| `03-run-to-claim.ts` | 4       | d1-inbox         | Claim #4744 after triage                                        |
| `04-claims-list.ts`  | 5       | d1-rest          | any page, Dana                                                  |
| `05-settings.ts`     | 6, 7    | d1-rest          | claims list, Dana; step 6 returns Dr. Morgan's badge for step 7 |
| `06-overnight.ts`    | 8       | d1-rest          | Dr. Morgan after step 7                                         |
| `07-activity.ts`     | 9       | d1-rest          | Thursday 7:10 AM, Dana                                          |
| `08-cash.ts`         | 10a     | d1-rest          | Thursday, Dana; leaves Dr. Morgan signed in                     |
| `09-denials.ts`      | 10b     | d1-claim-denials | Thursday, Dr. Morgan                                            |

The standalone specs are `../static-screens.spec.ts` (d1-rest) and `../reload-mid-run.spec.ts` (d1-inbox). Each starts from `freshDemo`.

Strip and badge assertions appear in steps 1, 3, 5 and 8. d1-shell may need to touch those lines while it keeps the "Claim pipeline" landmark and the badge test ids. If it changes them, it tells the coordinator.

If you change where your step leaves the page, check the next row's "Starts from".

Run the demo e2e with `pnpm e2e` (MSW). Run it against the real API with `E2E_TARGET=real E2E_API_BASE=… pnpm e2e --grep @demo`. To point it at your own server, set `E2E_BASE_URL`.
