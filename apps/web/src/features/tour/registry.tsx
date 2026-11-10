/**
 * Every tour, as data. Copy is ported from docs/design/onboarding/tour-src.html (owner-approved, red-teamed) with one
 * change: the mock's numbers were checked at build time against captured JSON, while here every count and amount is a
 * `Num` read from the live response, so the copy stays true after the tour's own Approve or the overnight.
 * Honest labels on recordings (now real API recordings, D21) and model-free approval runs are kept (DECISIONS D2, D3).
 */
import type { ReactNode } from 'react'
import { api } from '@/api/endpoints'
import { qk } from '@/api/queryKeys'
import { session } from '@/state/session'
import { clockLabel } from '@/lib/format'
import { useAgentsStatus } from '@/hooks/useAgents'
import { useDenials, useEligibility, useActivity } from '@/hooks/useStatic'
import { useRules } from '@/hooks/useRules'
import { findAnchor, hover } from './anchors'
import { FOLLOWED, useFollowedGroup, useFollowedItem, useLaunchChange, useNowLabel, useStripFacts } from './facts'
import { Num, Server } from './Num'
import type { CodeTab, Step, Tour, TourId, TryIt } from './types'

const P = ({ children }: { children: ReactNode }) => <p className="m-0">{children}</p>
const Note = ({ children }: { children: ReactNode }) => <p className="m-0 text-xs leading-normal text-soft">{children}</p>
/** The amber "said plainly" box: what the demo does not do, next to the step that might suggest it does. */
const Honest = ({ children }: { children: ReactNode }) => (
  <p className="m-0 rounded-r-md border-l-[3px] border-practice-ink bg-practice-bg px-2.5 py-1.5 text-xs leading-normal text-ink" data-honest="">
    {children}
  </p>
)
const C = ({ children }: { children: ReactNode }) => <code className="rounded border border-line bg-fill px-1 font-mono text-xs">{children}</code>
const K = ({ children }: { children: ReactNode }) => <kbd className="rounded border border-b-2 border-line-strong bg-paper px-1 font-mono text-[11px]">{children}</kbd>

const loc = () => session.locationParam()

/* ---------- code panes: live responses through the typed client, with the screen's own query keys ---------- */
const pane = {
  strip: (): CodeTab => ({ label: 'strip', source: 'GET /api/v1/summary/strip', kind: 'captured', load: { type: 'query', queryKey: qk.strip(loc()), queryFn: api.strip } }),
  moves: (): CodeTab => ({
    label: 'moves',
    source: 'GET /api/v1/summary/strip → moves, inbox_waiting',
    kind: 'captured',
    load: { type: 'query', queryKey: qk.strip(loc()), queryFn: api.strip, select: (d) => pick(d, 'moves', 'inbox_open', 'inbox_claims', 'inbox_visits', 'inbox_waiting') },
  }),
  clock: (): CodeTab => ({ label: 'clock', source: 'GET /api/v1/clock', kind: 'captured', load: { type: 'query', queryKey: qk.clock, queryFn: api.clock } }),
  item: (id: string = FOLLOWED.item): CodeTab => ({ label: `GET /inbox/${id}`, source: `GET /api/v1/inbox/${id}`, kind: 'captured', load: { type: 'query', queryKey: qk.inbox.item(id), queryFn: () => api.inboxItem(id) } }),
  evidence: (): CodeTab => ({
    label: 'evidence[]',
    source: `GET /api/v1/inbox/${FOLLOWED.item} → evidence`,
    kind: 'captured',
    load: { type: 'query', queryKey: qk.inbox.item(FOLLOWED.item), queryFn: () => api.inboxItem(FOLLOWED.item), select: (d) => pick(d, 'evidence_ids', 'evidence') },
  }),
  learnable: (): CodeTab => ({
    label: 'confidence · learnable',
    source: `GET /api/v1/inbox/${FOLLOWED.item} → stopped_by, confidence, learnable`,
    kind: 'captured',
    load: { type: 'query', queryKey: qk.inbox.item(FOLLOWED.item), queryFn: () => api.inboxItem(FOLLOWED.item), select: (d) => pick(d, 'root_cause', 'tier', 'stopped_by', 'confidence', 'learnable', 'action_label', 'touches', 'lands', 'hold_window') },
  }),
  inbox: (): CodeTab => ({ label: 'GET /inbox', source: 'GET /api/v1/inbox?state=open', kind: 'captured', load: { type: 'query', queryKey: qk.inbox.list({ state: 'open', location: loc() }), queryFn: () => api.inbox({ state: 'open' }) } }),
  claim: (id: string): CodeTab => ({ label: `GET /claims/${id}`, source: `GET /api/v1/claims/${id}`, kind: 'captured', load: { type: 'query', queryKey: qk.claim(id), queryFn: () => api.claim(id) } }),
  denials: (): CodeTab => ({ label: 'GET /denials', source: 'GET /api/v1/denials', kind: 'captured', load: { type: 'query', queryKey: qk.denials, queryFn: api.denials } }),
  ledger: (): CodeTab => ({ label: 'GET /ledger/today', source: 'GET /api/v1/ledger/today', kind: 'captured', load: { type: 'query', queryKey: qk.ledger, queryFn: api.ledger } }),
  eligibility: (): CodeTab => ({ label: 'GET /eligibility', source: 'GET /api/v1/eligibility', kind: 'captured', load: { type: 'query', queryKey: qk.eligibility({}), queryFn: () => api.eligibility({}) } }),
  activity: (): CodeTab => ({ label: 'GET /activity', source: 'GET /api/v1/activity', kind: 'captured', load: { type: 'query', queryKey: qk.activity({}), queryFn: () => api.activity({}) } }),
  cash: (): CodeTab => ({
    label: 'GET /cash',
    source: 'GET /api/v1/cash (owner only)',
    kind: 'captured',
    load: { type: 'query', queryKey: qk.cash(loc()), queryFn: api.cash, enabled: () => session.user().role === 'owner' },
  }),
  rules: (): CodeTab => ({ label: 'GET /rules', source: 'GET /api/v1/rules', kind: 'captured', load: { type: 'query', queryKey: qk.rules, queryFn: api.rules } }),
  proposals: (): CodeTab => ({ label: 'GET /proposals', source: 'GET /api/v1/proposals', kind: 'captured', load: { type: 'query', queryKey: qk.proposals, queryFn: api.proposals } }),
  run: (kind: 'approve_group' | 'triage'): CodeTab => ({ label: 'run + SSE', source: 'GET /api/v1/runs/{id} · GET /runs/{id}/events (SSE)', kind: 'cache', load: { type: 'run', kind } }),
  /** The claim the screen shows (a screen tour opened on /claims/<id> explains that claim, not #4821). */
  claimOnScreen: (field?: string): CodeTab => ({ label: field ?? 'GET /claims/{id}', source: `GET /api/v1/claims/{id}${field ? ` → ${field}` : ''}`, kind: 'captured', load: { type: 'claim-on-screen', ...(field ? { field } : {}) } }),
  file: (label: string, name: Parameters<typeof staticTab>[2], source: string, kind: CodeTab['kind'] = 'rendered'): CodeTab => staticTab(label, source, name, kind),
}
function staticTab(label: string, source: string, name: 'prompt_4821' | 'plan_4821' | 'tools' | 'policy' | 'guard' | 'recipe_resubmit' | 'case_4744' | 'plan_4744' | 'models' | 'router' | 'mockonly' | 'search', kind: CodeTab['kind']): CodeTab {
  return { label, source, kind, load: { type: 'static', name } }
}
function pick(d: unknown, ...keys: string[]): unknown {
  const o = d as Record<string, unknown>
  return Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]))
}

