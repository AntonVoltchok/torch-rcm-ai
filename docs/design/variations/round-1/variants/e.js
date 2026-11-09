/* Variation E: Run log.

   DESIGN PLAN

   The back office already had a log before software did: the pegboard day sheet, eye-ease ledger green,
   filled in blue-black, with the totals under a double rule at the foot. Corrections went through a sheet
   of carbon. So the stream is a day sheet, and a decision is a sheet of carbon laid over it: the one dark,
   saturated thing in a pale room. Nothing here is a terminal.

   Palette
     sheet    #DDEBD6  ledger green, the page
     band     #D2E3CB  every other row, and the totals foot
     ink      #13233F  blue-black ledger ink, all text
     ink2     #3A4F5E  quiet text, 6:1 on band
     pine     #0A6651  agents, and only agents
     red      #B4231C  money at risk and "root cause: ours", the bookkeeper's red pen
     carbon   #1A2472  carbon-paper ultramarine, the prompt
     canary   #FFD94A  the one filled control. Means "you act here". Used for nothing else.
     On carbon, agent becomes mint #A5EBD2 and money becomes coral #FFB9AD.

   Type
     Besley (a Clarendon, the face of bank forms and supply catalogues) speaks only when something asks you
     a question: the prompt's question, the wordmark, and the numbers in the after-state.
     Atkinson Hyperlegible Next does everything else. It was drawn so similar glyphs cannot be confused,
     which is a real need when U48213307 and U48213370 are the whole dispute on #4851.
     No monospace: tabular figures carry the time column. Scale 13 / 15 / 18 / 22 / 28.

   Layout (1440x900, nothing boxed; bands instead of borders)

     Torch  Log 12  Denials 5  Claims   Agents ran 41 of 53 alone...       Dana | Dr. Morgan   Wed 10/28
     ------------------------------------------------------------------------------------------------
     9:24 AM   Claims     Checked and queued 7 claims                    7 claims        Sent 5, Queued 2
     10:32 AM  Follow-up  Sent records through NEA on 3 claims           3 claims        Records sent
     10:39 AM  Claims     Buildup narrative drafted...                   K. Owens #4859  Queued for file
     10:40 AM  Now        5 agents on shift, 1 running                     <- anchored to the bottom
     [J. Webb #4733] [F. Diaz +2] [T. Brooks #4705] ...                 [Dr. Morgan signs R. Diaz #4611]
     ################################################################################################
     # Appeals stopped at 6:40 AM on J. Webb #4733                                                  #
     # Delta mixed up two teeth and denied        | These words go to Delta   | What it read        #
     # [ Allow once   Send this note to Delta  A ]| sentence, sentence, cited | real excerpts       #
     #   Always allow   not offered, and why      |                           |                     #
     #   Deny                                     |                           |                     #
     ################################################################################################
     ================================================================================================
     Ready 6  Sent 5  Rejected 2 1  Accepted 24  Pending 57  Denied 5 5 ...   107 open, $75,500 A/R

   The one memorable thing: the sheet of carbon coming up from the foot of the page and stopping the log.
   Allow it and the carbon lifts, the run prints line by line where the carbon was, and the log keeps going.

   Review against "would this look the same for any B2B product?": the first pass was a right-hand rail of
   prompts beside a log, which is a master-detail with new names. Replaced by tabs on the carbon's top edge
   (chart-folder end tabs), so the log keeps the full width of a day sheet and the prompt reads as one object.

   Note on data: the log reads s.activity, the rows beneath s.activityGrouped, and groups by kind within a day.
   Adjacent-only grouping leaves today's readiness checks split across three lines and loses each claim's time.

   Note on state: the kit clears s.run on `next`, but a log must keep what happened, so finished runs are kept
   here per mount. s.filter is the kit's one free string slot, and this variation has no filter tabs, so it
   carries which log row is open and which denial the prompt is on.
*/
(function () {
  /* Per-mount memory. The autoOpen getter below runs exactly once per createApp, before the first render. */
  let entries = [] // {kind:'run',run,rule} | {kind:'deny',id,text}
  let known = {}
  let lastOpen = null
  let lastPromptKey = null
  let promptDrawn = false

  const AGENT_LINE = /^(claims|followup|appeals|posting|eligibility)$/

  const dots = (t) => String(t ?? '').replace(/\s·\s/g, ', ').replace(/\s—\s/g, ': ')
  const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t)
  const stripEnd = (t) => String(t).replace(/\.$/, '')
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`

  const ICON = {
    check: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2.5 8.5 6.2 12 13.5 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square"/></svg>',
    cross: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 3l10 10M13 3 3 13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"/></svg>',
    flag: '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M2 1v10h1.4V7h6.6L8 4l2-3H2z" fill="currentColor"/></svg>',
    chev: '<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M3 1.5 7 5 3 8.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  }

  const EV_KIND = { era_line: '835 line', pms_record: 'PMS record', portal_screenshot: 'Payer portal', prior_eob: 'Prior EOB', ivr_transcript: 'IVR transcript', rep_call: 'Rep call', policy_clause: 'Policy clause' }

  const hasClaim = (id) => !!(window.TORCH_DATA.claims && window.TORCH_DATA.claims[id])
  const tag = (item) => (item.claim ? `${item.copy.who} #${item.claim.number}` : item.copy.who)
  const groupOf = (s, item) => {
    if (!item || !item.group_key) return null
    const D = window.TORCH_DATA
    const members = s.items.filter((x) => x.group_key === item.group_key)
    if (members.length !== D.items.filter((x) => x.group_key === item.group_key).length) return null // one was handled alone
    return { key: item.group_key, items: members, count: members.length, cents: members.reduce((a, m) => a + m.cents, 0), copy: D.copy.groups[item.group_key] || {} }
  }

  /* ------------------------------------------------------------ memory */

  function sync(s, h) {
    s.items.forEach((i) => { known[i.id] = i })
    if (s.run && !entries.some((e) => e.run === s.run)) {
      const id = s.run.ids[0]
      const rule = s.filter === 'always:' + id && known[id] ? (h.policy(known[id]) || {}).rule : null
      entries.push({ kind: 'run', run: s.run, rule })
    }
    const open = new Set(s.items.map((i) => i.id))
    if (lastOpen) {
      lastOpen.forEach((id) => {
        if (open.has(id)) return
        if (entries.some((e) => (e.run && e.run.ids.includes(id)) || e.id === id)) return
        entries.push({ kind: 'deny', id, text: (s.toast || 'Denied. Nothing was sent.').replace(/^Rejected/, 'Denied') })
      })
    }
    lastOpen = open
  }

  const verbOf = (run, e) => (e && e.rule && !run.failed ? 'Always allowed' : run.ids.some((id) => known[id] && known[id].tier === 3) ? 'Signed once' : 'Allowed once')

  const entryFor = (id) => entries.slice().reverse().find((e) => (e.run && e.run.ids.includes(id)) || e.id === id)

  /* ------------------------------------------------------------ whose move */

  function moveFor(s, h, claim, item, resolved) {
    if (resolved) return { who: 'agents', label: 'With the agents' }
    if (item && !s.canAct(item)) return { who: 'owner', label: 'Waiting on Dr. Morgan' }
    return h.move(claim)
  }

  /* ------------------------------------------------------------ the shift log */

  const RULES = [
    [/readiness checks passed/, 'ready', (n) => `Checked and queued ${n} claims. Each passed 13 of 13 readiness checks.`],
    [/^Records sent via NEA/, 'records', (n) => `Sent records through NEA on ${n} claims.`],
    [/^Resubmitted with attachment/, 'resub', (n) => `Resubmitted ${n} claims with attachments.`],
    [/^Reprocessing requested/, 'repro', (n) => `Requested reprocessing on ${n} claims.`],
    [/^271 showed a plan change/, 'plan', (n) => `Updated benefits in the PMS for ${n} patients after a plan change on the 271.`],
    [/^Matched \d+ lines to contract/, 'post', (n) => `Posted ${n} remittances. Every line balanced.`],
    [/^Matched the PA of/, 'pa', (n) => `Matched the PA x-ray in imaging for ${n} crowns. The rule says ask, so they stopped.`],
    [/^Root cause: ours/, 'cause', () => 'Root cause: ours. We sent BWX; Delta’s rule asks for PA.'],
  ]
  const OUTCOME = { 'Resubmitted with attachment': 'Resubmitted', 'Records sent via NEA': 'Sent', 'Reprocessing requested': 'Requested', 'rule.signoff': 'Rule signed', 'rule.change': 'Rule changed', 'inbox.approve': 'Approved', 'root_cause.recorded': 'Recorded', 'eligibility.view': 'Viewed' }

  const subjectOf = (r) => {
    const t = String(r.subject || '')
    if (/^clm_\d+/.test(t)) return '#' + t.slice(4)
    const rem = t.match(/^rem_([a-z]+)_(\d\d)(\d\d)$/)
    if (rem) return `${cap(rem[1])} remittance ${rem[2]}/${rem[3]}`
    if (/^(rule|apt)_/.test(t)) return ''
    return dots(t).replace(/^(#\d+), /, (m, n) => n + ' ').replace(/^(#\d+) (.+)$/, '$2 $1')
  }
  const whoOf = (s, h, r) => {
    if (r.agent) return { name: h.agentName(r.agent), agent: true }
    const a = r.actor || ''
    if (AGENT_LINE.test(a)) return { name: h.agentName(a), agent: true }
    const u = s.users.find((x) => x.id === a)
    if (u) return { name: u.name, agent: false }
    return { name: cap(a.replace(/^usr_/, '')), agent: false }
  }
  const actionText = (r, outage) => {
    if (/portal slow; retrying/.test(r.action)) return stripEnd(outage.split('.')[0]) + '; retrying.'
    return dots(r.action).replace(/\s→ proposed\.?$/, ', so it stopped here.')
  }

  function itemForRow(s, r) {
    const all = Object.values(known)
    return all.find((i) => i.claim && i.claim.id === r.claim_id) || all.find((i) => !i.claim && i.copy.who === r.subject) || null
  }

  function buildLog(s, h) {
    const days = new Map()
    s.activity.forEach((r) => {
      const day = r.at.slice(0, 10)
      if (!days.has(day)) days.set(day, new Map())
      const m = days.get(day)
      const rule = RULES.find((x) => x[0].test(r.action))
      const who = whoOf(s, h, r).name
      const key = rule ? rule[1] + ':' + who : r.run_id || r.at + r.action
      if (!m.has(key)) m.set(key, { id: day + ':' + key.replace(/[^a-z0-9]/gi, ''), rule, rows: [] })
      m.get(key).rows.push(r)
    })
    return [...days.entries()].reverse().map(([day, m]) => ({ day, groups: [...m.values()].reverse() }))
  }

  function outcomeOf(s, g) {
    const rows = g.rows
    const r = rows[0]
    if (r.awaiting_you) {
      const it = itemForRow(s, r)
      if (it && s.items.some((i) => i.id === it.id)) return { text: s.canAct(it) ? 'Waiting on you' : 'Waiting on Dr. Morgan', stop: true, it }
      if (it) {
        const e = entryFor(it.id)
        return { text: e && e.kind === 'deny' ? 'Denied' : 'Handled', it: null }
      }
    }
    const raw = (x) => OUTCOME[x.outcome] || dots(x.outcome)
    const tally = new Map()
    rows.forEach((x) => tally.set(raw(x), (tally.get(raw(x)) || 0) + 1))
    if (tally.size === 1) return { text: raw(r) }
    return { text: [...tally.entries()].map(([k, n]) => `${k} ${n}`).join(', ') }
  }

  function chips(kinds) {
    if (!kinds.length) return ''
    return `<span class="chips">${kinds.map((k) => `<span class="chip">${h_esc(EV_KIND[k] || k)}</span>`).join('')}</span>`
  }
  let h_esc = (x) => x

  function logRow(s, h, g, i, locked) {
    const rows = g.rows
    const r = rows[0]
    const n = rows.length
    const who = whoOf(s, h, r)
    const oc = outcomeOf(s, g)
    const entry = n > 1 && g.rule ? g.rule[2](n) : g.rule && g.rule[1] === 'cause' ? g.rule[2](1) : actionText(r, s.outage)
    const names = rows.map(subjectOf).filter(Boolean)
    const subj = n > 3 ? `${n} claims` : names.join(', ')
    const isCause = g.rule && g.rule[1] === 'cause'
    const live = /^Checking/.test(r.outcome)
    const kinds = [...new Set(rows.flatMap((x) => x.evidence_kinds || []))]
    const canExpand = n > 1 || !!r.audit_line
    const openKey = 'open:' + g.id
    const isOpen = s.filter === openKey
    let act = ''
    if (oc.stop && oc.it && !locked) act = `select:${oc.it.id}`
    else if (canExpand) act = isOpen ? 'filter:all' : 'filter:' + openKey
    const earliest = n > 1 ? h.time(rows[n - 1].at) : null
    const detail = isOpen
      ? `<div class="sub">${n > 1
          ? rows.map((x) => {
            const cid = x.claim_id
            const nm = subjectOf(x)
            return `<div class="subrow"><span class="t">${h.esc(h.time(x.at))}</span><span class="sn">${cid && hasClaim(cid) ? `<button class="lnk" data-act="open-claim:${h.esc(cid)}">${h.esc(nm)}</button>` : h.esc(nm)}</span><span class="se">${h.esc(actionText(x, s.outage))}</span><span class="so">${h.esc(OUTCOME[x.outcome] || dots(x.outcome))}</span></div>`
          }).join('')
          : `<div class="audit">${h.esc(dots(r.audit_line))}</div>${r.claim_id && hasClaim(r.claim_id) ? `<button class="lnk" data-act="open-claim:${h.esc(r.claim_id)}">Open claim ${h.esc(subjectOf(r))}</button>` : ''}`}</div>`
      : ''
    const inner = `<span class="t">${h.esc(h.time(r.at))}</span>
      <span class="who ${who.agent ? 'ag' : 'hu'}">${h.esc(who.name)}</span>
      <span class="en ${isCause ? 'cause' : ''}">${canExpand && !oc.stop ? `<span class="dis ${isOpen ? 'on' : ''}">${ICON.chev}</span>` : ''}${h.esc(entry)}${earliest ? `<span class="since"> Since ${h.esc(earliest)}.</span>` : ''}${chips(kinds)}</span>
      <span class="su">${h.esc(subj)}</span>
      <span class="oc ${oc.stop ? 'stop' : ''} ${live ? 'live' : ''}">${live ? '<i class="beat"></i>' : ''}${h.esc(oc.text)}</span>`
    return `<div class="rowwrap ${i % 2 ? 'b' : ''} ${oc.stop ? 'stopped' : ''}" data-part="inbox.queue-row">
      ${act ? `<button class="row" data-act="${h.esc(act)}" ${canExpand ? `aria-expanded="${isOpen}"` : ''}>${inner}</button>` : `<div class="row">${inner}</div>`}
      ${detail}</div>`
  }

  function pastEntry(s, h, e, i) {
    if (e.kind === 'deny') {
      const it = known[e.id]
      return `<div class="rowwrap ${i % 2 ? 'b' : ''}"><div class="row"><span class="t">${h.esc(h.time(s.clock.now))}</span><span class="who hu">${h.esc(s.user.name)}</span><span class="en">${h.esc(e.text)}</span><span class="su">${it ? h.esc(tag(it)) : ''}</span><span class="oc">${/Snooz/.test(e.text) ? 'Snoozed' : 'Denied'}</span></div></div>`
    }
    const run = e.run
    const key = 'open:run' + entries.indexOf(e)
    const isOpen = s.filter === key
    const names = run.ids.map((id) => (known[id] ? tag(known[id]) : '')).filter(Boolean).join(', ')
    return `<div class="rowwrap ${i % 2 ? 'b' : ''}">
      <button class="row" data-act="filter:${isOpen ? 'all' : h.esc(key)}" aria-expanded="${isOpen}">
        <span class="t">${h.esc(h.time(s.clock.now))}</span><span class="who hu">${h.esc(s.user.name)}</span>
        <span class="en"><span class="dis ${isOpen ? 'on' : ''}">${ICON.chev}</span>${verbOf(run, e)}: ${h.esc(run.title)}. ${h.esc(run.failed ? run.steps.find((x) => x.state === 'failed').text + ' failed, so nothing was sent.' : run.doneLine)}${e.rule && !run.failed ? ` ${h.esc(e.rule)} now runs without asking.` : ''}</span>
        <span class="su">${h.esc(names)}</span><span class="oc ${run.failed ? 'bad' : ''}">${run.failed ? 'Came back' : 'Done'}</span>
      </button>
      ${isOpen ? `<div class="sub">${run.steps.map((x) => `<div class="subrow"><span class="t"></span><span class="sn">${x.state === 'failed' ? 'Failed' : x.state === 'done' ? 'Done' : 'Not run'}</span><span class="se">${h.esc(x.text)}</span><span class="so">${h.esc(x.detail || '')}</span></div>`).join('')}</div>` : ''}
    </div>`
  }

  /* ------------------------------------------------------------ a run, printing in place */

  function runBlock(s, h, run, onClaim) {
    const items = run.ids.map((id) => known[id]).filter(Boolean)
    const first = items[0]
    const agent = first ? h.agentName(first.agent) : 'Agent'
    const printed = run.steps.filter((x) => x.state !== 'pending')
    const left = run.steps.length - printed.length
    const entry = entries.find((e) => e.run === run)
    const denied = s.strip.tiles.find((t) => t.status === 'denied')
    const nDenied = items.filter((i) => i.claim && i.claim.status === 'denied').length
    const changes = run.changes.slice()
    if (run.done && !run.failed && nDenied) changes.push({ label: 'Denied claims waiting on you', from: denied.flagged + nDenied, to: denied.flagged })
    return `<section class="run ${run.failed ? 'failed' : ''}" data-part="inbox.run" aria-live="polite">
      <div class="r-line r-allow ${printed.length === 1 && !run.done ? 'print' : ''}">
        <span class="t">${h.esc(h.time(s.clock.now))}</span><span class="who hu">${h.esc(s.user.name)}</span>
        <span class="r-t">${verbOf(run, entry)}: <b>${h.esc(run.title)}</b></span>
        <span class="r-d">${h.esc(items.map(tag).join(', '))}</span>
      </div>
      ${printed.map((x, i) => `<div class="r-line r-step ${x.state} ${x.state === 'active' ? 'print' : ''}">
        <span class="t"></span><span class="who ag">${i === 0 ? h.esc(agent) : ''}</span>
        <span class="r-t"><span class="mark">${x.state === 'done' ? ICON.check : x.state === 'failed' ? ICON.cross : '<i class="ring"></i>'}</span>${h.esc(x.text)}</span>
        <span class="r-d">${h.esc(x.detail || '')}</span>
      </div>`).join('')}
      ${!run.done ? `<div class="r-line r-left"><span class="t"></span><span class="who"></span><span class="r-t">${left ? `${plural(left, 'step')} to go.` : 'Finishing.'} Nothing else can run from here until this one ends.</span></div>` : ''}
      ${run.failed ? `<div class="r-fail"><p class="ft">${h.esc(run.failedText)}</p></div>` : ''}
      ${run.done ? `<div class="after" data-part="inbox.after-state">
        ${changes.map((c) => `<div class="ch"><span class="chl">${h.esc(c.label)}</span><span class="chv">${c.from === c.to ? `stays ${h.esc(c.to)}` : `${h.esc(c.from)} <span class="ar">to</span> ${h.esc(c.to)}`}</span>${c.note ? `<span class="chn">${h.esc(c.note)}</span>` : ''}</div>`).join('')}
        ${!run.failed ? `<div class="fin"><span class="dl">${h.esc(run.doneLine)}${entry && entry.rule ? ` ${h.esc(entry.rule)} now runs without asking.` : ''}</span>
          <span class="whose">${items.filter((i) => i.claim).map((i) => `<button class="lnk" data-act="open-claim:${h.esc(i.claim.id)}">${h.esc(tag(i))}</button>`).join(' ')}${items.some((i) => i.claim) ? ' are with the agents now.'.replace(' are', items.filter((i) => i.claim).length > 1 ? ' are' : ' is') : ''}</span></div>
        ${onClaim ? '<button class="quiet" data-act="nav:inbox">Back to the log</button>' : `<button class="quiet" data-act="next">${s.mine.length ? `Next prompt, ${h.esc(s.mine[0].copy.who)}` : 'Back to the log'}</button>`}` : ''}
      </div>` : ''}
    </section>`
  }

  /* ------------------------------------------------------------ the prompt */

  function evidence(h, list) {
    return list.map((e) => `<article class="ev">
      <h4>${h.esc(e.title.replace(/\s·\s/g, ', '))}</h4>
      <p>${h.esc(e.excerpt)}</p>
      <div class="evm">${h.esc(EV_KIND[e.kind] || 'Record')}, ${h.esc(h.date(e.captured_at))} at ${h.esc(h.time(e.captured_at))}${e.ref ? `, ref ${h.esc(e.ref)}` : ''}</div>
    </article>`).join('')
  }

  function stoppedTime(s, h, item) {
    const r = s.activity.find((x) => x.awaiting_you && ((item.claim && x.claim_id === item.claim.id) || (!item.claim && x.subject === item.copy.who)))
    return r ? h.time(r.at) : null
  }

  function promptBlock(s, h, item, opt) {
    const o = opt || {}
    const g = o.single ? null : groupOf(s, item)
    const c = g ? g.copy : item.copy
    const canAct = s.canAct(item)
    const agent = h.agentName(item.agent)
    const at = stoppedTime(s, h, item)
    const keyId = g ? g.key : item.id
    const key = (o.compact ? 'c' : 'f') + keyId + (o.returned ? 'r' : '')
    const enter = key !== lastPromptKey
    lastPromptKey = key
    promptDrawn = true
    const cents = g ? g.cents : item.cents
    const isDenied = item.claim && item.claim.status === 'denied'
    const subject = g
      ? g.items.map(tag).join(', ')
      : `${tag(item)}, ${item.copy.treatment}${item.claim ? ', ' + item.claim.payer.short_name : ''}`
    const stopped = c.stoppedBy || item.copy.stoppedBy
    const recLine = item.record
      ? `<b>${h.esc((item.record.match(/^\d+ of \d+/) || [''])[0])}</b>${h.esc(dots(item.record.replace(/^\d+ of \d+/, '')))}`
      : /base rate/.test(stopped || '') ? '' : item.noRecord ? `No track record to show. ${h.esc(cap(dots(item.noRecord)))}.` : ''
    const policy = h.policy(item)
    const ids = g ? g.items.map((i) => '#' + i.claim.number).join(', ') : item.claim ? '#' + item.claim.number : ''
    const ours = item.root_cause === 'ours'
    const allowAct = g ? `approve-group:${g.key}` : `approve:${item.id}`
    const tier3 = item.tier === 3

    const why = !o.compact && c.why ? `<p class="why">${h.esc(c.why)}</p>` : ''
    const cause = ours ? `<p class="ourcause"><b>Root cause: ours on ${h.esc(ids)}.</b> ${h.esc(cap(String(item.audit_note || '').split(/\s—\s/)[1] || ''))}.</p>` : ''

    let choices
    if (!canAct) {
      choices = `<div class="hard" data-part="inbox.action-bar">
        <div class="hardt">Dr. Morgan signs this</div>
        <p>${h.esc(c.signerNote)} ${h.esc(c.stoppedBy)}</p>
        <p class="tch">If signed: ${h.esc(c.touches.join(', '))}.</p>
        <button class="ghost" data-act="user:usr_morgan">Switch to Dr. Morgan</button>
      </div>`
    } else {
      let always
      const confirming = s.filter === 'always:' + item.id
      if (tier3) {
        always = `<div class="cho off" data-part="inbox.policy"><span class="chol">Always allow</span><span class="chod">Never offered. ${h.esc(c.stoppedBy)}</span></div>`
      } else if (policy && policy.canLearn && confirming) {
        always = `<div class="cho sure" data-part="inbox.policy"><span class="chol">Always allow</span><span class="chod"><b>${h.esc(policy.rule)}</b> would stop asking, for every future case. ${h.esc(policy.reason)}
          <span class="surebtns"><button class="ghost" data-act="approve:${h.esc(item.id)}">Allow this and change the rule</button><button class="plain" data-act="filter:all">Keep asking</button></span></span></div>`
      } else if (policy && policy.canLearn) {
        always = `<button class="cho" data-act="filter:always:${h.esc(item.id)}" data-part="inbox.policy"><span class="chol">Always allow</span><span class="chod">Stop asking on <b>${h.esc(policy.rule)}</b>. You confirm on the next step.</span></button>`
      } else if (policy) {
        const p = policy.preview
        always = `<div class="cho off" data-part="inbox.policy"><span class="chol">Always allow</span><span class="chod">Not available. ${h.esc(policy.reason)}${p ? ` <span class="prev">${p.from} to ${p.to} of ${p.total}, ${p.held} held, net ${p.net}</span>` : ''}</span></div>`
      } else {
        always = `<div class="cho off" data-part="inbox.policy"><span class="chol">Always allow</span><span class="chod">Not offered here, for the reason above.</span></div>`
      }
      const verb = tier3 ? 'Sign once' : o.returned ? 'Try again' : 'Allow once'
      const denyId = item.id
      choices = `<div class="choices">
        <button class="allow" data-act="${h.esc(allowAct)}" data-part="inbox.action-bar">
          <span class="allowl">${verb}</span>
          <span class="allowa">${h.esc(c.action)}<span class="tch">${h.esc((c.touches || []).join('. '))}</span></span>
          ${!o.compact && s.selected && s.selected.id === item.id ? `<kbd>${g ? '⇧A' : 'A'}</kbd>` : ''}
        </button>
        ${always}
        <button class="cho deny" data-act="reject:${h.esc(denyId)}"><span class="chol">Deny</span><span class="chod">${g ? `Deny ${h.esc(tag(item))} only. Nothing is sent, and the other ${g.count - 1} stay here.` : 'Nothing is sent, and this leaves your prompts.'}</span></button>
      </div>`
    }

    const members = g
      ? `<div class="mem" data-part="inbox.group">${g.items.map((m) => `<div class="memr ${m.id === item.id ? 'cur' : ''}">
          <button class="memb" data-act="select:${h.esc(m.id)}" aria-pressed="${m.id === item.id}"><span class="memn">${h.esc(tag(m))}</span><span class="memt">${h.esc(m.copy.treatment)}</span><span class="memc">${h.money(m.cents)}</span></button>
          <button class="plain onl" data-act="approve:${h.esc(m.id)}" ${m.id === item.id ? '' : 'tabindex="-1"'}>Send only this one</button>
        </div>`).join('')}</div>`
      : ''

    const draft = item.draft
      ? `<div class="draft" data-part="inbox.draft"><h3>These words go to ${h.esc(item.claim.payer.short_name)}</h3>
        ${item.draft.map((d) => `<div class="sent"><p>${h.esc(d.text)}</p><div class="cite">${d.cites.length ? d.cites.map((t) => h.esc(t.replace(/\s·\s/g, ', '))).join('; ') : 'No citation: this sentence is the ask, not a fact.'}</div></div>`).join('')}</div>`
      : ''

    return `<section class="prompt ${enter ? 'enter' : ''} ${canAct ? '' : 'stop'} ${o.compact ? 'compact' : ''} ${draft ? 'hasdraft' : ''}" aria-label="Prompt">
      <div class="pl">
        <div class="phead"><span class="pagent">${o.returned ? 'Came back at ' + h.esc(h.time(s.clock.now)) : `${h.esc(agent)} stopped${at ? ' at ' + h.esc(at) : ''}`}</span>${o.onClaim ? '' : `<span class="psub">${h.esc(subject)}</span>`}</div>
        <h2 class="q" data-part="inbox.decision">${h.esc(c.headline)}</h2>
        ${why}
        ${cause}
        <p class="stopby" data-part="inbox.why-stopped"><span>Why it stopped at you</span> ${h.esc(stopped)}</p>
        ${recLine ? `<p class="rec" data-part="inbox.recommendation">${recLine}</p>` : ''}
        ${choices}
      </div>
      <div class="pr ${draft ? 'two' : ''}">
        <div class="pmeta">${o.onClaim ? '' : `<span class="stake">${h.money(cents)}${isDenied ? ' at stake' : ''}</span>`}
          ${item.claim && !g && !o.onClaim ? `<button class="lnk" data-act="open-claim:${h.esc(item.claim.id)}">Open claim #${h.esc(item.claim.number)}</button>` : ''}
          ${!o.compact && s.mine.length > 1 ? `<span class="keys" data-part="inbox.keyboard"><kbd>J</kbd><kbd>K</kbd> move between prompts</span>` : ''}</div>
        <div class="pscroll" data-scroll="ev${h.esc(item.id)}">
          ${draft ? `<div class="pcols">${draft}<div data-part="inbox.evidence"><h3>What ${h.esc(agent)} read</h3>${evidence(h, item.evidence)}</div></div>` : `${members}
          <div data-part="inbox.evidence"><h3>What ${h.esc(agent)} read${g ? ` for ${h.esc(tag(item))}` : ''}</h3>${item.evidence.length ? `<div class="evgrid">${evidence(h, item.evidence)}</div>` : `<p class="noev">${h.esc(agent)} found nothing to read: ${h.esc(dots(item.noRecord || ''))}.</p>`}</div>`}
        </div>
      </div>
    </section>`
  }

  /* ------------------------------------------------------------ tabs on the carbon's top edge */

  function tabs(s, h, dock) {
    const seen = new Set()
    const out = []
    s.mine.forEach((it) => {
      if (it.group_key && groupOf(s, it)) {
        if (seen.has(it.group_key)) return
        seen.add(it.group_key)
        const g = groupOf(s, it)
        const on = dock && dock.group_key === it.group_key
        out.push(`<button class="tab ${on ? 'on' : ''}" data-act="select:${h.esc(it.id)}" data-part="inbox.group" aria-pressed="${!!on}">${h.esc(tag(it))} <span class="pl2">and ${g.count - 1} more</span></button>`)
      } else {
        const on = dock && dock.id === it.id
        const back = (entries.find((e) => e.run && e.run.failed && e.run.ids.includes(it.id)))
        out.push(`<button class="tab ${on ? 'on' : ''}" data-act="select:${h.esc(it.id)}" data-part="inbox.queue-row" aria-pressed="${!!on}">${h.esc(tag(it))}${back ? ' <span class="pl2">came back</span>' : ''}</button>`)
      }
    })
    const own = s.waitingOnOwner.map((it) => {
      const on = dock && dock.id === it.id
      return `<button class="tab own ${on ? 'on' : ''}" data-act="select:${h.esc(it.id)}" data-part="inbox.queue-row" aria-pressed="${!!on}">Dr. Morgan signs ${h.esc(tag(it))}</button>`
    }).join('')
    return `<nav class="tabs" data-part="inbox.queue" aria-label="Prompts waiting">${out.join('')}<span class="tabgap"></span>${own}</nav>`
  }

  /* ------------------------------------------------------------ shell */

  function top(s, h, active) {
    const nav = [
      ['Log', 'nav:inbox', 'inbox', s.strip.inbox_open],
      ['Denials', 'nav:denials', 'denials', s.denials.total],
      ['Claims', 'open-claim:clm_4821', 'claim', null],
      ['Payments', 'nav:Payments', null, null],
      ['Settings', 'nav:Settings', null, null],
    ]
    const d = new Date(s.clock.now)
    const wd = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' })
    return `<header class="top" data-part="shell.header">
      <span class="mark-t">Torch</span>
      <nav class="nav" data-part="shell.nav" aria-label="Main">${nav.map(([l, a, k, n]) => `<button class="${k === active ? 'on' : ''}" data-act="${a}" ${k === active ? 'aria-current="page"' : ''}>${l}${n !== null ? ` <span class="n">${h.esc(n)}</span>` : ''}</button>`).join('')}</nav>
      <div class="thesis" data-part="shell.agent-summary"><b>Agents ran ${s.week.ranAlone} of ${s.week.decisions} decisions without you this week.</b>
        <span>${plural(s.strip.inbox_open, 'open item')}: ${plural(s.reconcile.claims, 'claim')}, ${plural(s.reconcile.visits, 'upcoming visit')}.${s.waitingOnOwner.length ? ` ${s.mine.length} for you, ${s.waitingOnOwner.length} for Dr. Morgan.` : ''}</span></div>
      <div class="demo" data-part="shell.demo-controls">
        <div class="seg" role="group" aria-label="Signed in as">${s.users.map((u) => `<button data-act="user:${h.esc(u.id)}" aria-pressed="${u.id === s.user.id}">${h.esc(u.name)}</button>`).join('')}</div>
        <span class="clock">${h.esc(wd)} ${h.esc(h.date(s.clock.now))}, ${h.esc(h.time(s.clock.now))}</span>
      </div>
    </header>`
  }

  function foot(s, h) {
    return `<footer class="foot">
      <div class="tiles" data-part="shell.pipeline">${s.strip.tiles.map((t) => `<span class="ti ${t.status === 'denied' ? 'den' : ''}"><span>${h.esc(dots(t.label).replace(', ', ' '))}</span> <b>${t.count}</b>${t.flagged ? `<span class="fl" title="${t.flagged} flagged for action">${ICON.flag}${t.flagged}</span>` : ''}</span>`).join('')}</div>
      <span class="ar-t">${s.strip.open_count} open, ${h.money(s.strip.ar_cents)} A/R</span>
      <span class="outage" data-part="shell.outage">${h.esc(stripEnd(s.outage.split('.')[0]))}</span>
    </footer>`
  }

  function toastLine(s, h) {
    return s.toast && !/Rejected|Snoozed/.test(s.toast) ? `<div class="toast" role="status">${h.esc(s.toast)}</div>` : ''
  }

  /* ------------------------------------------------------------ inbox: the log */

  function inboxScreen(s, h) {
    const running = !!(s.run && !s.run.done)
    const failed = !!(s.run && s.run.failed)
    let dock = null
    if (!running) {
      if (failed) dock = s.items.find((i) => i.id === s.run.ids[0]) || null
      else if (s.selected) dock = s.selected
      else if (!s.run) dock = s.mine[0] || null
    }
    const days = buildLog(s, h)
    let n = 0
    const fmtDay = (d) => new Date(d + 'T12:00:00-04:00').toLocaleDateString('en-US', { weekday: 'long', month: 'numeric', day: 'numeric', timeZone: 'America/New_York' })
    const logHtml = days.map((d) => `<h3 class="day">${h.esc(fmtDay(d.day))}</h3>${d.groups.map((g) => logRow(s, h, g, n++, running)).join('')}`).join('')
    const past = entries.filter((e) => e.run !== s.run).map((e) => pastEntry(s, h, e, n++)).join('')
    const nowLine = `<div class="now"><span class="t">${h.esc(h.time(s.clock.now))}</span><span class="who">Now</span><span class="en">${s.agents.agents} agents on shift, ${s.agents.running + (running ? 1 : 0)} running${s.agents.queued ? `, ${s.agents.queued} queued` : ''}</span></div>`
    const hold = s.items.length
    let lower
    if (running) lower = `<div class="hold wait" role="status">${plural(hold, 'prompt')} ${hold === 1 ? 'is' : 'are'} holding until this run finishes.</div>`
    else if (dock) lower = tabs(s, h, dock) + promptBlock(s, h, dock, { returned: failed })
    else if (!s.items.length) lower = `<div class="hold" data-part="inbox.empty">Nothing is waiting on you. The agents keep working.</div>`
    else if (!s.mine.length) lower = tabs(s, h, null) + `<div class="hold" data-part="inbox.empty">Nothing is waiting on you. ${plural(s.waitingOnOwner.length, 'item')} ${s.waitingOnOwner.length === 1 ? 'is' : 'are'} with Dr. Morgan.</div>`
    else lower = tabs(s, h, null)
    return `<div class="app ${running ? 'isrunning' : ''}">
      ${top(s, h, 'inbox')}
      <div class="heads" aria-hidden="true"><span>Time</span><span>Who</span><span>Entry</span><span>Claim</span><span>Outcome</span></div>
      <main class="log" data-scroll="log" data-part="inbox.queue" aria-label="Shift log"><div class="logi">${logHtml}${past}${!s.run ? nowLine : ''}${s.run ? runBlock(s, h, s.run) : ''}</div></main>
      ${toastLine(s, h)}
      ${lower}
      ${foot(s, h)}
    </div>`
  }

  /* ------------------------------------------------------------ claim: the same log, for one claim */

  const LANE = { agent: 'Agent', payer: 'Payer', system: 'System', human: 'You', user: 'You' }

  function auditDetail(t, claim) {
    if (!t) return ''
    const parts = String(t).split(/\s·\s/).filter((p) => !/^#\d+/.test(p) && !/^\$/.test(p) && p !== claim.payer.short_name && !/^(Claims|Follow-up|Appeals|Posting|Eligibility)$/.test(p))
    return parts.join(', ')
  }

  function claimScreen(s, h) {
    const C = s.claim
    const cl = C.claim
    const item = C.openItems[0] || null
    const m = C.money
    const running = !!(s.run && !s.run.done)
    const runHere = s.run && C.open_inbox_items.some((i) => s.run.ids.includes(i.id))
    const move = moveFor(s, h, cl, item, !!C.queued)
    const atStake = m.billed_cents - (m.paid_cents || 0)
    const est = m.paid_cents ? '' : ' est.'
    const dl = C.deadline && C.deadline.due_on
    const tl = C.timeline.filter((t) => !(runHere && t.id.startsWith('x_')))
    const rows = tl.map((t, i) => {
      const ours = t.root_cause === 'ours'
      const denied = /Denied/.test(t.title) && t.lane === 'payer'
      const first = String(t.detail || '').split(/\s·\s/)[0]
      const named = /^(Claims|Follow-up|Appeals|Posting|Eligibility)$/.test(first) ? first : null
      const lane = t.lane === 'agent' ? (t.actor ? h.agentName(t.actor) : named || 'Agent') : LANE[t.lane] || 'System'
      return `<div class="tl ${i % 2 ? 'b' : ''} ${ours ? 'ours' : ''} ${denied ? 'denline' : ''}">
        <span class="t">${h.esc(h.date(t.at))}, ${h.esc(h.time(t.at))}</span>
        <span class="who ${t.lane === 'agent' ? 'ag' : t.lane === 'payer' ? 'pa' : 'hu'}">${h.esc(lane)}</span>
        <span class="en">${h.esc(dots(t.title.replace(/^Root cause: ours\s—\s(.)/, (m, c) => 'Root cause: ours. ' + c.toUpperCase())))}${t.detail ? `<span class="tld">${h.esc(auditDetail(t.detail, cl))}</span>` : ''}</span>
      </div>`
    }).join('')
    const lines = C.lines.map((l) => `<tr><td>${h.esc(l.cdt)}</td><td>${h.esc(l.tooth || '')}</td><td class="r">${h.money(l.fee_cents)}</td><td class="r">${h.money(l.allowed_cents)}${est}</td><td class="r">${h.money(l.paid_cents)}</td></tr>`).join('')
    let lower = ''
    if (running && runHere) lower = `<div class="hold wait" role="status">This claim is running. Nothing else can start from here.</div>`
    else if (running) lower = `<div class="hold wait" role="status">A run is in progress. Prompts are holding until it finishes.</div>`
    else if (item) lower = promptBlock(s, h, item, { compact: true, single: true, onClaim: true, returned: !!(s.run && s.run.failed && s.run.ids.includes(item.id)) })
    return `<div class="app">
      ${top(s, h, 'claim')}
      <div class="ch-head" data-part="claim.header">
        <button class="back" data-act="back">Back to the ${s.from === 'denials' ? 'denials' : 'log'}</button>
        <h1>${h.esc(cl.patient.display_name)} <span class="num">#${cl.number}</span></h1>
        <span class="chf">${h.esc(cl.payer.short_name)}, ${h.esc(cl.procedures)}, seen ${h.esc(h.dateYear(cl.dos))} by ${h.esc(C.provider_name)}</span>
        <span class="mv mv-${move.who}">${h.esc(move.label)}</span>
      </div>
      <div class="ch-sum">
        <div class="stakebig" data-part="claim.money"><b>${h.money(atStake)}</b><span>${cl.status === 'denied' ? 'at stake' : 'open'}</span></div>
        <div class="deny" data-part="claim.denial">
          ${C.denial ? `<p>${cl.status === 'denied' ? 'Denied' : 'Flagged'} ${h.gloss(C.denial.carc)}${C.denial.rarc ? ' ' + h.gloss(C.denial.rarc) : ''}. ${h.esc(C.denial.decoded)}.${C.denial.root_cause === 'ours' ? ' <span class="oursinl">Root cause: ours.</span>' : ''}</p>` : `<p>${h.esc(cap(cl.status))}${cl.reason ? `: ${h.esc(dots(cl.reason))}` : ''}.</p>`}
          <p class="dlq">${dl ? `Appeal due ${h.esc(h.dateYear(C.deadline.due_on))}, ${h.daysUntil(C.deadline.due_on)} days left. ${h.esc(C.deadline.basis)}.` : cl.status === 'denied' ? 'No appeal deadline.' : ''}</p>
        </div>
        <div class="est">${m.paid_cents === null || m.paid_cents === undefined ? '' : `<span>Paid <b>${h.money(m.paid_cents)}</b></span>`}<span>Allowed <b>${h.money(m.allowed_cents)}</b>${est}</span><span>Patient <b>${h.money(m.patient_est_cents)}</b>${est}</span><span>Contractual <b>${h.money(-m.contractual_cents)}</b>${est}</span>
          <em>${h.esc(cap(dots(m.basis)))}</em></div>
      </div>
      <div class="ch-body">
        <main class="log tlog" data-scroll="claimlog" data-part="claim.timeline" aria-label="Log for this claim"><div class="logi">${rows}${runHere ? runBlock(s, h, s.run, true) : ''}</div></main>
        <aside class="side" data-part="claim.side" data-scroll="claimside">
          <div data-part="claim.lines"><h3>Lines</h3><table><thead><tr><th>Code</th><th>Tooth</th><th class="r">Billed</th><th class="r">Allowed</th><th class="r">Paid</th></tr></thead><tbody>${lines}</tbody></table></div>
          ${C.attachments.length ? `<div><h3>Attachments</h3>${C.attachments.map((a) => `<p class="att"><b>${h.gloss(a.kind.toUpperCase())}</b>${a.note ? ` ${h.esc(a.note)}` : ''}<span>NEA# ${h.esc(a.nea_number)}, ${h.esc(h.date(a.created_at))}</span></p>`).join('')}</div>` : ''}
        </aside>
      </div>
      ${lower ? `<div data-part="claim.open-item">${lower}</div>` : ''}
      ${foot(s, h)}
    </div>`
  }

  /* ------------------------------------------------------------ denials: the log filtered to what can stop it */

  function denialsScreen(s, h) {
    const groups = s.denials.groups
    const rows = groups.flatMap((g) => g.rows)
    const running = !!(s.run && !s.run.done)
    const fid = s.filter.startsWith('den:') ? s.filter.slice(4) : null
    const failedItem = s.run && s.run.failed ? rows.find((r) => r.item && r.item.id === s.run.ids[0]) : null
    const focus = failedItem || rows.find((r) => r.item && !r.resolved && r.item.id === fid) || rows.find((r) => r.item && !r.resolved && s.canAct(r.item)) || rows.find((r) => r.item && !r.resolved) || null
    const focusGroup = focus ? groupOf(s, focus.item) : null
    const soon = rows.filter((r) => r.deadline && r.deadline.due_on).map((r) => r.deadline.due_on).sort()[0]
    const cents = groups.reduce((a, g) => a + g.cents, 0)
    const showPrompt = !running && !!focus && !(s.run && s.run.done && !s.run.failed)
    const body = groups.map((g) => `<h3 class="day">${h.esc(dots(g.label))} <span>${plural(g.count, 'claim')}, ${h.money(g.cents)}</span></h3>
      ${g.rows.map((r, i) => {
        const mv = moveFor(s, h, r.claim, r.item, r.resolved)
        const cur = showPrompt && (focus === r || (focusGroup && r.item && r.item.group_key === focusGroup.key))
        const inner = `<span class="dd" data-part="denials.deadline">${r.deadline && r.deadline.due_on ? `<b>${h.esc(h.dateYear(r.deadline.due_on))}</b><span>${h.daysUntil(r.deadline.due_on)} days left</span>` : `<b>No deadline</b>`}</span>
          <span class="dc"><b>${h.esc(r.claim.patient.display_name)} #${r.claim.number}</b><span>${h.esc(r.claim.payer.short_name)}, ${h.esc(r.claim.procedures)}</span></span>
          <span class="dw"><span>${h.gloss(r.carc)}${r.rarc ? ' ' + h.gloss(r.rarc) : ''}, ${h.esc(r.decoded)}</span>
            <span class="dq">${r.root_cause === 'ours' ? '<b class="oursinl">Root cause: ours.</b> ' : ''}${r.patient_billable_if_lost ? 'The patient can be billed if this is lost.' : 'The patient cannot be billed if this is lost.'}</span></span>
          <span class="dm">${h.money(r.claim.billed_cents)}</span>
          <span class="mv mv-${mv.who}">${h.esc(mv.label)}</span>`
        const can = r.item && !r.resolved && !running
        return can
          ? `<button class="drow ${i % 2 ? 'b' : ''} ${cur ? 'cur' : ''}" data-act="filter:den:${h.esc(r.item.id)}" aria-pressed="${!!cur}" data-part="denials.row">${inner}</button>`
          : `<div class="drow ${i % 2 ? 'b' : ''}" data-part="denials.row">${inner}</div>`
      }).join('')}`).join('')
    let lower = ''
    if (running) lower = `<div class="hold wait" role="status">Prompts are holding until this run finishes.</div>`
    else if (showPrompt) lower = `<div data-part="denials.action">${promptBlock(s, h, focus.item, { compact: true, returned: !!failedItem })}</div>`
    return `<div class="app">
      ${top(s, h, 'denials')}
      <div class="dn-head" data-part="denials.summary">
        <h1>${s.denials.total} denied, ${h.money(cents)} at stake</h1>
        <p>Soonest deadline ${h.esc(h.dateYear(soon))}, ${h.daysUntil(soon)} days left. ${plural(s.denials.in_flight.length, 'denial')} in flight.</p>
        <button class="lnk" data-act="nav:inbox">Show the whole log</button>
      </div>
      <div class="dn-heads" aria-hidden="true"><span>Deadline</span><span>Claim</span><span>Why it was denied</span><span class="r">At stake</span><span>Whose move</span></div>
      <main class="log dnlog" data-scroll="denials" aria-label="Denials"><div class="dni">${body}${s.run ? runBlock(s, h, s.run) : ''}</div></main>
      ${toastLine(s, h)}
      ${lower}
      ${foot(s, h)}
    </div>`
  }

  /* ------------------------------------------------------------ styles */

  const css = `
  :host{--sheet:#DDEBD6;--band:#D2E3CB;--rule:#B5CCAE;--ink:#13233F;--ink2:#3A4F5E;--pine:#0A6651;--red:#B4231C;--carbon:#1A2472;--carbon2:#2A3690;--canary:#FFD94A;--paper:#F4F8F0;--on2:#C9D3F0;--mint:#A5EBD2;--coral:#FFB9AD;
    --body:'Atkinson Hyperlegible Next','Atkinson Hyperlegible',Verdana,sans-serif;--voice:'Besley',Georgia,serif}
  .app{width:1440px;height:900px;overflow:hidden;background:var(--sheet);color:var(--ink);font:400 15px/22px var(--body);display:flex;flex-direction:column;font-variant-numeric:tabular-nums;position:relative}
  button{font:inherit;color:inherit;background:none;border:0;padding:0;text-align:left;cursor:pointer}
  button:focus-visible{outline:2.5px solid var(--carbon);outline-offset:2px}
  .prompt button:focus-visible{outline-color:var(--canary)}
  h1,h2,h3,h4,p{margin:0}
  kbd{font:600 13px/1 var(--body);border:1.5px solid currentColor;padding:2px 5px;border-radius:3px;margin-left:3px}
  abbr{cursor:help}

  .top{flex:none;height:60px;display:flex;align-items:center;gap:30px;padding:0 32px}
  .mark-t{font:700 22px/1 var(--voice);letter-spacing:-.01em}
  .nav{display:flex;gap:20px}
  .nav button{padding:18px 0 15px;border-bottom:3px solid transparent;color:var(--ink2)}
  .nav button.on{color:var(--ink);font-weight:700;border-bottom-color:var(--ink)}
  .nav .n{font-weight:400}
  .thesis{flex:1;min-width:0;display:flex;flex-direction:column;line-height:20px;padding-left:30px}
  .thesis b{font-weight:600}
  .thesis span{font-size:13px;color:var(--ink2)}
  .demo{display:flex;align-items:center;gap:16px;font-size:13px}
  .seg{display:flex;gap:2px}
  .seg button{padding:3px 9px;border-radius:3px;color:var(--ink2)}
  .seg button[aria-pressed="true"]{color:var(--ink);font-weight:700;box-shadow:inset 0 0 0 1.5px var(--ink)}
  .clock{color:var(--ink2)}

  .heads,.row,.r-line,.now{display:grid;grid-template-columns:82px 92px minmax(0,1fr) 232px 172px;column-gap:18px}
  .heads{flex:none;padding:5px 32px;font-size:13px;line-height:18px;color:var(--ink2);border-top:2px solid var(--ink);border-bottom:1px solid var(--rule)}
  .log{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column-reverse;scrollbar-width:thin;scrollbar-color:var(--rule) transparent}
  .logi{flex:none;padding-bottom:2px}
  .day{position:sticky;top:-8px;z-index:2;background:var(--sheet);font:600 13px/20px var(--body);padding:16px 32px 6px;color:var(--ink)}
  .day span{font-weight:400;color:var(--ink2);margin-left:6px}
  .rowwrap.b{background:var(--band)}
  .row{width:100%;padding:6px 32px;align-items:baseline}
  button.row:hover .en{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}
  .t{color:var(--ink2);font-size:13px;white-space:nowrap}
  .who{font-weight:600;font-size:15px}
  .who.ag{color:var(--pine)}
  .who.pa{color:var(--ink2)}
  .en{min-width:0;position:relative}
  .dis{position:absolute;left:-14px;top:6px;color:var(--ink2);line-height:0}
  .dis.on{transform:rotate(90deg)}
  .since{color:var(--ink2)}
  .en.cause{color:var(--red);font-weight:600}
  .su{color:var(--ink);font-size:15px}
  .oc{color:var(--ink2);font-size:15px}
  .oc.stop{color:var(--carbon);font-weight:700}
  .oc.bad{color:var(--red);font-weight:700}
  .oc.live{color:var(--pine);font-weight:600;display:flex;align-items:center;gap:7px}
  .beat{width:8px;height:8px;background:var(--pine);border-radius:50%;animation:beat 1.4s ease-in-out infinite}
  @keyframes beat{50%{opacity:.25}}
  .rowwrap.stopped{box-shadow:inset 4px 0 0 var(--carbon)}
  .chips{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:1px;font-size:13px;line-height:18px;color:var(--ink2)}
  .chip{background:var(--paper);padding:0 6px;border-radius:2px}
  .sub{padding:2px 32px 10px;margin-left:192px;font-size:15px}
  .subrow{display:grid;grid-template-columns:70px 170px minmax(0,1fr) 170px;column-gap:14px;padding:2px 0}
  .so{color:var(--ink2)}
  .audit{color:var(--ink2);max-width:72ch}
  .lnk{text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}
  .now{padding:7px 32px;color:var(--pine);font-weight:600}
  .now .t{color:var(--pine)}
  .now .who{font-size:15px}
  .now .en{grid-column:3/-1}

  .tabs{flex:none;display:flex;align-items:flex-end;gap:3px;padding:7px 32px 0;background:var(--sheet);border-top:1px solid var(--rule)}
  .tab{padding:6px 11px 7px;font-size:13px;line-height:18px;background:var(--band);border-radius:5px 5px 0 0;color:var(--ink);white-space:nowrap}
  .tab:hover{background:var(--rule)}
  .tab.on{background:var(--carbon);color:var(--paper);font-weight:700}
  .tab .pl2{color:var(--ink2)}
  .tab.on .pl2{color:var(--on2);font-weight:400}
  .tab.own{background:none;box-shadow:inset 0 0 0 1.5px var(--ink2);color:var(--ink)}
  .tab.own.on{background:var(--carbon);color:var(--paper);box-shadow:none}
  .tabgap{flex:1}

  .prompt{flex:none;background:var(--carbon);color:var(--paper);display:grid;grid-template-columns:560px minmax(0,1fr);column-gap:32px;padding:18px 32px 18px}
  .prompt.enter{animation:rise .32s cubic-bezier(.2,.85,.25,1) both}
  @keyframes rise{from{transform:translateY(46px)}}
  .pl{min-width:0}
  .phead{display:flex;gap:12px;align-items:baseline;font-size:15px}
  .pagent{color:var(--mint);font-weight:600;white-space:nowrap}
  .psub{color:var(--on2)}
  .q{font:600 28px/34px var(--voice);letter-spacing:-.012em;margin:8px 0 8px;text-wrap:balance}
  .why{color:var(--on2);margin-bottom:8px}
  .ourcause{color:var(--coral);font-size:15px;line-height:21px;margin-bottom:6px}
  .ourcause b{font-weight:700}
  .stopby{font-size:15px;line-height:21px}
  .stopby span{color:var(--on2)}
  .stopby span::after{content:':'}
  .rec{font-size:15px;line-height:21px;color:var(--on2)}
  .rec b{color:var(--paper);font-weight:700}
  .choices{margin-top:12px;display:flex;flex-direction:column;gap:4px}
  .allow{display:grid;grid-template-columns:96px minmax(0,1fr) auto;column-gap:12px;align-items:center;background:var(--canary);color:var(--ink);padding:9px 14px;border-radius:4px;width:100%}
  .allow:hover{background:#FFE36E}
  .allowl{font-weight:700}
  .allowa{font:700 18px/23px var(--body)}
  .allowa .tch{display:block;font-weight:400;font-size:13px;line-height:18px}
  .allow kbd{align-self:start;margin-top:2px}
  .cho{display:grid;grid-template-columns:96px minmax(0,1fr);column-gap:12px;padding:6px 14px;width:100%;font-size:15px;line-height:21px;border-radius:4px;color:var(--paper)}
  button.cho:hover{background:var(--carbon2)}
  .chol{font-weight:600;font-size:15px}
  .chod{color:var(--on2)}
  .chod b{color:var(--paper);font-weight:600}
  .cho.off .chol{color:var(--on2);font-weight:400;text-decoration:line-through;text-decoration-thickness:1px}
  .prev{color:var(--paper);font-weight:600;white-space:nowrap}
  .cho.sure{background:var(--carbon2)}
  .surebtns{display:flex;gap:14px;align-items:center;margin-top:6px}
  .ghost{padding:5px 11px;box-shadow:inset 0 0 0 1.5px var(--paper);border-radius:4px;font-weight:600;color:var(--paper)}
  .ghost:hover{background:var(--carbon2)}
  .plain{text-decoration:underline;text-underline-offset:3px;color:var(--on2);font-size:13px}
  .hard{margin-top:14px;padding:12px 0 2px;border-top:2px solid var(--on2)}
  .hardt{font:600 22px/28px var(--voice)}
  .hard p{margin:4px 0 8px;font-size:15px;line-height:21px;color:var(--on2)}
  .hard .tch{color:var(--paper)}

  .pr{min-width:0;display:flex;flex-direction:column;position:relative}
  .pmeta{flex:none;display:flex;align-items:baseline;gap:18px;font-size:15px;margin-bottom:8px}
  .stake{color:var(--coral);font-weight:700;font-size:15px}
  .pmeta .lnk{color:var(--on2)}
  .keys{margin-left:auto;color:var(--on2);font-size:13px}
  .keys kbd{margin:0 2px 0 0}
  .pscroll{flex:1 1 0;min-height:0;overflow:auto;scrollbar-width:thin;scrollbar-color:var(--on2) transparent;height:0;padding-bottom:22px;-webkit-mask-image:linear-gradient(to bottom,#000 calc(100% - 22px),transparent);mask-image:linear-gradient(to bottom,#000 calc(100% - 22px),transparent)}
  .pr h3{font:600 15px/21px var(--body);color:var(--mint);margin-bottom:6px}
  .evgrid{columns:2;column-gap:24px}
  .ev{break-inside:avoid;margin-bottom:10px;font-size:15px;line-height:21px}
  .ev h4{font-weight:600;font-size:15px}
  .ev p{color:var(--paper)}
  .evm{font-size:13px;line-height:18px;color:var(--on2)}
  .noev{color:var(--on2);font-size:15px}
  .pcols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:24px}
  .draft{background:var(--paper);color:var(--ink);padding:12px 14px 6px;border-radius:2px;align-self:start}
  .pr .draft h3{color:var(--ink);font:600 15px/20px var(--voice);margin-bottom:8px}
  .sent{margin-bottom:9px}
  .sent p{font-size:15px;line-height:21px}
  .cite{font-size:13px;line-height:18px;color:var(--pine)}
  .mem{margin-bottom:12px}
  .memr{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;column-gap:14px;padding:2px 8px;margin:0 -8px;border-radius:3px}
  .memr.cur{background:var(--carbon2)}
  .memb{display:grid;grid-template-columns:150px minmax(0,1fr) 70px;column-gap:10px;padding:3px 0;font-size:15px;line-height:21px;width:100%}
  .memn{font-weight:600}
  .memt{color:var(--on2)}
  .memc{text-align:right}
  .onl{visibility:hidden}
  .memr.cur .onl{visibility:visible}

  .prompt.stop{background:var(--ink)}
  .tab.own.on{background:var(--ink)}
  .prompt.compact{padding:14px 32px}
  .prompt.compact .q{font-size:22px;line-height:28px;margin:6px 0}
  .prompt.compact .choices{margin-top:8px}
  .prompt.compact.hasdraft{min-height:392px}

  .hold{flex:none;padding:12px 32px;background:var(--band);border-top:1px solid var(--rule);color:var(--ink);font-weight:600}
  .hold.wait{background:var(--carbon);color:var(--paper);border-top:0;font-weight:400}
  .toast{position:absolute;left:32px;bottom:44px;background:var(--ink);color:var(--paper);padding:8px 14px;border-radius:4px;font-size:15px;z-index:5}

  .run{padding:10px 0 14px;background:var(--sheet);border-top:3px solid var(--carbon);box-shadow:inset 6px 0 0 var(--pine)}
  .run.failed{box-shadow:inset 6px 0 0 var(--red)}
  .r-line{padding:3px 32px;align-items:baseline}
  .r-allow{padding-bottom:6px}
  .r-allow .r-t{font-size:18px;line-height:26px}
  .r-allow b{font-weight:700}
  .r-t{min-width:0;font-size:18px;line-height:27px;position:relative;grid-column:3}
  .r-d{grid-column:4/-1;font-size:15px;line-height:21px;color:var(--ink2)}
  .r-step .r-t{padding-left:28px}
  .r-step.active .r-t{font-weight:700}
  .mark{position:absolute;left:0;top:5px;color:var(--pine);line-height:0}
  .failed .r-step.failed .mark,.r-step.failed{color:var(--red)}
  .r-step.failed .r-t{font-weight:700}
  .ring{display:block;width:14px;height:14px;border:3px solid var(--pine);border-right-color:transparent;border-radius:50%;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .print{animation:print .24s ease-out both}
  @keyframes print{from{opacity:0;transform:translateY(8px)}}
  .r-left .r-t{font-size:15px;line-height:22px;color:var(--ink2)}
  .r-fail{margin-left:238px;padding:4px 32px 6px;max-width:900px}
  .ft{font-size:18px;line-height:26px;color:var(--ink)}
  .after{margin-left:238px;padding:8px 32px 0}
  .ch{display:grid;grid-template-columns:240px 150px minmax(0,1fr);column-gap:16px;align-items:baseline;padding:2px 0}
  .chl{font-size:15px}
  .chv{font:600 22px/30px var(--voice)}
  .chv .ar{font:400 15px/1 var(--body);color:var(--ink2);margin:0 2px}
  .chn{font-size:13px;line-height:18px;color:var(--ink2)}
  .fin{margin-top:6px;display:flex;flex-direction:column}
  .dl{font-weight:600}
  .whose{font-size:15px;color:var(--ink2)}
  .quiet{margin-top:8px;padding:5px 12px;box-shadow:inset 0 0 0 1.5px var(--ink);border-radius:4px;font-weight:600}
  .quiet:hover{background:var(--band)}

  .foot{flex:none;position:relative;z-index:3;height:34px;display:flex;align-items:center;gap:18px;padding:0 32px;background:var(--band);border-top:3px double var(--ink);font-size:13px;line-height:18px;white-space:nowrap}
  .tiles{display:flex;gap:16px;align-items:center}
  .ti span:first-child{color:var(--ink2)}
  .ti b{font-weight:700}
  .ti.den b{color:var(--red)}
  .fl{color:var(--red);margin-left:5px;font-weight:600;display:inline-flex;align-items:center;gap:2px}
  .ar-t{margin-left:auto;font-weight:600}
  .outage{color:var(--ink2)}

  .ch-head{flex:none;display:flex;align-items:baseline;gap:14px;padding:10px 32px 8px;border-top:2px solid var(--ink)}
  .ch-head h1{font:600 22px/28px var(--voice)}
  .num{font-weight:400}
  .back{font-size:15px;text-decoration:underline;text-underline-offset:3px;color:var(--ink2)}
  .chf{color:var(--ink2)}
  .mv{font-weight:700;font-size:15px;white-space:nowrap}
  .ch-head .mv{margin-left:auto;font-size:15px}
  .mv-you{color:var(--carbon)}
  .mv-agents{color:var(--pine)}
  .mv-payer{color:var(--ink2)}
  .mv-owner{color:var(--ink)}
  .mv-nobody{color:var(--ink2);font-weight:400}
  .ch-sum{flex:none;display:grid;grid-template-columns:auto minmax(0,1fr) 400px;column-gap:28px;padding:6px 32px 10px;background:var(--band)}
  .stakebig{display:flex;flex-direction:column}
  .stakebig b{font:700 28px/34px var(--voice);color:var(--red)}
  .stakebig span{font-size:13px;line-height:18px;color:var(--ink2)}
  .deny p{font-size:15px;line-height:22px}
  .oursinl{color:var(--red);font-weight:700}
  .dlq{font-size:15px;color:var(--ink2)}
  .est{display:flex;flex-wrap:wrap;gap:0 14px;font-size:13px;line-height:20px;color:var(--ink2);align-content:start}
  .est b{color:var(--ink);font-weight:600;font-size:15px}
  .est em{flex-basis:100%;font-style:normal}
  .ch-body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 400px}
  .tlog{min-height:0}
  .tl{display:grid;grid-template-columns:128px 86px minmax(0,1fr);column-gap:16px;padding:5px 12px 5px 32px;align-items:baseline}
  .tl.b{background:var(--band)}
  .tld{display:block;font-size:13px;line-height:18px;color:var(--ink2)}
  .tl.ours{box-shadow:inset 4px 0 0 var(--red)}
  .tl.ours .en{color:var(--red);font-weight:700}
  .tl.denline .en{font-weight:600}
  .tlog .run{box-shadow:inset 6px 0 0 var(--pine)}
  .tlog .r-line{grid-template-columns:128px 86px minmax(0,1fr);column-gap:16px}
  .tlog .r-d{grid-column:3}
  .tlog .after,.tlog .r-fail{margin-left:274px}
  .tlog .r-allow .r-d{display:none}
  .tlog .ch{grid-template-columns:210px 120px minmax(0,1fr)}
  .side{overflow:auto;padding:8px 32px 8px 20px;font-size:15px;line-height:21px;box-shadow:inset 1px 0 0 var(--rule)}
  .side h3{font:600 13px/20px var(--body);margin-bottom:2px}
  .side table{width:100%;border-collapse:collapse;margin-bottom:10px}
  .side th{font-weight:400;font-size:13px;color:var(--ink2);text-align:left;padding:0 6px 2px 0}
  .side td{padding:1px 6px 1px 0}
  .side .r{text-align:right;padding-right:0;padding-left:6px}
  .att span{display:block;font-size:13px;color:var(--ink2)}
  .att b{font-weight:600}

  .dn-head{flex:none;display:flex;align-items:baseline;gap:18px;padding:12px 32px 8px;border-top:2px solid var(--ink)}
  .dn-head h1{font:600 22px/28px var(--voice)}
  .dn-head p{color:var(--ink2)}
  .dn-head .lnk{margin-left:auto;font-size:15px}
  .dn-heads,.drow{display:grid;grid-template-columns:118px 220px minmax(0,1fr) 76px 172px;column-gap:18px}
  .dn-heads{flex:none;padding:4px 32px;font-size:13px;line-height:18px;color:var(--ink2);border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
  .dn-heads .r,.dm{text-align:right}
  .dni{flex:none;margin-bottom:auto}
  .dnlog .day{padding:8px 32px 2px}
  .drow{width:100%;padding:5px 32px;align-items:baseline;font-size:15px;line-height:21px}
  .drow.b{background:var(--band)}
  button.drow:hover{background:var(--rule)}
  .drow.cur{box-shadow:inset 4px 0 0 var(--carbon)}
  .dd b,.dc b{display:block;font-weight:600}
  .dd span,.dc span{display:block;font-size:13px;line-height:18px;color:var(--ink2)}
  .dw>span{display:block}
  .dq{font-size:13px;line-height:18px;color:var(--ink2)}
  .dm{color:var(--red);font-weight:600}
  .dnlog .run{margin-top:6px}

  @media (prefers-reduced-motion:reduce){.prompt.enter,.print,.ring,.beat{animation:none}}
  `

  window.TorchProto.register({
    id: 'e',
    name: 'Run log',
    tagline: 'The agents’ day sheet is the product, and a decision is a sheet of carbon laid over it',
    premise: 'The Inbox is the shift’s running log. Decisions arrive as blocking prompts with three answers: allow once, always allow, deny. Allow one and the run prints line by line where the prompt was.',
    proves: ['R1', 'R2', 'D9', 'A6'],
    serves: 'Demo steps 1, 2, 3, 4',
    fonts: 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:wght@400;500;600;700&family=Besley:wght@500;600;700&display=swap',
    get autoOpen() {
      entries = []; known = {}; lastOpen = null; lastPromptKey = null
      return true
    },
    css,
    render(s, h) {
      h_esc = h.esc
      sync(s, h)
      promptDrawn = false
      const html = s.screen === 'claim' && s.claim ? claimScreen(s, h) : s.screen === 'denials' ? denialsScreen(s, h) : inboxScreen(s, h)
      if (!promptDrawn) lastPromptKey = null
      return html
    },
  })
})()
