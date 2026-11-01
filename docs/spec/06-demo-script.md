# Demo script (the first ten minutes) and acceptance criteria

Run against the canonical seed with the clock at Wed 10/28 10:40. Every step below is also a Playwright e2e test (`apps/web/e2e/demo.spec.ts`).

## Script

1. **Open Torch as Dana.** Inbox shows **12** open items; strip reads Sent 5 · Rejected 2 · Accepted 24 · Pending 57 · Denied 5 · Partial 5 · Appealed 3 · Paid Oct 118 · $61,300. Sidebar shows "5 agents · 1 running".
2. **Open the Delta group** "missing PA x-ray (3) · $3,730". Selected item #4821: recommendation, "why 92% — 23 of 25 paid within 30 d", three evidence cards (portal status, PMS imaging record showing the PA from 10/12, the 835 denial line CO-16·N29 decoded), the audit note "root cause: ours — Claims agent attached BWX; rule updated 10/26".
3. **Press `shift+a` (Approve 3).** Items leave the list optimistically; the ProgressPanel opens and streams: fetch PA from PMS imaging → upload to NEA (NEA# appears) → write NEA# to remarks → queue for 11:15 Delta file → done, audit line. Inbox badge → **9**; Activity gains three rows; strip Denied stays 5 (claims are denied-in-flight until the payer reprocesses).
4. **Click "Open claim #4821 →".** Timeline shows the whole story newest-last; the open-inbox-items panel at the top is now empty with "resubmit queued · leaves 11:15". Breadcrumb "‹ Inbox".
5. **Click the strip tile "Denied 5".** `/claims?status=denied` — table pre-filtered, URL shows it. **Refresh the page** — filter survives. `j/k` through rows; `enter` opens Webb; back.
6. **Settings › Agents (switch user to Dr. Morgan).** Tiered table; flip "Status check" from Ask to Runs without review → preview updates "41 → 44 of 53 would have run" live. Open **Proposals**: accept "Delta missing-PA resubmits < $2,000" (tier 1, 23/25 paid) → a new rule row appears with "signed by Dana · outcome paid ≤ 30 d"; the sibling proposal with `root_cause: ours` has Accept disabled with the reason.
7. **Flip a tier-2 rule** (post ERA line) → "Needs Dr. Morgan" — as Morgan it applies and writes a Changes row; switch back to Dana and try the same → 409 → "Sent to Dr. Morgan for sign-off", inbox badge for Morgan bumps.
8. **Sidebar clock: "⏭ Skip to Thu 7:10 AM".** Scheduler runs: 11:15 file leaves (Owens group `sent`), Vyne 277CA A1, overnight 835s arrive (Ito CO-50·N10, Moreno CO-22, Morris CO-29 → new inbox items; Castillo records request), status checks fire. Inbox reads 15; Activity shows the night's runs; strip Denied → 9.
9. **Activity** → filter agent = followup → rows with evidence (IVR transcript, call reference). Toggle "Observe mode preview" → rows styled "would have run".
10. **Cash (as Morgan)**: days in A/R 27 with its formula; write-offs by type; agent impact with "estimate" basis. **Denials**: worklist grouped by next action; Ito shows "formal appeal · Dr. Lee signs · ERISA patient authorization required"; the workbench route shows the design with the mock-only banner.

## Acceptance criteria (the demo is "believable" when…)

- Every number on screen can be traced to seed data or a computation with a visible basis; no two screens disagree.
- No button leads nowhere: interactive → does the thing; static → shows real seed data; mock-only → banner + design.
- Agent runs stream step by step, produce real evidence objects, and write an audit line; a failed step produces a new inbox item (the `portal_outage` scenario demonstrates this).
- Reloading mid-run resumes the stream; killing the API mid-run and restarting it resumes from the stored run.
- All invariants in `01-domain-model.md` pass as tests after seed, after the demo script, and after `clock/advance` to Friday.
- Deterministic mode (`TORCH_AGENT_MODE=deterministic`) produces the identical demo without an API key; `live` mode (Claude API) produces equivalent runs with model-written narratives/explanations, within the same tool and tier constraints.
- `docker compose up` or `make dev` on a clean laptop yields the above in under 3 minutes.