/* ---------- main tour ---------- */
const INBOX_4821 = { to: '/inbox', search: { item: FOLLOWED.item } }
/** Shown when the tour's own Approve (or the overnight after it) has taken the Delta group out of the Inbox. */
const APPROVED = 'Approved in this tour: the Delta group has left the Inbox. The finish offers the reset that brings it back.'

function Welcome() {
  const now = useNowLabel()
  const mode = useAgentsStatus().data?.mode
  const { s } = useStripFacts()
  return (
    <>
      <p className="m-0 max-w-[66ch] text-base leading-relaxed">
        TorchRCM is an agentic revenue-cycle demo for a dental practice. Agents work the claims pipeline. <b>Agents propose; the Policy layer decides whether anything runs</b>, and
        a person decides everything the practice’s rules hold back.
      </p>
      <p className="m-0 max-w-[66ch] text-base leading-relaxed">
        You see the app as <b>Dana S.</b>, the practice’s billing coordinator: the Inbox is her to-do list. <b>Dr. Morgan</b> is the dentist who owns the practice; the Cash
        screen and signing off on rule changes are his. Under <b>Demo controls</b> at the bottom of the sidebar you can switch who you are, skip the frozen clock ahead and
        reset the demo. Those controls are the demo’s, not the product’s.
      </p>
      <div className="grid grid-cols-3 gap-2">
        <Fact k="Clock" v={<Server t={now ? clockLabel(now) : undefined} />} m="frozen; the Skip button under Demo controls moves it" />
        <Fact k="Data" v="Canonical seed" m={<>
          <Num v={s?.open_count} /> open claims, generated from a fixed seed
        </>} />
        <Fact k="Agent mode" v={mode === undefined ? <Server t={undefined} /> : mode === 'live' ? 'Live' : 'Deterministic (default)'} m="no model calls by default; live mode sends the same cases to Claude. Parity is checked by replaying recorded API responses" />
      </div>
      <p className="m-0 max-w-[66ch] text-base leading-relaxed">
        The tour follows one claim, <b>K. Owens #4821</b>: Delta denied a crown because our own Claims agent attached a bitewing where Delta’s rule asks for a periapical. Every step
        has a <b>code pane</b>, open by default: the API response the screen rendered, or the real prompt, schema, policy table or recipe behind it, each labelled with where it came
        from.
      </p>
    </>
  )
}
function Fact({ k, v, m }: { k: string; v: ReactNode; m: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[9px] border border-line px-3 py-2">
      <span className="text-[11px] font-semibold text-soft">{k}</span>
      <span className="text-base font-semibold">{v}</span>
      <span className="text-xs text-mid">{m}</span>
    </div>
  )
}

