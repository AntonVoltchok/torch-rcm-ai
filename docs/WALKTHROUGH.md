# Walkthrough — what was built, what was decided, and why

_Written for the owner at the end of the first build pass (2026-11-01). Plain language; the technical detail is in `docs/spec/`, `docs/adr/` and the red-team reports._

## What Torch is, in one paragraph

Torch is a demo of software for the person at a dental office who chases insurance money. AI agents check patients' benefits, build and send claims, follow up with insurers, work denials and post payments. The billing coordinator (Dana) supervises through an **inbox of decisions**; the practice owner (Dr. Morgan) sets, in a readable table, exactly what the agents may do without a person. Everything the agents touch is a **simulated world** (a fake practice-management system, clearinghouse and five insurers with their real quirks) running on a **frozen clock** you can skip forward, so the demo is repeatable and never depends on the internet. With an API key, Claude actually reasons about ambiguous claims and drafts appeal letters; without one, the same runs happen from scripts, and they look identical on screen.

## What's in the repo

| Piece | Where | State |
|---|---|---|
| Product spec, data model, API, simulated world, seed, frontend plan, demo script, agent design | `docs/spec/00–07` | Done; the source of truth |
| Design history: mocks, wireframes, seven red-team reports, decisions log | `docs/design/` | Done |
| Architecture decisions | `docs/adr/0001–0003` + worker notes | Done |
| API: domain, document store, clock, world sims, scheduler, seed, read models, routers, OpenAPI | `apps/api/torch_rcm/` | Written; 391 pure tests pass; FastAPI/CLI paths not yet executed (see below) |
| Agent runtime: policy table, planners (scripted + live), executor recipes, run store, SSE, handlers, eval harness, cassettes, adversarial tests | `apps/api/torch_rcm/agents/` | Written; tested; `python -m torch_rcm.agents.eval` passes in both modes |
| Web app: shell, Inbox, Claims, Claim detail, Settings › Agents, static screens, mock layer, e2e | `apps/web/` | Written and reviewed; **never compiled** (no npm access in the build session) |
| Plumbing: Makefile, Docker, CI, Fly/Vercel configs, first-run guide | root, `infra/`, `docs/FIRST_RUN.md` | Done |

## The honest caveat

The build ran in a cloud session that could reach GitHub but not PyPI or the npm registry. So the Python side was verified with pure pytest only (391 tests, plus the eval harness), and the web side was parsed and partly type-checked against stubs but never compiled with the real libraries. `docs/FIRST_RUN.md` has the exact commands and a prompt to paste into Claude Code on your laptop; the hiring-manager red team estimated **20–35 hours** to get `make lint test e2e eval` green against the real API. That is the next session's job, and it is where you should be hands-on, because the onsite will test whether you own this code.

## Decisions made by red team (and why)

Every time a choice needed judgment, an independent agent playing the person most likely to be hurt by a wrong answer attacked the lean, and the recommendation was adopted. The full reports are in `docs/design/red-team/`; the one-line reasons:

1. **Home screen = inbox; Claims as the map; cross-linked** (billing lead). A coordinator has two jobs — "what do I do now" and "where is claim X" — and one screen that tries to do both is a kitchen sink.
2. **Autonomy = a tiered rules table** (practice owner). Tier 1 "talks to payers" can earn the right to run alone from Dana's approvals; tier 2 "touches the ledger or patients" needs the owner's signature on the rule; tier 3 "commits the practice" (write-offs, appeals, refunds, collections) is always a human. The owner's buying question is "what can this do to my money without a person?", and only a readable table answers it.
3. **Claims are built at checkout, not in a 4 PM batch** (billing lead). The only cheap moment to fix a claim is within the hour of checkout, and a biller must always see "what left" and "what's stuck".
4. **Denials are sorted by what happens next; reconsideration ≠ formal appeal** (appeals specialist). Most "appeals" are ten-minute resends that must never burn a real appeal level or a dentist's signature.
5. **Patients get a signed estimate; refunds are automatic, extra charges never are** (practice owner). The complaints that cost practices are about the surprise, not the balance.
6. **Agent architecture: the model proposes, code gates and executes** (staff AI engineer, who also corrected the doc's claims about the Anthropic API). Every money-touching action is a fixed, idempotent recipe; the model earns its place on ambiguous cases and free-text evidence.
7. **The Thursday inbox is 17, not the mocks' 16** (coordinator, ADR-0002). The number is computed from the seed; nothing is invented to hit a target.
8. **Repo review fixes** (hiring Director of Engineering persona): a real streaming bug, API↔web shape drift, a package named `torch` (now `torch_rcm`), Observe mode on approvals, missing claim transitions, an unhonored Idempotency-Key, a 230-line executor method, and docs that overclaimed codegen and SQLModel. All fixed; the review is saved with its ten onsite questions and the answers you should be able to give.

## What the agents do and don't do

- **Do**: read the simulated PMS, portal, IVR, clearinghouse and remittances through typed tools; classify the situation; propose one allowed action with evidence; in live mode, draft payer-facing text (which is then tier 2 and goes to the inbox for review).
- **Don't**: call any mutating tool; set their own confidence (it comes from base rates), tier, root cause or dollar amounts; run anything in Observe mode; auto-run a fix for a mistake that was ours; take tier-3 actions ever.
- **Code does**: decide via the policy table whether a proposal runs now, goes to the inbox, is only observed, or is refused; execute the recipe step by step with idempotency keys and checkpoints; build the audit line; stream progress; recover after a restart.

## How to run the demo (once the first run is green)

```bash
cp .env.example .env && make dev      # http://localhost:5173 as Dana
```
Then follow `docs/spec/06-demo-script.md`: approve the Delta group and watch the run stream; open claim #4821; click a strip tile and refresh to show URL-held filters; switch to Dr. Morgan, flip a rule and watch the live preview; accept a proposal and see the "root cause: ours" one refuse; skip the clock to Thursday morning and watch the overnight denials arrive.

## For the onsite

- **Defend**: build-at-checkout; the tiered table over per-agent dials; "model proposes, code gates".
- **Be ready to reconsider**: Denials as top-level nav (could be a saved view of Claims); `Partial` as a status (could be Paid + flag); the mock layer's size (could be fixtures only).
- **Say plainly**: what you decided, what the red teams changed, what was built by parallel Claude Code sessions you coordinated, and what you verified yourself on first run.
- The ten questions in `docs/design/red-team/challenge-repo-review-2026-11-01.md` are the ones to rehearse.
