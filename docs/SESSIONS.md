# Working in parallel Claude Code sessions

The owner wants to be hands-off. A **coordinator session** (Fable 5.1) plans, splits work, spawns **nested worker sessions**, reviews their output, and makes decisions by red team rather than by asking the owner. This file is the operating manual for that.

## Model choice per nested session

| Work | Model | Effort | Why |
|---|---|---|---|
| Coordinator: planning, splitting, integration review, red-team adjudication, writing ADRs/STATUS | **Fable 5.1** | default | Needs the whole context and judgment across workers |
| Agent runtime (`torch/agents/*`), Policy table, scheduler/leases, SQLite concurrency | **Opus 5.5** | **high** | Correctness-critical, many invariants, subtle async |
| World simulation + payer rules + seed generator (reconciled numbers must hold) | **Opus 5.5** | **high** | Numeric consistency across ~400 claims; easy to get subtly wrong |
| Web app architecture (router, query, SSE hook, table virtualization) | **Opus 5.5** | **high** | State-ownership decisions are what the interviewer will probe |
| Individual screens once the architecture exists (Activity, Eligibility, Cash, Denials list) | Opus 5.5 | medium | Pattern-following; the hard choices are made |
| Red teams (`/challenge --red-team`) | Opus 5.5 | high | Needs to find real failure modes, verify facts, cite sources |
| Mechanical passes (codegen plumbing, lint fixes, copying mock data into fixtures, docstrings) | Sonnet 5.5 | — | Fast and cheap; low judgment |
| Final interviewer-persona review of the whole repo | **Fable 5.1** or Opus 5.5 high | — | Breadth + judgment |

Rule of thumb: if the worker will make a decision that an interviewer could ask "why?" about, use Opus 5.5 high (or Fable). If the worker is executing a decision already written down, Sonnet is fine.

## Work breakdown (dependency order)

```text
S0 contracts (done): docs/spec/00–07, ADR-0001
S1 ─┬─ api-core      domain models, DB, migrations, OpenAPI, clock, /summary, /claims, /inbox reads   ─┐
    ├─ world+seed    world adapters, payer sims, scheduler jobs, canonical seed + invariant tests      ─┤
    ├─ agents        policy, planner (scripted + live), executor recipes, run store, SSE, cassettes    ─┤  parallel, each in its own session
    └─ web-shell     router, layout, query client, codegen, Inbox + Claim detail + Claims table        ─┘
S2 ─┬─ settings      /rules, /proposals, /settings/preview + Settings screen (needs api-core+agents)
    ├─ ledger+static Today's claims, Activity, Eligibility, Cash, Denials list (needs world+seed)
    └─ e2e           Playwright demo script, make eval, CI
S3 ─── polish        empty/error/outage states, keyboard, perf scenario, README demo video/GIF, interviewer review
```

Workers touch only their own package paths; shared changes (OpenAPI) go through the coordinator. `make gen-api` after any API change; the web worker codes against the OpenAPI stub committed in `apps/api/openapi.snapshot.json` until the API is live.

## Session protocol

**Coordinator start of day**
1. `git pull`, read `docs/STATUS.md`, run `make lint test`.
2. Update the task list; pick ready items from the breakdown.
3. Spawn workers with a brief that contains: goal, the spec sections that bind them, the paths they own, the done-criteria (tests + STATUS line), and "don't ask the owner; red-team instead".

**Worker brief template**
```text
You are building <component> for Torch. Read CLAUDE.md, docs/spec/<relevant>.md and docs/adr/*.
You own: <paths>. Do not edit other paths; if a contract must change, write the proposed change in docs/plans/<topic>.md and stop.
Done means: <behaviour>; tests in <path> pass; `make lint test` green; one STATUS.md line.
Decisions: if you hit a judgment call, write options + your lean in docs/plans/<topic>.md, run /challenge --red-team with the persona in "Deciding without the user", adopt the result, record docs/adr/NNNN-<slug>.md.
Commit on your branch `work/<component>`; do not push to main.
Reply with: what shipped, what's left, anything blocking.
```

**Coordinator end of day**
1. Review each worker branch (`git diff main...work/x`), run tests, merge to main in dependency order.
2. Run `/challenge --red-team` on anything that changed a contract.
3. Update `docs/STATUS.md` and the decision log (`docs/design/decisions-log.md` → "Build decisions" table).

## Deciding without the user

When a decision needs judgment the owner would normally supply, do not block. Use the red-team pattern that produced this design:

1. Write the question, the options (A/B/C, hybrids allowed) and your lean in `docs/plans/<topic>.md`.
2. Spawn an independent red team (Opus 5.5 high) with a **persona that would be hurt by a wrong answer**:
   - billing workflow → dental billing lead
   - autonomy / trust / money → practice owner-dentist
   - denials/appeals → appeals specialist with payer-side experience
   - patient billing → owner who has had a complaint
   - agent/LLM architecture → staff engineer who shipped production agents on the Anthropic API (and verifies API facts against docs)
   - front-end architecture → the hiring Director of Engineering (TanStack-literate)
3. Adopt the top recommendation (hybrids allowed). Record it as an ADR with the one reason that carried, and append a row to the decisions log.
4. If the red team's recommendation contradicts a hard rule in CLAUDE.md, the hard rule wins; note the tension in the ADR.

Save every red-team report to `docs/design/red-team/challenge-<topic>-<date>.md` with a two-line header saying what it was given and not given.

## The final walkthrough the owner will receive

At the end of the build, the coordinator writes `docs/WALKTHROUGH.md` in plain language: what was built, every red-team decision and why, what the agents do and don't do, how to run the demo, and what to say in the onsite about each decision (defend / would reconsider).