const MAIN: Tour = {
  id: 'main',
  home: '/inbox',
  name: 'Main tour',
  blurb: 'One claim, K. Owens #4821, through the whole loop.',
  steps: [
    { id: 'welcome', modal: 'welcome', title: 'Welcome to TorchRCM', ey: 'Evaluator tour · a few minutes', body: Welcome },
    {
      id: 'clock',
      route: INBOX_4821,
      needs: 'followed-open',
      anchor: 'clock',
      ey: 'seed & clock',
      title: 'Where the data comes from',
      body: function B() {
        const now = useNowLabel()
        return (
          <>
            <P>
              Nothing here is live. <C>make seed</C> builds the practice from a fixed random seed and pins the named records the demo depends on, #4821 among them; everything else is
              generated so the totals reconcile.
            </P>
            <P>
              The clock is frozen at <Server t={now ? clockLabel(now) : undefined} />. No code reads wall-clock time. The “Skip to …” button under Demo controls runs the scheduler forward, and that
              is how the night’s payer traffic arrives (the last step).
            </P>
            <Note>Server money is integer cents. The UI formats it and never adds it up.</Note>
          </>
        )
      },
      code: [pane.clock(), pane.claim(FOLLOWED.claim)],
    },
    {
      id: 'strip',
      route: INBOX_4821,
      needs: 'followed-open',
      anchor: 'pipeline',
      ey: 'one status model',
      title: 'The pipeline: nine statuses, one source',
      body: function B() {
        const { s } = useStripFacts()
        return (
          <>
            <P>
              A claim has exactly <b>nine statuses</b>. “Needs action” (<Num v={s?.flagged_count} /> now) is a derived flag, not a tenth status. Every number here, the nav badges and the
              header comes from one endpoint, <C>GET /summary/strip</C>, or from <C>meta.counts</C> on a mutation, so two screens cannot disagree.
            </P>
            <P>
              Each status links to Claims, pre-filtered, and the filter lives in the URL (<C>/claims?status=denied</C>), so a refresh keeps it.
            </P>
          </>
        )
      },
      code: [pane.strip()],
    },
    {
      id: 'moves',
      route: INBOX_4821,
      needs: 'followed-open',
      anchor: 'whose-move',
      ey: 'whose move',
      title: 'Whose move it is, decided by the server',
      body: () => (
        <>
          <P>
            Every open claim is somewhere on a relay between <b>you</b> (amber), <b>the agents</b> (teal) and <b>the payer</b> (violet). The baton on each row and these cards are{' '}
            <C>ClaimSummary.move</C>, computed by one server function from runs, items, holds, file entries, rule modes and the clock.
          </P>
          <P>
            A payer is named only on evidence that the payer owes a reply, so unworked A/R cannot hide behind “Waiting on Delta”. <C>mine</C> is a server boolean; the browser never compares
            holders.
          </P>
        </>
      ),
      code: [pane.moves()],
    },
    {
      id: 'how',
      route: INBOX_4821,
      needs: 'followed-open',
      anchor: 'relay',
      missing: APPROVED,
      ey: '835 → router → agent',
      title: 'How #4821 got here',
      body: function B() {
        const g = useFollowedGroup()
        return (
          <>
            <P>
              Delta’s ERA denied the crown <b>CO-16 · N29</b>: pre-operative radiograph required. Other crowns came back the same way, so the Inbox <b>groups</b> them: one decision,{' '}
              <Num v={g?.count} /> claims, <Num v={g?.cents} as="money" />.
            </P>
            <P>
              The seed writes this morning’s item; the steps below re-run the code that would have built it. That code balances the 835 line, routes CARC·RARC to the Follow-up
              agent (<C>route_denial</C>, the same function the Denials worklist uses) and reads provenance: <b>our Claims agent attached a BWX</b> where Delta’s rule names a PA. That
              makes the root cause <b>“ours”</b>, and it stays ours.
            </P>
          </>
        )
      },
      code: [pane.item(), pane.file('router', 'router', 'domain/routing.py route_denial', 'source')],
    },
    {
      id: 'model',
      route: INBOX_4821,
      needs: 'followed-open',
      anchor: 'recommends',
      missing: `${APPROVED} The prompt and plan in the code pane do not depend on it.`,
      ey: 'the model’s input',
      title: 'What a model would see',
      body: () => (
        <>
          <P>
            In <b>live mode</b> a Follow-up run is one conversation: a static, cached system prompt (role, the closed list of actions, what it may not do, the untrusted-content contract),
            then a first user message, <b>CASE FACTS</b>, rendered by code. The code pane shows both, rendered from the seed by the real <C>render_case</C>.
          </P>
          <P>
            Root cause, deadlines and the classifier’s situation are <b>already computed</b> when the model sees them. Portal pages, transcripts and notes arrive wrapped as{' '}
            <C>{'<world_content trust="untrusted">'}</C>: data to read, never instructions.
          </P>
          <Honest>
            <b>In this demo no model ever sees #4821.</b> Its item is seeded, and the panes run the scripted planner on it. Live mode would send this situation to the model; its
            cassette (<C>cassettes/canonical/clm_4821_group.jsonl</C>) was recorded from the API with <C>torch cassette record</C>.
          </Honest>
        </>
      ),
      code: [
        pane.file('prompt', 'prompt_4821', 'prompts/followup.md · planner/live.py render_case'),
        pane.file('plan', 'plan_4821', 'ScriptedPlanner.plan · tools/schemas.py submit_plan'),
        pane.file('tools', 'tools', 'prompts.tools_for("followup", "plan")'),
        pane.file('models', 'models', 'llm/models.py · llm/client.py', 'source'),
      ],
    },
    {
      id: 'policy',
      route: INBOX_4821,
      needs: 'followed-open',
      anchor: 'why',
      missing: `${APPROVED} The policy table and its verdict are in the code pane.`,
      ey: 'policy, tier, track record',
      title: 'Code decides whether it runs',
      body: function B() {
        const c = useFollowedItem()?.confidence
        return (
          <>
            <P>
              The plan names an action, its parameters and the evidence it rests on. <b>No confidence, tier, root cause, amount or deadline</b>: the planner never emits those. The
              Policy layer walks its decision table top down; the first matching row wins.
            </P>
            <P>
              Run on this plan, <C>decide()</C> matches the rule “Missing PA x-ray → attach, resubmit”, set to <b>Ask</b>: a proposal for a person, which is what this Inbox item is.
              Track record: <Num v={c?.k} /> of <Num v={c?.n} /> {c?.outcome ?? '…'}, a seeded record on the rule, not a model’s guess.
            </P>
            <P>
              Were the rule on auto, another row would still stop it: <b>root cause “ours” can never be learned into running without review</b>.
            </P>
          </>
        )
      },
      code: [pane.file('ROWS + decide()', 'policy', 'agents/policy.py ROWS · decide() on #4821 and #4744'), pane.learnable(), pane.file('guard', 'guard', 'policy.py · learning.py', 'source')],
    },
    {
      id: 'decide',
      route: INBOX_4821,
      needs: 'followed-open',
      anchor: 'approve',
      missing: `${APPROVED} Its run is on the next step.`,
      ey: 'a person decides',
      title: 'Dana decides',
      body: () => (
        <>
          <P>
            The primary button (<K>⇧A</K>) takes the group; <b>Only #4821</b> (<K>A</K>), <b>Edit plan</b>, <b>Reject</b> and <b>Snooze</b> work on one item. “What this does” is the
            action catalog’s wording, the same text the run executes.
          </P>
          <P>Approve is idempotent per item (<C>Idempotency-Key</C>), so a double click or a retry cannot send twice.</P>
          <Note>Try it presses that same button. The tour has no approve of its own, so every rule and guard the button meets still applies.</Note>
        </>
      ),
      tryIt: {
        label: 'Try it · press the approve button',
        mutates: true,
        busy: 'Approving…',
        then: 'next',
        run: async (ctx) => {
          ctx.press('approve')
          await ctx.until(() => findAnchor('run-pane') !== null, 15_000, 'The run pane did not open. The app’s own message, if any, is on the decision panel.')
        },
      },
      code: [pane.file('recipe', 'recipe_resubmit', 'catalog/recipes.py · readmodels/wording.py', 'source'), pane.learnable()],
    },
    {
      id: 'run',
      route: { to: '/inbox' },
      anchor: 'run-pane',
      after: { step: 'decide', note: 'The run starts when Dana approves, and this step shows it. Press the approve button here, or go Back.' },
      missing: 'The run pane was closed. “Runs you started” in the Inbox opens it again.',
      ey: 'recipe → NEA → next file',
      title: 'The approval run',
      body: function B() {
        const inbox = useLaunchChange('approve_group', 'inbox')
        const denied = useLaunchChange('approve_group', 'tile.denied')
        return (
          <>
            <P>
              The pane opens at once and streams each step over <b>SSE</b>: gather the case, decide (a person approved), fetch the PA from imaging, upload to NEA, write the NEA# and
              original ICN into the claim remarks, queue for the next Delta file. A reload mid-run resumes from the stored events.
            </P>
            {inbox ? (
              <P>
                <b>What changed</b> is the server’s answer, not the browser’s arithmetic: your Inbox <Num v={inbox.before} /> → <Num v={inbox.after} />
                {denied && denied.before !== denied.after ? (
                  <>
                    , and Denied <Num v={denied.before} /> → <Num v={denied.after} />.
                  </>
                ) : denied ? (
                  <>
                    , and Denied stays <Num v={denied.after} />: the claims stay denied until Delta processes the resubmission.
                  </>
                ) : (
                  <>; Denied is unchanged, because the claims stay denied until Delta processes the resubmission.</>
                )}
              </P>
            ) : (
              <P>
                <b>What changed</b> is the server’s answer (<C>changes</C> on the approve response), not the browser’s arithmetic.
              </P>
            )}
            <Honest>
              An approval run <b>calls no model in either mode</b>: it replays the approved plan (<C>ApprovedPlanPlanner</C>). Its events say <C>planner: scripted</C> and the Investigate
              step reads nothing.
            </Honest>
          </>
        )
      },
      code: [pane.run('approve_group')],
    },
    {
      id: 'overnight',
      route: { to: '/inbox' },
      anchor: 'clock',
      ey: 'the scheduler',
      title: 'The loop closes overnight',
      body: function B() {
        const { s, tile } = useStripFacts()
        return (
          <>
            <P>
              The demo’s clock is frozen, so nothing happens on its own. <b>Try it</b> presses <b>⏭ Skip to …</b> under Demo controls at the bottom of the sidebar, which jumps
              the practice to the next morning.
            </P>
            <P>
              The skip plays out the night as it would at a real practice: today’s claim files go to the payers, the payers confirm they got them, overnight payment and denial files
              (835s) arrive, and <b>each new denial goes to the agent that handles its reason codes</b>. In the morning, agents check on claims still waiting for an answer.
            </P>
            <P>
              Before you press it: Dana has <Num v={s?.inbox_open} /> items in her Inbox and <Num v={tile('denied')} /> claims are denied. Watch the Inbox count in the sidebar
              and the Denied count at the top change.
            </P>
            <Note>
              Under the hood: the skip returns 202 at once and the scheduler works through every due event in simulated time. The code pane shows the clock, the pipeline counts
              and the denials list.
            </Note>
          </>
        )
      },
      tryIt: {
        label: 'Try it · Skip to the next morning',
        mutates: true,
        busy: 'Advancing…',
        then: 'stay',
        done: 'It is the next morning',
        doneAnchor: 'yours',
        run: async (ctx) => {
          const before = ctx.clockNow()
          if (!before) throw new Error('The clock has not loaded yet; try again in a moment.')
          // The control renders once the clock has loaded (a persona switch reloads it).
          await ctx.until(() => findAnchor('clock-advance') !== null, 10_000, 'The Skip control did not appear.')
          ctx.press('clock-advance')
          // The completion refetch can briefly empty the clock, so an empty clock is "not loaded", never "moved".
          await ctx.until(
            () => {
              const now = ctx.clockNow()
              return now !== undefined && now !== before && !ctx.clockAdvancing()
            },
            90_000,
            'The advance has not finished yet; the clock control shows its progress.',
          )
          await ctx.navigate('/inbox')
        },
      },
      code: [pane.clock(), pane.strip(), pane.denials()],
    },
    { id: 'finish', modal: 'finish', title: 'That is the loop', ey: 'Screen tours', body: Finish },
  ],
}

