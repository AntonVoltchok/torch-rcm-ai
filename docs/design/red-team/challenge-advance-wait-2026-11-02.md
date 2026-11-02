# Red team — `POST /clock/advance?wait=true` (hiring Director of Engineering persona) — 2026-11-02

Written as a red team by an independent subagent (Opus 5.5 high), static read only. Given the worker's position and reasoning, the brief's A7 text, the hard rules, and eight listed files (spec, route, service, scheduler runner, two test files, `useClock.ts`); not given the rest of the repo or the worker's other first-run findings.

Worker's check of this report, added afterwards: the claims about the unpublished failure branch, the stale `running` row and `CancelledError` were confirmed in code. The "false green" scenario in §2.2 did not hold: an advance yields to the event loop (1.3M loop ticks over one advance, longest gap 0.1s), so the `sleep(0)` it proposed was not needed. The CLI and e2e were grepped and do not send `wait`. `generated.ts` needs no regeneration: the generator reads only `components.schemas`, which did not change.

## 1. The strongest case against the position

B deletes the one path where failure is visible and leaves a buggy path as the only one. In `execute_advance` (runner.py:208-212), a failed advance stores `FAILED` but never publishes. The spec says the last `advance` event has `done: true`. `useAdvanceProgress` stops polling while the firehose is live (useClock.ts:36). So with SSE up, a failed advance spins forever and the failure toast (line 58) can't fire. `?wait=true` returned the failed snapshot directly, which hid this.

"Strengthens the tests" is only conditionally true. `done` is `state != "running"` (services/system.py:101), so a literal port of `done is True` passes on a failed advance. Only the tile assertion would catch it, and the SAMPLES site has no such assertion. A poll loop also adds a wall-clock deadline to a suite that had none.

Plan claims:
- **Wrong:** "poll at the three sites". `test_services` has no HTTP client, and `start_advance` needs a running loop, so that test needs an async body awaiting `scheduler.wait()`.
- **Wrong by omission:** SAMPLES is a generic parametrized test with no completion hook, so dropping `wait` there leaves a dangling task.
- **Understated:** the bypass isn't only the flag. Line 58 also hand-builds a `JSONResponse` and the route has no `response_model`, so removing the flag alone leaves the 202 unvalidated by the server.
- **Omitted:** `generated.ts` must be regenerated too.
- **Unconfirmed from these files:** that the CLI and e2e never send `wait`. `useClock.ts` shows `advanceClock({ to })` and describes 202, but `endpoints.ts` isn't listed. Grep before deleting.
- **Confirmed:** the spec states one shape; the docstrings make the "CLI, tests, e2e" claim; no HTTP test reaches completion over 202; a done poll carries `meta` (system.py:78), so the tile assertion ports.

## 2. The three most likely ways it fails

1. **Teardown race.** The fixture uses `with TestClient`, so the portal loop outlives each request. The task is not tied to the request and does run between requests, so polling works. But a task still running at exit gets cancelled. `CancelledError` escapes `except Exception`, the row stays `running`, and the store may close underneath it. Line 101 already does this, and SAMPLES would join it. The result is intermittent teardown noise on a "fully green" goal.

2. **False green.** `run_due` has no suspension point. Unless a handler truly suspends (the registry isn't listed, so this is unverified), a deterministic advance is one uninterrupted block on the event loop. SSE and GET would be starved for its duration, and the spec's per-handler progress would be stored but not streamed. The poll would see `done` on its first read, so the test claims coverage of the demo's path while proving nothing about progress. "The path users hit" also overclaims, because the fixture runs `start_worker=False`. `worker_loop` checks `locked()` without holding the lock, so an in-flight job can overlap an advance, and no test sees that.

3. **Contract misreading and client drift.** Every option changes a contract artefact: A edits the spec, B and C edit the snapshot. The brief anticipates a snapshot change and only asks for it to be reported, so the plan's stated risk is mostly a phantom. The practical risk is a stale `generated.ts`, or clobbering the dirty `apps/web/src/api/` files from the parallel session.

## 3. What I would change

- **Route:** use `response_model=AdvanceAccepted`, `status_code=202`, and drop `JSONResponse`, so the real path is server-validated.
- **Failure branch:** publish the terminal `advance` event with `done: true`. Test it with a forced `run_due` exception, asserting the firehose event plus GET `state: failed` and `error`. The spec's event has no `error` field, and a bare `done: true` could trigger the success toast (line 59). Check `useFirehose`; if the snapshot gets only event fields, refetch GET on `done` rather than widen the event. Route that to the web session.
- **Replace polling** with one helper: POST 202, then `client.portal.call(app.state.runtime.scheduler.wait)`, then one GET. No sleep, no deadline. Assert `state == "done"`, `error is None`, `now`, and the tiles.
- **Service test:** use an async body with `await rt.scheduler.wait()`, and keep every existing assertion, including the 422.
- **Fixture teardown:** call `scheduler.wait` so no test leaves a task behind.
- **Add one gated-handler test:** it proves `done: false` is observable, `409 advance_in_progress` fires, and `GET /clock` shows `advancing`. If it can't pass, add `await asyncio.sleep(0)` after `_progress`. That brings real reader/writer concurrency against the store, because the `def` routes run in the threadpool, so check `db/store.py`.
- **Stale `running` rows:** `begin_advance` treats a persisted row as a lock, and `queue.recover()` covers jobs only. In the listed files, a restart mid-advance means 409 on every advance until reset. Mark cancellation as failed and confirm boot clears the row (app code not listed). This predates the flag and affects both paths.
- **Record it:** ADR for the removal and the test helper. Report the snapshot diff exactly.

## 4. What I would keep and why

- **The removal.** One code path, the hard rule intact, and no held-open request lasting minutes in live mode.
- **The spec untouched.** A is the only option that edits the source of truth, and it carves an exception into a hard rule for a test convenience. That is the most literal "contract change" on the table.
- **Rejecting C.** A param hidden from OpenAPI, backed by no document, is exactly what a reviewer finds, and it fails "defensible under questioning".
- **The test rewrite in principle.** Moving SAMPLES to 202 plus `AdvanceAccepted` is tighter, not looser: it asserts the contract table instead of overriding it. Keep every number.

Recommendation: B-plus (remove the flag, publish the terminal failure event, and use deterministic wait-then-GET tests asserting `state`), because the spec and hard rule allow one shape, and the flag's removal is only honest once the async path reports failure.
