/**
 * MSW adapter: HTTP in, MockDb call, HTTP out. One catch-all handler with a small route table, because
 * the API's `/{id}:verb` paths (`/inbox/itm_4821:approve`) collide with path-to-regexp's `:param` syntax.
 */
import { delay, http, HttpResponse } from 'msw'
import { API_BASE } from '@/env'
import { ActivityOutcome, AgentKind, ClaimStatus, PayerKey, RuleMode, type RulePatch } from '@/api/schema'
import { AgeBucket, SortParam } from '@/features/claims/search'
import { MockError, type MockDb, type SseRecord, type UserId } from './db'

type Ctx = { db: MockDb; url: URL; user: UserId; body: Record<string, unknown>; m: RegExpMatchArray; request: Request }
type Route = [method: string, pattern: RegExp, handle: (ctx: Ctx) => unknown]

const USERS: UserId[] = ['usr_dana', 'usr_morgan', 'usr_lee', 'usr_tasha']
const enc = new TextEncoder()
const frame = (r: SseRecord) => enc.encode(`id: ${r.id}\nevent: ${r.event}\ndata: ${JSON.stringify(r.data)}\n\n`)
/** What the API's route appends, with no ids, once it sees the run terminal (routers/system.py). */
const closing = (runId: string, status: string) =>
  enc.encode(`event: status\ndata: ${JSON.stringify({ status })}\n\nevent: done\ndata: ${JSON.stringify({ run_id: runId })}\n\n`)

const q = (url: URL, key: string) => url.searchParams.get(key)
const qa = (url: URL, key: string) => url.searchParams.getAll(key)
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback)
const int = (v: string | null) => (v === null || v === '' || !Number.isFinite(Number(v)) ? undefined : Math.round(Number(v)))

function rulePatch(body: Record<string, unknown>): RulePatch {
  const out: RulePatch = {}
  const mode = RuleMode.safeParse(body.mode)
  if (mode.success) out.mode = mode.data
  if (typeof body.max_cents === 'number') out.max_cents = body.max_cents
  if (typeof body.confidence_floor === 'number') out.confidence_floor = body.confidence_floor
  return out
}

function runEvents(db: MockDb, runId: string, lastEventId: number | null): Response {
  let unsubscribe = () => undefined as void
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sub = db.subscribeRun(runId, lastEventId, (rec) => {
        controller.enqueue(frame(rec))
        if (rec.event === 'done') {
          sub.unsubscribe()
          controller.enqueue(closing(runId, db.run(runId).run.status))
          controller.close()
        }
      })
      unsubscribe = sub.unsubscribe
      for (const rec of sub.replay) controller.enqueue(frame(rec))
      if (sub.terminal) {
        sub.unsubscribe()
        controller.enqueue(closing(runId, db.run(runId).run.status))
        controller.close()
      }
    },
    cancel() {
      unsubscribe()
    },
  })
  return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })
}

function firehose(db: MockDb): Response {
  let unsubscribe = () => undefined as void
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(': connected\n\n'))
      const off = db.subscribeFirehose((rec) => {
        controller.enqueue(frame(rec))
      })
      unsubscribe = () => {
        off()
      }
    },
    cancel() {
      unsubscribe()
    },
  })
  return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })
}