function Finish() {
  return (
    <p className="m-0 max-w-[66ch] text-base leading-relaxed">
      Seed data in; codes routed to an agent; facts computed by code; a plan; a verdict from policy; a person’s decision; a fixed recipe to the payer; remittances back overnight. Each
      screen has its own tour. It opens the first time you land on the screen, and <b>Tour this screen</b> in the sidebar or the <b>?</b> in a screen’s header restarts it.
    </p>
  )
}

/* ---------- screen tours ---------- */
const s = (id: string, title: string, anchor: string, body: Step['body'], code?: CodeTab[], extra: Partial<Step> = {}): Step => ({ id, title, anchor, body, ...(code ? { code } : {}), ...extra })

const INBOX: Tour = {
  home: '/inbox',
  id: 'inbox',
  name: 'Inbox',
  blurb: 'The queue, who the rest waits on, the decision panel, evidence, the guard, keys.',
  steps: [
    s('queue', 'Your queue', 'inbox-queue', () => (
      <>
        <P>
          Everything that needs <b>you</b>, oldest money first: claims, upcoming visits from Eligibility, and a group of like denials as one row with a count. The small baton on each row
          says where the claim goes next if you act (dashed).
        </P>
        <P>Below the rule: items waiting on someone else’s signature. They are in your list so you know, but not in your count.</P>
      </>
    ), [pane.inbox()]),
    s('header', 'Who the rest waits on', 'page-header', function B() {
      const { s: st } = useStripFacts()
      return (
        <>
          <P>
            The header is a server sentence built from counts: <Num v={st?.inbox_open} /> items need you, <Num v={st?.inbox_claims} /> claims and <Num v={st?.inbox_visits} /> visits. The
            nav badge is the same <C>strip.inbox_open</C>, as is the “Yours” card.
          </P>
          <P>Each item has one signer. A tier-2 rule change Dana proposes becomes Dr. Morgan’s sign-off item; a formal appeal is signed by the treating dentist.</P>
        </>
      )
    }, [pane.moves()]),
    s('decision', 'The decision panel', 'decision', () => (
      <>
        <P>
          Selecting a row puts it in the URL (<C>?item=…</C>), so refresh and the back button keep it. The headline and summary come from the code’s situation key, never from a live
          model’s wording, so both modes say the same thing.
        </P>
        <P>A red banner means <b>root cause: ours</b>. Red is reserved for money at risk and for “ours”.</P>
      </>
    ), [pane.item()], { route: INBOX_4821, needs: 'followed-open' }),
    s('touches', 'What this does, before you press it', 'touches', () => (
      <P>
        “What this does” (<C>touches</C>) and the baton under the button (<C>lands</C>) come from the action catalog with the item resolved, and a test checks that <C>lands</C> equals
        where the claim actually goes after the run. The line under it says how long the action can still be pulled: until the payer’s next file leaves.
      </P>
    ), [pane.file('recipe', 'recipe_resubmit', 'catalog/recipes.py · readmodels/wording.py', 'source')], { route: INBOX_4821, needs: 'followed-open' }),
    s('record', 'Track record, not a confidence score', 'track-record', function B() {
      const c = useFollowedItem()?.confidence
      return (
        <>
          <P>
            <Num v={c?.k} /> of <Num v={c?.n} /> {c?.outcome ?? '…'}: a seeded record on the rule. The server sends <C>k</C>, <C>n</C> and the outcome; a percent appears only when the sample is big enough. Nothing
            here is the model’s self-assessment.
          </P>
          <P>“Why it stopped at you” is the policy row that matched: the rule is set to Ask.</P>
        </>
      )
    }, [pane.learnable()], { route: INBOX_4821, needs: 'followed-open' }),
    s('evidence', 'What the agent read', 'evidence', () => (
      <P>
        Each evidence row is a captured object: the portal’s claim status, the 835 line decoded, the IVR transcript, the rep call with its reference number, the PMS imaging record. Each
        carries its source and capture time; world content is untrusted by default.
      </P>
    ), [pane.evidence()], { route: INBOX_4821, needs: 'followed-open' }),
    s('keys', 'Keys', 'inbox-actions', () => (
      <>
        <P>
          <K>j</K>/<K>k</K> move, <K>Enter</K> opens, <K>a</K> approves this one, <K>⇧A</K> the group, <K>e</K> edits, <K>r</K> rejects, <K>s</K> snoozes. One hook implements them for
          every list.
        </P>
        <P>
          While a run holds a claim, Approve, Reject and Snooze lock; the server enforces the same rule as <C>409 claim_busy</C>.
        </P>
      </>
    ), [pane.file('URL state', 'search', 'features/claims/search.ts', 'source')], { route: INBOX_4821, needs: 'followed-open' }),
  ],
}

const DENIALS: Tour = {
  home: '/denials',
  id: 'denials',
  name: 'Denials',
  blurb: 'Grouped by next action, deadlines, root cause, the payer × reason matrix.',
  steps: [
    s('summary', 'Denied claims, and whose move', 'denials-summary', function B() {
      const d = useDenials().data
      const { tile } = useStripFacts()
      return (
        <P>
          <Num v={d?.total} /> denied claims on the worklist; the strip’s Denied tile reads <Num v={tile('denied')} />. Both are server fields. The primary button opens the most urgent
          one.
        </P>
      )
    }, [pane.denials()]),
    s('groups', 'Grouped by what happens next', 'denials-worklist', () => (
      <>
        <P>
          Groups come from <C>route_denial</C>, the same function that sends a denial to an agent, so the worklist and the agents never disagree. <b>Reconsideration</b> means resend or
          inquire, no signature; a <b>formal appeal</b> needs the treating dentist’s signature.
        </P>
        <P>
          Inside a group, rows sort by deadline. Deadlines are typed (appeal, timely filing) with their basis, and “If lost” comes from the group code: CO is the practice’s loss, PR the
          patient’s.
        </P>
      </>
    ), [pane.file('router', 'router', 'domain/routing.py route_denial', 'source'), pane.denials()]),
    s('matrix', 'Payer × reason', 'denials-matrix', () => (
      <P>
        The worklist’s claims by payer and reason, so a pattern shows before it repeats. Plan limits (PR-*) are not denials to work and are counted separately. The matrix is a server
        field with an invariant test that recounts it by CARC.
      </P>
    ), [pane.denials()]),
  ],
}