const ID = '([\\w-]+)'
const routes: Route[] = [
  ['GET', /^\/clock$/, ({ db }) => db.clock],
  ['POST', /^\/clock\/advance$/, ({ db, body, user }) => HttpResponse.json(db.advanceClock(str(body.to, db.now), user), { status: 202 })],
  ['GET', new RegExp(`^/clock/advance/${ID}$`), ({ db, m }) => db.advanceStatus(m[1] ?? '')],
  ['POST', /^\/clock\/reset$/, ({ db }) => {
    db.reset()
    return { scenario: 'canonical', now: db.now, meta: { counts: db.strip() } }
  }],
  ['GET', /^\/agents\/status$/, ({ db }) => db.agentsStatus()],
  ['POST', /^\/agents:pause$/, ({ db, user }) => db.pause(user)],
  ['POST', /^\/agents:resume$/, ({ db, user }) => db.resume(user)],
  ['GET', /^\/_world\/payers$/, () => []],
  ['GET', /^\/summary\/strip$/, ({ db, url, user }) => db.strip(q(url, 'location_id') ?? undefined, user)],

  ['GET', /^\/inbox$/, ({ db, url, user }) => db.inbox({ state: q(url, 'state'), kind: q(url, 'kind'), agent: q(url, 'agent') }, user)],
  ['POST', /^\/inbox:approve-group$/, ({ db, body, user }) => HttpResponse.json(db.approveGroup(str(body.group_key), user), { status: 202 })],
  ['GET', new RegExp(`^/inbox/${ID}$`), ({ db, m }) => db.inboxItem(m[1] ?? '')],
  ['POST', new RegExp(`^/inbox/${ID}:approve$`), ({ db, m, user }) => HttpResponse.json(db.approve(m[1] ?? '', user), { status: 202 })],
  ['POST', new RegExp(`^/inbox/${ID}:reject$`), ({ db, m, user, body }) => db.reject(m[1] ?? '', user, str(body.reason, 'no reason'))],
  ['POST', new RegExp(`^/inbox/${ID}:snooze$`), ({ db, m, user, body }) => db.snooze(m[1] ?? '', user, str(body.until, db.now))],
  ['POST', new RegExp(`^/inbox/${ID}:reopen$`), ({ db, m, user }) => db.reopen(m[1] ?? '', user)],
  ['POST', new RegExp(`^/inbox/${ID}:always-auto-run$`), ({ db, m, user }) => HttpResponse.json(db.alwaysAutoRun(m[1] ?? '', user), { status: 201 })],

  ['GET', /^\/claims$/, ({ db, url }) =>
    db.claims({
      status: qa(url, 'status').flatMap((s) => ClaimStatus.safeParse(s).data ?? []),
      needs_action: q(url, 'needs_action') === 'true',
      payer: PayerKey.safeParse(q(url, 'payer')).data,
      provider: q(url, 'provider') ?? undefined,
      age_bucket: AgeBucket.safeParse(q(url, 'age_bucket')).data,
      q: q(url, 'q') ?? undefined,
      sort: SortParam.safeParse(q(url, 'sort')).data,
      cursor: q(url, 'cursor'),
      limit: Number(q(url, 'limit') ?? 200),
      location_id: q(url, 'location_id'),
    })],
  ['GET', new RegExp(`^/claims/${ID}$`), ({ db, m }) => db.claim(m[1] ?? '')],
  ['POST', new RegExp(`^/claims/${ID}:triage$`), ({ db, m, user }) => HttpResponse.json(db.triage(m[1] ?? '', user), { status: 202 })],
  ['POST', new RegExp(`^/claims/${ID}:corrected$`), ({ db, m, user }) => db.corrected(m[1] ?? '', user)],
  ['GET', /^\/views$/, ({ db }) => db.views()],
  ['POST', /^\/views$/, ({ db, body, user }) => HttpResponse.json(db.saveView(str(body.name, 'Untitled'), (body.search_params ?? {}) as Record<string, unknown>, user), { status: 201 })],

  ['GET', /^\/runs\/stream$/, ({ db }) => firehose(db)],
  ['GET', new RegExp(`^/runs/${ID}/events$`), ({ db, m, request }) => {
    const last = request.headers.get('Last-Event-ID')
    return runEvents(db, m[1] ?? '', last === null ? null : Number(last))
  }],
  ['GET', new RegExp(`^/runs/${ID}$`), ({ db, m }) => db.run(m[1] ?? '')],

  ['GET', /^\/activity$/, ({ db, url, user }) =>
    db.activity({ day: q(url, 'day'), agent: AgentKind.safeParse(q(url, 'agent')).data ?? null, outcome: ActivityOutcome.safeParse(q(url, 'outcome')).data ?? null }, user)],
  ['GET', /^\/ledger\/today$/, ({ db }) => db.ledger()],
  ['GET', /^\/eligibility$/, ({ db, url }) => db.eligibility(q(url, 'date'))],
  ['GET', new RegExp(`^/eligibility/${ID}$`), ({ db, m }) => db.benefits(m[1] ?? '')],
  ['GET', /^\/cash$/, ({ db, user }) => db.cash(user)],
  ['GET', /^\/denials$/, ({ db, user }) => db.denials(user)],

  ['GET', /^\/rules$/, ({ db }) => db.rules()],
  ['GET', /^\/rules\/changes$/, ({ db }) => db.ruleChanges()],
  ['PATCH', new RegExp(`^/rules/${ID}$`), ({ db, m, body, user }) => db.patchRule(m[1] ?? '', rulePatch(body), user)],
  ['GET', /^\/settings\/preview$/, ({ db, url }) => db.preview(q(url, 'rule_id') ?? '', RuleMode.safeParse(q(url, 'mode')).data ?? null, int(q(url, 'max_cents')) ?? null)],
  ['PATCH', /^\/settings\/practice$/, ({ db, body, user }) => db.setPracticeCap(typeof body.practice_cap_cents === 'number' ? body.practice_cap_cents : -1, user)],
  ['GET', /^\/proposals$/, ({ db }) => db.proposals()],
  ['POST', new RegExp(`^/proposals/${ID}:accept$`), ({ db, m, user }) => db.acceptProposal(m[1] ?? '', user)],
  ['POST', new RegExp(`^/proposals/${ID}:dismiss$`), ({ db, m, user }) => db.dismissProposal(m[1] ?? '', user)],
]

/** Static-screen routes are registered separately so they can read fixtures lazily. */
export function makeHandlers(db: MockDb, extra: Route[] = []) {
  const table = [...extra, ...routes]
  return [
    http.all(`${API_BASE}/*`, async ({ request }) => {
      await delay(import.meta.env.MODE === 'test' ? 0 : 120)
      const url = new URL(request.url)
      const path = decodeURIComponent(url.pathname.slice(new URL(API_BASE).pathname.length))
      const header = request.headers.get('X-Torch-User')
      const user = USERS.find((u) => u === header) ?? 'usr_dana'
      for (const [method, pattern, handle] of table) {
        if (method !== request.method) continue
        const m = path.match(pattern)
        if (!m) continue
        const body = request.method === 'GET' ? {} : ((await request.json().catch(() => ({}))) as Record<string, unknown>)
        try {
          const out = handle({ db, url, user, body, m, request })
          return out instanceof Response ? out : HttpResponse.json(out as Record<string, unknown>)
        } catch (err) {
          if (err instanceof MockError) {
            return HttpResponse.json(
              { error: { code: err.code, message: err.message, details: err.details }, alternatives: err.alternatives },
              { status: err.status },
            )
          }
          throw err
        }
      }
      return HttpResponse.json({ error: { code: 'not_found', message: `${request.method} ${path} is not mocked` } }, { status: 404 })
    }),
  ]
}

export type { Route }