const LEDGER: Tour = {
  home: '/ledger',
  id: 'ledger',
  name: 'Today’s claims',
  blurb: 'Built at checkout, per-payer files, acks, holds with their timely-filing clock.',
  steps: [
    s('summary', 'Today, by file', 'ledger-summary', () => (
      <P>
        Claims are built when the visit closes and leave in <b>per-payer files</b> through the day. Totals and files are server fields, each with a test that it equals its rows.
      </P>
    ), [pane.ledger()]),
    s('leaving', 'Leaving in the next file', 'ledger-leaving', () => (
      <P>
        Each claim lists its readiness checks. “Agent text” says whether the Claims agent wrote any narrative; a claim that carries one is <b>tier 2</b>, sent under a text rule Dr. Morgan
        signed. Editable until the file leaves; after that, the only fix is a void or a corrected claim.
      </P>
    ), [pane.ledger()]),
    s('sent', 'Sent today: three acknowledgments', 'ledger-sent', () => (
      <P>
        A claim is acknowledged three times: the file’s <b>999</b>, <b>Vyne’s 277CA</b>, then the <b>payer’s 277CA</b> (usually overnight). Until the payer answers, the move says it was
        sent and no reply has come yet.
      </P>
    ), [pane.ledger()]),
    s('held', 'Held, with the clock running', 'ledger-held', () => (
      <P>
        A hold is a claim that cannot be filed yet: no payer ID for a TPA, a secondary waiting for the primary’s EOB. Holds sort by <b>days left to timely filing</b> and cannot be
        snoozed.
      </P>
    ), [pane.ledger()]),
  ],
}

const CLAIMS: Tour = {
  home: '/claims',
  id: 'claims',
  name: 'Claims',
  blurb: 'Saved views, filters in the URL, whose move per row, age, keys.',
  steps: [
    s('views', 'Views and counts', 'claims-views', () => (
      <P>
        The counts beside each view are the strip’s numbers, and saved views are stored on the server (<C>/views</C>) so they follow you across devices.
      </P>
    ), [pane.strip()]),
    s('filters', 'The URL is the state', 'claims-filters', () => (
      <P>
        Payer, provider, age, status and search are search params validated with Zod in the route. Share the link, refresh, press back: same view. Sorting and filtering happen on the
        server; the table is virtualised.
      </P>
    ), [pane.file('search.ts', 'search', 'features/claims/search.ts', 'source')]),
    s('table', 'Whose move, per row', 'claims-table', () => (
      <>
        <P>
          Each row carries the server’s <C>move</C>: a payer is named only when it owes a reply; a write-off says who signs; a payer that has gone too long without paying is the
          practice’s problem again.
        </P>
        <P>
          Age is days since sent, coloured by bucket. <K>j</K>/<K>k</K> move between rows and <K>Enter</K> opens the claim.
        </P>
      </>
    ), [pane.strip()]),
  ],
}

const CLAIM: Tour = {
  home: '/claims/clm_4821',
  id: 'claim',
  name: 'Claim detail',
  blurb: 'The claim on screen by party, its open item; then a triage of #4744.',
  steps: [
    s('glance', 'The claim at a glance', 'claim-header', () => (
      <P>
        Status, whose move, billed, expected from the payer (an <b>estimate</b> from the contract, labelled so), and the deadline that matters now, with its basis.
      </P>
    ), [pane.claimOnScreen()]),
    s('history', 'History by party', 'history', () => (
      <>
        <P>
          Three lanes: Practice, Agents and the payer. Visit, built, accepted, denied, the agents’ checks, and now whose move it is. The dashed box is where it goes if you approve.
        </P>
        <P>An HTML grid, not an SVG: the text wraps, selects and reads in order for a screen reader.</P>
      </>
    ), [pane.claimOnScreen()]),
    s('open', 'The open item, and where to decide it', 'open-items', () => (
      <P>
        The same recommendation as the Inbox, with <b>Decide in Inbox</b> beside the primary. A review draft (agent-written text) has no send button here at all, so nobody sends text
        they did not read.
      </P>
    ), [pane.claimOnScreen('open_inbox_items')]),
    s('triage', 'An unknown case: #4744', 'triage', () => (
      <>
        <P>
          P. Hale #4744, MetLife. MetLife’s correspondence asks for an extraction date. There is no CARC, so the classifier returns <b>unknown</b>. <b>Ask Follow-up to look</b> starts
          a triage run (<C>POST /claims/clm_4744:triage</C>).
        </P>
        <P>This is one of the cases live mode leaves to the model: which reads to make and which action to propose. The second tab is the CASE FACTS it would receive.</P>
      </>
    ), [pane.claim(FOLLOWED.triage), pane.file('CASE FACTS', 'case_4744', 'planner/live.py render_case')], {
      route: { to: `/claims/${FOLLOWED.triage}` },
      needs: 'triage-ready',
      missing: 'Triaged in this tour: the run is on the next step.',
      tryIt: {
        label: 'Try it · Ask Follow-up to look',
        mutates: true,
        busy: 'Starting…',
        then: 'next',
        run: async (ctx) => {
          ctx.press('triage')
          await ctx.until(() => findAnchor('run-pane') !== null, 15_000, 'The run pane did not open. The app’s toast says why.')
        },
      },
    }),
    s('run', 'The triage run', 'run-pane', () => (
      <>
        <P>
          Gather the case, investigate (the reads it chose), decide, report. The policy verdict is <b>propose</b>: an unknown situation never runs without review, so the result is a new
          Inbox item, and its track record reads none: other situations’ history is not borrowed.
        </P>
        <Honest>
          Deterministic mode replays a plan written by hand (<C>recorded/clm_4744.plan.json</C>, labelled “hand-written plan, replayed”). Live mode replays a{' '}
          <b>recorded API response</b> instead (<C>synthetic: false</C>): it lands inside the same reviewed envelope, but it is not the same plan, and the pane shows both.
        </Honest>
      </>
    ), [pane.run('triage'), pane.file('recorded plan', 'plan_4744', 'planner/recorded/clm_4744.plan.json · cassette', 'recording'), pane.file('policy', 'policy', 'agents/policy.py decide()')], {
      route: { to: `/claims/${FOLLOWED.triage}` },
      after: { step: 'triage', note: 'The run starts when someone asks Follow-up to look, and this step shows it. Press the button here, or go Back.' },
      missing: 'The run pane was closed. The claim’s History shows what the run did.',
    }),
  ],
}

const mockOnly = (id: TourId, name: string, to: string, blurb: string, extra: ReactNode): Tour => ({
  id,
  home: to,
  name,
  blurb,
  steps: [
    s('banner', 'Designed, not built in this demo', 'mock-banner', () => (
      <>
        <P>
          {name} is a <b>mock-only route</b>. The rule is <b>no dead links</b>: every sidebar entry either does the thing, reads real seed data, or shows its reviewed design under this
          banner. <C>MockOnlyBanner</C> frames the design page at the matching screen.
        </P>
        <P>{extra}</P>
      </>
    ), [pane.file('MockOnlyBanner', 'mockonly', 'components/MockOnlyBanner.tsx · shell/nav.ts', 'source')], { route: { to } }),
  ],
})

const ELIGIBILITY: Tour = {
  home: '/eligibility',
  id: 'eligibility',
  name: 'Eligibility',
  blurb: 'Upcoming visits verified, the human-look flags, a benefits card.',
  steps: [
    s('summary', 'Upcoming visits, verified', 'eligibility-summary', function B() {
      const e = useEligibility({}).data
      return (
        <P>
          The Eligibility agent verifies the next visits and re-checks the morning of: <Num v={e?.total} /> appointments, <Num v={e?.need_human} /> of them flagged for a human look.
          Flagged visits also come to the Inbox as items.
        </P>
      )
    }, [pane.eligibility()]),
    s('table', 'A flag with its reason', 'eligibility-table', () => (
      <P>
        Each flagged row says why: a plan maximum that will not cover the planned work, a frequency limit, coverage that ended. Selecting a row puts it in the URL (<C>?appt=…</C>).
      </P>
    ), [pane.eligibility()]),
    s('benefits', 'The benefits card', 'benefits', () => (
      <>
        <P>
          Annual max, deductible, coinsurance by class, frequency limits with the last date done, and the planned work split into insurance and patient estimates. Each figure says where
          and when it was verified.
        </P>
        <P>The agent flags; the front desk decides. Contacting the patient is not an action any agent has.</P>
      </>
    ), [pane.eligibility()], {
      route: { to: '/eligibility' },
      searchFrom: async (qc) => {
        const e = await qc.fetchQuery({ queryKey: qk.eligibility({}), queryFn: () => api.eligibility({}) })
        const flagged = e.rows.find((r) => r.status === 'issue') ?? e.rows[0]
        return flagged ? { appt: flagged.appointment_id } : {}
      },
      missing: 'The card opens on the first appointment that needs a human look; none does in the demo’s current state.',
    }),
  ],
}

const ACTIVITY: Tour = {
  home: '/activity',
  id: 'activity',
  name: 'Activity',
  blurb: 'What agents did this week, filters in the URL, the Observe preview.',
  steps: [
    s('summary', 'This week, in numbers', 'activity-summary', function B() {
      const a = useActivity({}).data?.summary
      return (
        <P>
          <Num v={a?.ran_without_you} /> of <Num v={a?.decisions} /> decisions ran without you; <Num v={a?.awaiting_you} /> await you. Status checks and payer calls are counted
          separately: they are routine runs, not decisions. “This week” is the practice week from Monday, everywhere in the app.
        </P>
      )
    }, [pane.activity()]),
    s('rows', 'Every run, with its tier', 'activity-table', () => (
      <P>
        Each row is a run: agent, what it did, the claim, whose move it is now, the outcome. Agent-written text that goes to a payer is <b>T2</b>: it runs only under a text rule the owner
        signed, and only after a text guard passed.
      </P>
    ), [pane.activity()]),
    s('filters', 'Filters, and the Observe preview', 'activity-filters', () => (
      <>
        <P>Day, agent and outcome are URL params, like every list.</P>
        <P>
          A new practice starts in <b>Observe</b>: agents record what they <i>would</i> have run and do nothing, not even contact a payer. The Observe toggle restyles the week as Observe
          would have logged it.
        </P>
      </>
    ), [pane.activity()]),
  ],
}

const CASH: Tour = {
  home: '/cash',
  id: 'cash',
  name: 'Cash',
  blurb: 'Owner KPIs with formula and basis, aging, write-offs, agent impact as an estimate.',
  steps: [
    s('kpis', 'Owner only', 'cash-kpis', () => (
      <>
        <P>
          Cash is Dr. Morgan’s screen. The same request as Dana returns <b>403</b>: the role guard is on the server, not only in the nav.
        </P>
        <P>
          Every KPI has an <b>ƒ</b> that shows its formula, and a basis line under the value.
        </P>
      </>
    ), [pane.cash()]),
    s('impact', 'Agent impact, marked as an estimate', 'agent-impact', () => (
      <P>
        Hours saved is <b>labelled an estimate</b>, with its formula and where its per-item minutes come from. Appeals won are counts from the record, not a projection.
      </P>
    ), [pane.cash()]),
    s('writeoffs', 'Write-offs by type', 'writeoffs', () => (
      <P>
        Agents can <b>propose</b> a write-off; they never post one: tier 3 is human-only, and there is no code path that automates it.
      </P>
    ), [pane.cash()]),
    s('table', 'Every KPI: value, formula, basis', 'kpi-table', () => <P>The table lists each number with its formula and its basis, so the owner (or an auditor) can rebuild it by hand.</P>, [pane.cash()]),
  ],
}

const SETTINGS: Tour = {
  home: '/settings/agents',
  id: 'settings',
  name: 'Settings › Agents',
  blurb: 'Rules by tier, the live preview, proposals and the guard, the cap.',
  steps: [
    s('rules', 'Rules, grouped by what they touch', 'rules-table', function B() {
      const r = useRules().data
      return (
        <>
          <P>
            <Num v={r?.rules_count} /> rules in three tiers. <b>Tier 1 talks to payers</b> and can learn to run without review where an outcome metric exists. <b>Tier 2</b> touches the
            ledger or patients, under a rule Dr. Morgan signed. <b>Tier 3</b> commits the practice: a person, always, with no control at all.
          </P>
          <P>
            Modes: <b>Observe</b> records and does nothing; <b>Ask</b> proposes to the Inbox; <b>Runs without review</b> executes inside the rule’s caps. Hovering a mode previews it;
            clicking commits it.
          </P>
        </>
      )
    }, [pane.rules()]),
    s('preview', 'The live preview', 'preview', () => (
      <P>
        “What if this rule ran without review?” The server replays this week’s decisions under the hovered mode and says how many would have run, and how many the root-cause guard
        would still hold for a person.
      </P>
    ), [pane.rules()], {
      tryIt: {
        label: 'Try it · hover Status check → Runs without review',
        busy: 'Previewing…',
        then: 'stay',
        done: 'Previewed. Nothing was changed: hovering never commits.',
        doneAnchor: 'preview',
        run: async (ctx) => {
          const radio = document.querySelector('[data-rule="rule_t1_status_check"] [data-mode="auto"]')
          if (!radio) throw new Error('The status-check rule is not in the table.')
          hover(radio)
          await ctx.until(() => document.querySelector('[data-testid="preview-numbers"]') !== null, 10_000, 'The preview did not answer.')
        },
      },
    }),
    s('cap', 'The practice cap', 'practice-cap', function B() {
      const r = useRules().data
      return (
        <P>
          <Num v={r?.practice_cap_cents} as="money" /> per item for tier 2, set by Dr. Morgan; tier 1 is exempt. A rule can set its own lower cap, and Preview shows the effect before
          Apply.
        </P>
      )
    }, [pane.rules()]),
    s('proposals', 'Proposals, and the guard', 'settings-tabs', () => (
      <>
        <P>
          <b>Proposals</b> are rules learned from outcomes: “you approved k of n like these; m were paid”. Accept creates a learned tier-1 rule that runs without review.
        </P>
        <P>
          Where our own agent caused the denial, <b>Accept is disabled</b> with the reason, the server refuses it too (422), and a test pins the guard: root cause “ours” can never be
          learned into running without review.
        </P>
      </>
    ), [pane.proposals(), pane.file('guard', 'guard', 'policy.py · learning.py', 'source')]),
  ],
}

/**
 * The demo's own Reset button (under Demo controls, for every persona). The finish offers it; a step whose `needs` the
 * practice has lost runs it before it is drawn.
 */
export const RESET_DEMO: TryIt = {
  label: 'Reset demo to the seed',
  busy: 'Resetting…',
  then: 'stay',
  done: 'Reset: the practice is back at the seed',
  run: async (ctx) => {
    await ctx.until(() => findAnchor('reset-demo') !== null, 10_000, 'The Reset demo control did not appear.')
    ctx.press('reset-demo')
    await ctx.until(() => ctx.pressSettled() && ctx.clockNow() !== undefined, 30_000, 'The reset has not finished yet; the clock control shows it.')
  },
}

export const TOURS: Record<TourId, Tour> = {
  main: MAIN,
  inbox: INBOX,
  denials: DENIALS,
  ledger: LEDGER,
  claims: CLAIMS,
  claim: CLAIM,
  payments: mockOnly('payments', 'Payments', '/payments', 'Designed, not built: why, and what the banner promises.', 'Payment posting itself is real in the API: the Posting agent posts balanced ERA lines and holds variances (Cash and the Inbox show both). This screen is the deposit-matching workbench that was designed and left out of the build.'),
  patients: mockOnly('patients', 'Patients', '/patients', 'Design-only; the balances API it would read already exists.', 'The data it would read is already served: GET /patients/balances feeds Cash › Patient A/R. Patient-facing text an agent writes would be tier 2 and go through the Inbox as a review draft.'),
  eligibility: ELIGIBILITY,
  activity: ACTIVITY,
  cash: CASH,
  settings: SETTINGS,
}

/** Screen tours in sidebar order, then claim detail. */
export const SCREEN_TOURS: readonly TourId[] = ['inbox', 'denials', 'ledger', 'claims', 'claim', 'payments', 'patients', 'eligibility', 'activity', 'cash', 'settings']
