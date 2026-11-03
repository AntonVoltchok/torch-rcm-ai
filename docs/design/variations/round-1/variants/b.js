/*
 Variation B: Docked decision.

 Palette (keeps today's identity)
   paper #ffffff, fill #f5f6f7, line #e3e5e9, ink #1d1f23, mid #555b64 (7:1 on white)
   action  Torch blue #2f5bd8, brighter #3265ee on the slab. Clicks only, never decoration.
   agent   teal #0c6e68. Anything an agent did or said.
   risk    #b3261e, #ffb4a8 on the slab. Money at risk and "root cause: ours" only.
   slab    #0f1c3f, the ink of Torch blue. Used for exactly one thing: the decision and its run.

 Type: Inter throughout, as today. Six visible steps: 12 quiet, 13 list, 14 body, 16 lead, 20 dock verb,
 28 headline. 400 reads, 500 labels, 600 means this is the thing. Tabular figures on all money.

 Layout
   +------+----------------------------------------------------------------+
   | nav  | Inbox   12 items: 9 claims, 3 upcoming visits      agents, outage |
   |      | rail: Ready 6  Sent 5  Rejected 2 ... Denied 5  (36px, slim)    |
   |      +-----------------+----------------------------------------------+
   |      | waiting on you  | headline, why, why it came to you, record     |
   |      | Delta group 3   | evidence stays on the page, and scrolls       |
   |      | ...             |                                               |
   |      |                 |##### applies to [All 3][One by one]  at stake #|
   |      |-----------------|##### what happens     [ filled button ]      #|
   | who  | Dr. Morgan      |##### can't be always-run, and why             #|
   +------+-----------------+----------------------------------------------+

 The memorable thing: the slab. It is the only dark surface in the product, and it only ever means
 "this is the decision, here is exactly what it touches". Approve and the slab rises to fill the pane,
 so the same surface streams the run and then hands you Next from the spot the button was in.
 On a blocked item the slab is withheld, which says more than a disabled button.
*/
(function () {
  /* The kit opens mine[0], which is J. Webb's draft. This direction opens on the Delta group, the decision
     the demo is built around, and ⇧A has to work on load, so the selection must be real. Only affects b. */
  const create = TorchProto.createApp
  TorchProto.createApp = (def, el, opts) => {
    const app = create(def, el, opts)
    if (def.id === 'b') {
      const first = window.TORCH_DATA.items.find((i) => i.group_key)
      if (first) { app.perform('select:' + first.id); app.go((opts && opts.screen) || 'inbox') }
    }
    return app
  }

  const FLAG = '<svg class="flag" viewBox="0 0 10 12" width="9" height="11" aria-hidden="true"><path d="M1 0v12M1 1h7.5L6.8 3.6 8.5 6.2H1" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>'
  const TICK = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  const CROSS = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'

  const GLOSSED = /\b(BWX|CO-16|CO-119|PR-119|N29|NEA|ICN|EOB|835|PA)\b/g
  const rich = (t, h) => h.esc(t).replace(GLOSSED, (m) => h.gloss(m))
  const num = (it) => (it.claim ? `<span class="num">#${it.claim.number}</span>` : '<span class="num">visit</span>')
  const label = (it) => (it.claim ? `${it.copy.who} #${it.claim.number}` : it.copy.who)
  const wholeGroup = (g) => Number((String(g.copy.action || '').match(/\d+/) || [])[0]) === g.count
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

  /* Scope. The kit has no scope state, so it is read from what it does keep: selection plus the open group.
     All = the group's top claim, group open. One by one = anything else in the group. */
  function scopeOf(s) {
    const g = s.group
    if (!g || !s.selected) return null
    const whole = wholeGroup(g) && g.count > 1
    return { g, whole, all: whole && g.open && s.selected.id === g.top.id }
  }

  const recordFact = (it, h) => {
    if (it.record) return { head: 'Track record', html: h.esc(it.record).replace(/^(\d+ of \d+)/, '<b>$1</b>') }
    const raw = it.noRecord || ''
    const n = /no base rate \(n = (\d+)\)/.exec(raw)
    if (n) return { head: 'Track record', html: `None yet. Only ${n[1]} past cases, too few to score.` }
    const plain = raw.split(' · ').join(', ')
    return { head: 'Basis', html: h.esc(plain.charAt(0).toUpperCase() + plain.slice(1)) }
  }
  const stakeWord = (it) => (!it.claim ? 'planned' : it.claim.status === 'denied' ? 'at stake' : 'on this claim')
  const rootCauseText = (it) => {
    const note = it.audit_note || ''
    const i = note.indexOf('—')
    return i < 0 ? note : note.slice(i + 1).trim()
  }

  /* shell */
  function nav(s, h) {
    const item = (act, text, on, badge) => `<button class="nv ${on ? 'on' : ''}" data-act="${h.esc(act)}">${h.esc(text)}${badge ? `<span class="badge">${badge}</span>` : ''}</button>`
    const quiet = ["Today's claims", 'Payments', 'Patients', 'Eligibility', 'Activity', 'Settings']
    return `<aside class="side">
      <div class="logo"><svg viewBox="0 0 20 22" width="17" height="19" aria-hidden="true"><path d="M3 1h14a2 2 0 0 1 2 2v9c0 5-4.5 8-9 9.500C5.500 20 1 17 1 12V3a2 2 0 0 1 2-2z" fill="#1d1f23"/></svg>Torch</div>
      <nav data-part="shell.nav" aria-label="Main">
        ${item('nav:inbox', 'Inbox', s.screen === 'inbox', s.strip.inbox_open)}
        ${item('nav:denials', 'Denials', s.screen === 'denials')}
        ${item('open-claim:clm_4821', 'Claims', s.screen === 'claim')}
        <div class="navq">${quiet.map((q) => item('nav:' + q, q, false)).join('')}</div>
      </nav>
      <div class="who" data-part="shell.demo-controls">
        <div class="runs"><span class="agentdot"></span>${plural(s.agents.agents, 'agent')}, ${s.agents.running} running</div>
        <div class="persona" role="group" aria-label="Signed in as">
          ${s.users.map((u) => `<button class="${u.id === s.user.id ? 'on' : ''}" aria-pressed="${u.id === s.user.id}" data-act="user:${u.id}">${h.esc(u.name)}</button>`).join('')}
        </div>
        <div class="clock">${h.esc(s.user.title)}<br>Harbor Dental<br>Wed ${h.date(s.clock.now)}, ${h.time(s.clock.now)}</div>
      </div>
    </aside>`
  }

  function rail(s, h) {
    return `<div class="rail" data-part="shell.pipeline">
      <div class="railsum"><b>${s.strip.open_count}</b> open <b>${h.money(s.strip.ar_cents)}</b> in A/R</div>
      <div class="tiles">
        ${s.strip.tiles.map((t) => {
          const inner = `<span>${h.esc(t.label)}</span><b>${t.count}</b>${t.flagged ? `<i title="${plural(t.flagged, 'claim')} need action">${FLAG}${t.flagged}</i>` : ''}`
          return t.status === 'denied' ? `<button class="tile denied" data-act="nav:denials">${inner}</button>` : `<div class="tile">${inner}</div>`
        }).join('')}
      </div>
      <div class="railflag">${FLAG}${s.strip.flagged_count} need action</div>
    </div>`
  }

  function header(s, h, left) {
    return `<header class="top">
      <div class="topl" data-part="shell.header">${left}</div>
      <div class="week" data-part="shell.agent-summary">Agents ran <b>${s.week.ranAlone}</b> alone this week. <b>${s.week.cameToYou}</b> came to you.</div>
      <div class="outage" data-part="shell.outage"><span class="odot"></span>${h.esc(s.outage)}</div>
    </header>`
  }

  /* queue */
  function itemRow(s, h, it, act) {
    const on = s.selected && s.selected.id === it.id
    return `<button class="row ${on ? 'on' : ''}" ${act === null ? '' : `data-act="${h.esc(act || 'select:' + it.id)}"`} data-part="inbox.queue-row" ${on ? 'aria-current="true"' : ''}>
      <span class="r1"><b>${h.esc(it.copy.who)}</b>${num(it)}<span class="amt">${h.money(it.cents)}</span></span>
      <span class="r2">${h.esc(it.copy.headline)}</span>
    </button>`
  }

  function groupRow(s, h, g) {
    const sc = scopeOf(s)
    const current = sc && sc.g.key === g.key
    const whole = wholeGroup(g)
    const title = whole ? g.copy.headline : `${g.top.copy.headline}, ${g.count} left`
    return `<div class="grp ${current ? 'cur' : ''} ${current && sc.all ? 'all' : ''}" data-part="inbox.group">
      <button class="grph" ${current && sc.all ? '' : `data-act="select:${g.top.id}"`}>
        <span class="r2 strong">${h.esc(title)}</span>
        <span class="amt">${h.money(g.cents)}</span>
      </button>
      ${current ? g.items.map((m) => {
        const on = !sc.all && s.selected.id === m.id
        const isTop = m.id === g.top.id
        const act = on ? null : sc.all && isTop ? 'group:' + g.key : 'select:' + m.id
        return `<button class="mem ${on ? 'on' : ''}" ${act ? `data-act="${h.esc(act)}"` : ''} data-part="inbox.queue-row">
          <span class="r1"><b>${h.esc(m.copy.who)}</b>${num(m)}<span class="tx">${h.esc(m.copy.treatment)}</span><span class="amt">${h.money(m.cents)}</span></span>
        </button>`
      }).join('') : ''}
    </div>`
  }

  function queue(s, h) {
    const rows = s.queue.filter((q) => q.type === 'group' || s.canAct(q.item))
    const ordered = [...rows.filter((q) => q.type === 'group'), ...rows.filter((q) => q.type !== 'group')]
    return `<section class="queue" data-part="inbox.queue" aria-label="Queue">
      <div class="qhead">
        <h2>Waiting on you <span>${s.mine.length}</span><em class="keys" data-part="inbox.keyboard"><kbd>J</kbd><kbd>K</kbd> to move</em></h2>
        <div class="tabs" role="group" aria-label="Filter">
          ${s.tabs.map((t) => `<button class="${t.key === s.filter ? 'on' : ''}" aria-pressed="${t.key === s.filter}" data-act="filter:${t.key}">${h.esc(t.label)} ${t.count}</button>`).join('')}
        </div>
      </div>
      <div class="qlist" data-scroll="queue">
        ${ordered.length ? ordered.map((q) => (q.type === 'group' ? groupRow(s, h, q) : itemRow(s, h, q.item))).join('') : '<p class="none">Nothing here for this filter.</p>'}
      </div>
      ${s.waitingOnOwner.length ? `<div class="owner">
        <h2>Waiting on Dr. Morgan <span>${s.waitingOnOwner.length}</span></h2>
        ${s.waitingOnOwner.map((it) => `<button class="row own ${s.selected && s.selected.id === it.id ? 'on' : ''}" data-act="select:${it.id}" data-part="inbox.queue-row">
          <span class="r1"><b>${h.esc(it.copy.who)}</b>${num(it)}<span class="amt">${h.money(it.cents)}</span></span>
          <span class="r2">Dr. Morgan signs this</span>
        </button>`).join('')}
      </div>` : ''}
    </section>`
  }

  /* reading area */
  function overline(s, h, it, blocked) {
    return `<div class="over">
      ${blocked ? '<span class="mv payer">Waiting on Dr. Morgan</span>' : '<span class="mv you">Waiting on you</span>'}
      <span class="agent"><span class="agentdot"></span>${h.esc(h.agentName(it.agent))} agent</span>
      ${it.tier ? `<span class="tier">${h.gloss('T' + it.tier)}</span>` : ''}
    </div>`
  }

  function facts(s, h, it, stoppedBy) {
    const due = it.deadline_on
    const rec = recordFact(it, h)
    return `<div class="facts">
      <div data-part="inbox.why-stopped"><h3>Why it came to you</h3><p>${h.esc(stoppedBy)}</p></div>
      <div class="wider" data-part="inbox.recommendation"><h3>${rec.head}</h3><p>${rec.html}</p></div>
      ${due ? `<div><h3>Deadline</h3><p>Due ${h.dateYear(due)}, ${h.daysUntil(due)} days left</p></div>` : ''}
    </div>`
  }

  function rootCause(h, it) {
    if (it.root_cause !== 'ours') return ''
    return `<p class="ours"><b>Root cause: ours.</b> ${rich(rootCauseText(it), h)}</p>`
  }

  function evidence(h, it) {
    if (!it.evidence.length) return `<section class="ev" data-part="inbox.evidence"><h3>Evidence</h3><p class="none">Nothing to show. ${h.esc(it.copy.why)}</p></section>`
    return `<section class="ev" data-part="inbox.evidence"><h3>Evidence the agent read</h3>
      <ul>${it.evidence.map((e) => `<li>
        <div class="evh"><b>${h.esc(e.title)}</b><span>${h.date(e.captured_at)}, ${h.time(e.captured_at)}${e.ref ? `, ${h.esc(e.ref)}` : ''}</span></div>
        <p>${h.esc(e.excerpt)}</p>
      </li>`).join('')}</ul></section>`
  }

  function draft(h, it) {
    if (!it.draft) return ''
    return `<section class="draft" data-part="inbox.draft">
      <h3>The note ${h.esc(h.agentName(it.agent))} agent wrote. Delta reads exactly this.</h3>
      <ol>${it.draft.map((d) => `<li><p>${h.esc(d.text)}</p><span class="cite">${d.cites.length ? d.cites.map((c) => h.esc(c)).join('<br>') : 'A request, nothing to cite'}</span></li>`).join('')}</ol>
    </section>`
  }

  function groupBody(s, h, g) {
    const top = g.top
    const rep = g.items.map((m) => m.evidence.find((e) => e.kind === 'rep_call')).find(Boolean)
    return `<div class="read" data-scroll="detail-group">
      <div data-part="inbox.decision">
        ${overline(s, h, top, false)}
        <h1>${h.esc(g.copy.headline)}</h1>
        <p class="whyp">${rich(g.copy.why, h)}</p>
      </div>
      ${facts(s, h, top, g.copy.stoppedBy)}
      ${rootCause(h, top)}
      <section class="ev" data-part="inbox.evidence">
        <h3>The ${g.count} claims in this decision</h3>
        <ul class="claims">${g.items.map((m) => {
          const pa = m.evidence.find((e) => e.kind === 'pms_record')
          const era = m.evidence.find((e) => e.kind === 'era_line')
          return `<li>
            <div class="cwho"><button class="link" data-act="open-claim:${m.claim.id}"><b>${h.esc(m.copy.who)}</b> #${m.claim.number}</button><span>${h.esc(m.copy.treatment)}</span><span class="tn">${h.money(m.cents)}</span></div>
            <div class="cev">${pa ? `<p><b>${h.esc(pa.title)}.</b> ${h.esc(pa.excerpt)}</p>` : ''}${era ? `<p><b>${h.esc(era.title)}.</b> ${h.esc(era.excerpt)}</p>` : ''}</div>
          </li>`
        }).join('')}</ul>
        ${rep ? `<p class="rep"><b>${h.esc(rep.title)}.</b> ${h.esc(rep.excerpt)}</p>` : ''}
      </section>
    </div>`
  }

  function itemBody(s, h, it, blocked) {
    const claimBtn = it.claim ? `<button class="link open" data-act="open-claim:${it.claim.id}">Open claim #${it.claim.number}</button>` : ''
    return `<div class="read" data-scroll="detail-${it.id}">
      <div data-part="inbox.decision">
        ${overline(s, h, it, blocked)}
        <div class="subj"><b>${h.esc(it.copy.who)}</b>${it.claim ? ` #${it.claim.number}` : ''}<span>${h.esc(it.copy.treatment)}</span>${claimBtn}</div>
        <h1>${h.esc(it.copy.headline)}</h1>
        <p class="whyp">${rich(it.copy.why, h)}</p>
      </div>
      ${facts(s, h, it, it.copy.stoppedBy)}
      ${rootCause(h, it)}
      ${draft(h, it)}
      ${evidence(h, it)}
    </div>`
  }

  /* the dock */
  function policyPanel(s, h, it, onSlab) {
    const p = h.policy(it)
    if (!p) return ''
    const pv = p.preview
    const verdict = p.canLearn
      ? `Can be always-run.`
      : `Can't be always-run.${it.root_cause === 'ours' ? ' Root cause is ours.' : ''}`
    return `<details class="pol ${p.canLearn ? 'can' : 'cant'}" data-part="inbox.policy">
      <summary><span class="polv">${h.esc(verdict)}</span><span class="polm">${pv ? `${pv.from} → ${pv.to} of ${pv.total} would have run, ${pv.held} held, net ${pv.net}` : h.esc(p.rule) + ' rule'}</span><span class="polw">See why</span><span class="polc" aria-hidden="true"></span></summary>
      <div class="polbody">
        <p><b>${h.esc(p.rule)} rule.</b> ${h.esc(p.reason)}</p>
        ${pv ? `<div class="meter" role="img" aria-label="${pv.from} of ${pv.total} ran alone, ${pv.held} held">
            <span class="ran" style="width:${(pv.from / pv.total) * 100}%"></span><span class="held" style="width:${(pv.held / pv.total) * 100}%"></span>
          </div>
          <p class="quiet">Always-run would add ${pv.held}, but all ${pv.held} are held for review, so the week stays at ${pv.net} of ${pv.total}.</p>`
        : `<button class="ghost" data-act="nav:Settings">Change this rule in Settings</button>`}
      </div>
    </details>`
  }

  function scopeControl(h, sc, it) {
    const { g } = sc
    return `<div class="scope"><span class="dl">Applies to</span>
      <div class="seg" role="radiogroup" aria-label="Scope">
        <button role="radio" aria-checked="${sc.all}" class="${sc.all ? 'on' : ''}" ${sc.all ? '' : `data-act="select:${g.top.id}"`}>All ${g.count} claims</button>
        <button role="radio" aria-checked="${!sc.all}" class="${sc.all ? '' : 'on'}" ${sc.all ? `data-act="group:${h.esc(g.key)}"` : ''}>${sc.all ? 'One by one' : `One by one: ${h.esc(label(it))}`}</button>
      </div></div>`
  }

  function dock(s, h, it, sc, ctx) {
    const blocked = !s.canAct(it)
    if (blocked) {
      return `<section class="dock held" data-part="inbox.action-bar">
        <div class="heldl">
          <h2>Dr. Morgan signs this</h2>
          <p>${h.esc(it.copy.signerNote || it.copy.stoppedBy)}</p>
          <ul class="touch">${(it.copy.touches || []).map((t) => `<li>${h.esc(t)}</li>`).join('')}</ul>
        </div>
        <button class="ghost dark" data-act="user:usr_morgan">Switch to Dr. Morgan</button>
      </section>`
    }
    const all = sc && sc.all
    const copy = all ? sc.g.copy : it.copy
    const act = all ? `approve-group:${sc.g.key}` : `approve:${it.id}`
    const cents = all ? sc.g.cents : it.cents
    const word = stakeWord(it)
    const left = sc && sc.g.count > 1 && !sc.whole ? `One by one. ${sc.g.count} left in this group.` : null
    const scoped = ctx === 'denials'
      ? `<div class="scope"><span class="dl">Applies to</span><span class="dstrong">All ${sc.g.count} claims marked above</span></div>`
      : ctx === 'claim'
        ? `<div class="scope"><span class="dl">Applies to</span><span class="dstrong">This claim only</span>${it.group_key ? `<button class="ghostlink" data-act="select:${it.id}">Open in Inbox to see its group</button>` : ''}</div>`
        : sc && sc.whole ? scopeControl(h, sc, it)
          : `<div class="scope"><span class="dl">Applies to</span><span class="dstrong">${h.esc(label(it))}</span>${left ? `<span class="dnote">${h.esc(left)}</span>` : ''}</div>`
    return `<section class="dock" data-part="inbox.action-bar">
      <div class="dtop">${scoped}<div class="stake ${word === 'at stake' ? 'risk' : ''}"><b>${h.money(cents)}</b> ${word}</div></div>
      <div class="dmid">
        <div class="does"><span class="dl">What happens</span>
          <ul class="touch">${(copy.touches || []).map((t) => `<li class="${/recalled/i.test(t) ? 'hard' : ''}">${h.esc(t)}</li>`).join('')}</ul>
        </div>
        <div class="go">
          <button class="primary" data-act="${h.esc(act)}">${h.esc(copy.action)}<kbd>${all ? '⇧A' : 'A'}</kbd></button>
          ${all || ctx === 'denials' ? '' : `<div class="minor"><button data-act="reject:${it.id}">Reject</button><button data-act="snooze:${it.id}">Snooze</button></div>`}
        </div>
      </div>
      ${policyPanel(s, h, it, true)}
    </section>`
  }

  /* run, after, failure */
  function runPane(s, h, foot) {
    const r = s.run
    const entering = r.steps[0] && r.steps[0].state === 'active' && !r.done
    const stopped = r.steps.findIndex((x) => x.state === 'failed')
    const state = r.failed ? `Stopped at step ${stopped + 1} of ${r.steps.length}` : r.done ? 'Finished' : 'Running'
    const change = (c) => (c.from === c.to
      ? `<li><div class="big"><span>${h.esc(c.label)} stays</span> <b>${c.to}</b></div>${c.note ? `<p>${h.esc(c.note)}</p>` : ''}</li>`
      : `<li><div class="big"><span>${h.esc(c.label)}</span> <b>${c.from} → ${c.to}</b></div>${c.note ? `<p>${h.esc(c.note)}</p>` : ''}</li>`)
    return `<section class="slab ${entering ? 'rise' : ''} ${r.failed ? 'failed' : ''}" data-part="inbox.run">
      <div class="runh">
        <p class="runs2 ${r.done ? '' : 'live'}">${h.esc(state)}</p>
        <h1>${h.esc(r.title)}</h1>
        ${r.failed ? `<p class="fail">${h.esc(r.failedText)}</p>` : r.done ? `<p class="doneline">${h.esc(r.doneLine)}</p>` : ''}
      </div>
      <ol class="steps">${r.steps.map((x) => `<li class="st ${x.state}">
        <span class="mark">${x.state === 'done' ? TICK : x.state === 'failed' ? CROSS : ''}</span>
        <div><p>${h.esc(x.text)}</p>${x.detail && x.state === 'done' ? `<span class="dt">${h.esc(x.detail)}</span>` : ''}</div>
      </li>`).join('')}</ol>
      ${r.done ? `<section class="after" data-part="inbox.after-state"><h2>What changed</h2><ul>${r.changes.map(change).join('')}</ul></section>` : ''}
      <div class="runfoot">
        ${r.done ? foot(r) : '<p class="wait">Next appears here when this finishes.</p>'}
      </div>
    </section>`
  }

  function nextFoot(s, h) {
    return (r) => {
      const n = s.nextItem
      const g = n && n.group_key ? s.queue.find((q) => q.key === n.group_key) : null
      const name = n ? (g && g.count > 1 ? `${label(n)} and ${g.count - 1} more` : label(n)) : null
      const back = r.failed ? `<button class="ghost" data-act="select:${r.ids[0]}">Back to this item</button>` : ''
      return n
        ? `${back}<button class="primary" data-act="next">Next: ${h.esc(name)}</button>`
        : `${back}<button class="primary" data-act="dismiss">Done</button>`
    }
  }

  function empty(s, h) {
    const n = s.nextItem
    return `<div class="empty" data-part="inbox.empty">
      ${n ? `<h1>Next up: ${h.esc(label(n))}</h1><p>${h.esc(n.copy.headline)}</p><button class="primary light" data-act="next">Open it</button>`
        : `<h1>Nothing is waiting on you</h1><p>${s.waitingOnOwner.length ? `${plural(s.waitingOnOwner.length, 'item')} still with Dr. Morgan.` : 'The agents will bring you the next one.'}</p>`}
    </div>`
  }

  /* screens */
  function inbox(s, h) {
    let pane
    if (s.run && !s.run.done) pane = runPane(s, h, nextFoot(s, h))
    else if (s.selected) {
      const it = s.selected
      const sc = scopeOf(s)
      const blocked = !s.canAct(it)
      const body = sc && sc.all ? groupBody(s, h, sc.g) : itemBody(s, h, it, blocked)
      pane = `<div class="detail">${body}${dock(s, h, it, sc)}</div>`
    } else if (s.run) pane = runPane(s, h, nextFoot(s, h))
    else pane = empty(s, h)
    const left = `<h1 class="pt">Inbox</h1><span class="rec">${s.strip.inbox_open} items: ${plural(s.reconcile.claims, 'claim')}, ${plural(s.reconcile.visits, 'upcoming visit')}</span>`
    return `${header(s, h, left)}${rail(s, h)}<div class="ibody ${s.run && !s.run.done ? 'busy' : ''}">${queue(s, h)}${pane}</div>`
  }

  function claimScreen(s, h) {
    const c = s.claim
    const cl = c.claim
    const queued = c.queued
    const signer = c.openItems.some((i) => !s.canAct(i))
    const mv = queued ? { who: 'agents', label: 'With the agents' } : signer ? { who: 'payer', label: 'Waiting on Dr. Morgan' } : h.move(cl)
    const left = `<button class="back" data-act="back">Back</button><h1 class="pt">Claim #${cl.number}</h1><span class="rec">${h.esc(cl.patient.display_name)}, ${h.esc(cl.payer.short_name)}</span><span class="mv ${mv.who}">${h.esc(mv.label)}</span>`
    if (s.run && (!s.run.done || s.run.ids.some((id) => (c.open_inbox_items || []).some((i) => i.id === id)))) {
      return `${header(s, h, left)}${rail(s, h)}<div class="wide">${runPane(s, h, () => '<button class="primary" data-act="dismiss">Back to the claim</button>')}</div>`
    }
    const m = c.money
    const est = m && /estimate/i.test(m.basis || '')
    const tag = est ? ' <em>est.</em>' : ''
    const d = c.denial
    const dl = c.deadline && c.deadline.due_on ? c.deadline : null
    const tl = [...c.timeline].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    const open = c.openItems[0]
    const rc = tl.find((t) => t.kind === 'root_cause')
    const rcText = rc ? rc.title.split(' — ').slice(1).join(' ') : ''
    const adj = (l) => (l.adj || []).map((a) => `${a.group}-${a.code} ${h.money(a.cents)}`).join(', ') || 'None'
    return `${header(s, h, left)}${rail(s, h)}<div class="cbody">
      <div class="ccols" data-scroll="claim-${cl.id}">
        <div class="cmain">
          <section class="cstake" data-part="claim.header">
            <p class="csub">${h.esc(cl.procedures)}, seen ${h.dateYear(cl.dos)}, ${h.esc(c.provider_name)}. ${h.esc(c.coverage ? c.coverage.plan_name : cl.payer.name)}. ICN ${h.esc(cl.icn || 'not yet assigned')}.</p>
            <div class="stakeb" data-part="claim.denial">
              <div><b class="${d ? 'risk' : ''}">${h.money(cl.billed_cents)}</b><span>${d ? 'at stake' : 'billed'}</span></div>
              ${dl ? `<div><b>${h.dateYear(dl.due_on)}</b><span>${h.esc(dl.kind.replace(/_/g, ' '))} due, ${h.daysUntil(dl.due_on)} days left. ${h.esc(dl.basis)}</span></div>` : ''}
            </div>
            ${d ? `<p class="whyp">${h.gloss(d.carc)}${d.rarc ? ', ' + h.gloss(d.rarc) : ''}. ${h.esc(d.decoded)}.</p>` : `<p class="whyp">${h.esc(cl.reason || '')}</p>`}
            ${d && d.root_cause === 'ours' ? `<p class="ours"><b>Root cause: ours.</b> ${rich(rcText.charAt(0).toUpperCase() + rcText.slice(1), h)}</p>` : ''}
            ${queued ? `<p class="queued">${h.esc(queued)}</p>` : ''}
          </section>
          <section data-part="claim.timeline"><h3>The whole story, newest first</h3>
            <ol class="tl">${tl.map((t) => `<li class="l-${t.lane} ${t.kind === 'root_cause' ? 'rc' : ''}">
              <span class="tdot"></span><div>
                <span class="tt">${h.date(t.at)}, ${h.time(t.at)}, ${t.lane === 'agent' ? 'agent' : t.lane === 'payer' ? 'payer' : 'system'}</span>
                <p>${h.esc(t.title.replace(/ — (.)/, (m, c) => '. ' + c.toUpperCase()))}</p>
                ${t.detail ? `<span class="td">${h.esc(t.detail)}</span>` : ''}
              </div></li>`).join('')}</ol>
          </section>
        </div>
        <aside class="cside">
          ${m ? `<section data-part="claim.money"><h3>Money</h3>
            <dl class="mny">
              <div><dt>Billed</dt><dd>${h.money(m.billed_cents)}</dd></div>
              <div><dt>Paid</dt><dd>${h.money(m.paid_cents)}</dd></div>
              <div><dt>Allowed${tag}</dt><dd>${h.money(m.allowed_cents)}</dd></div>
              <div><dt>Patient${tag}</dt><dd>${h.money(est ? m.patient_est_cents : m.patient_resp_cents)}</dd></div>
            </dl>
            ${est ? `<p class="quiet">Allowed and Patient are estimates from the ${h.esc(c.coverage ? c.coverage.plan_name : 'plan')} contract. ${h.esc(cl.payer.short_name)} has not paid this claim.</p>` : ''}
          </section>` : ''}
          <section data-part="claim.lines"><h3>Line items</h3>
            <table class="lines"><thead><tr><th>CDT</th><th>Tooth</th><th class="n">Billed</th><th class="n">Paid</th><th>Adjustment</th></tr></thead>
            <tbody>${c.lines.map((l) => `<tr><td>${h.esc(l.cdt)}</td><td>${h.esc(l.tooth || '')}</td><td class="n">${h.money(l.fee_cents)}</td><td class="n">${h.money(l.paid_cents)}</td><td>${h.esc(adj(l))}</td></tr>`).join('')}</tbody></table>
          </section>
          <section data-part="claim.side"><h3>Attachments and acknowledgments</h3>
            <ul class="acks">
              ${c.attachments.map((a) => `<li><span>${h.gloss(a.kind.toUpperCase())}${a.note ? `, ${h.esc(a.note)}` : ''}</span><time>${h.date(a.created_at)}</time></li>`).join('')}
              ${c.acks.map((a) => `<li><span>${h.esc(a.message)}</span><time>${h.date(a.at)}</time></li>`).join('')}
            </ul>
          </section>
        </aside>
      </div>
      ${open ? `<div class="cdock" data-part="claim.open-item">${dock(s, h, open, null, 'claim')}</div>` : ''}
    </div>`
  }

  function denials(s, h) {
    const denied = s.strip.tiles.find((t) => t.status === 'denied')
    const left = `<h1 class="pt">Denials</h1><span class="rec" data-part="denials.summary">${denied.count} denied, ${h.money(denied.cents)}. ${s.denials.in_flight.length} in flight.</span>`
    const allRows = s.denials.groups.flatMap((x) => x.rows)
    if (s.run && (!s.run.done || s.run.ids.some((id) => allRows.some((r) => r.inbox_item_id === id)))) {
      return `${header(s, h, left)}${rail(s, h)}<div class="wide">${runPane(s, h, () => '<button class="primary" data-act="dismiss">Back to Denials</button>')}</div>`
    }
    const g = s.queue.find((q) => q.type === 'group' && wholeGroup(q))
    const firstRow = allRows.find((r) => r.item && !r.resolved && s.canAct(r.item))
    const inDock = g ? g.items.map((m) => m.id) : firstRow ? [firstRow.item.id] : []
    const dockHtml = g
      ? dock(s, h, g.top, { g, whole: true, all: true }, 'denials')
      : firstRow ? dock(s, h, firstRow.item, null, 'claim') : ''
    return `${header(s, h, left)}${rail(s, h)}<div class="dbody">
      <div class="dtable" data-scroll="denials">
        <div class="dcols" aria-hidden="true"><span>Claim</span><span>Why it was denied</span><span class="n">At stake</span><span>Deadline</span><span>If we lose</span><span>Whose move</span></div>
        ${s.denials.groups.map((grp) => {
          const [name, ...rest] = grp.label.split(' · ')
          return `<section><h2 class="dg">${h.esc(name)} <span>${h.esc(rest.join(', '))}. ${plural(grp.count, 'claim')}, ${h.money(grp.cents)}</span></h2>
          ${grp.rows.map((r) => {
            const it = r.item
            const blocked = it && !s.canAct(it)
            const mv = r.resolved ? { who: 'agents', label: 'With the agents' } : h.move(r.claim)
            const dl = r.deadline && r.deadline.due_on
            return `<div class="drow ${it && inDock.includes(it.id) ? 'marked' : ''}" data-part="denials.row">
              <div><button class="link" data-act="open-claim:${r.claim.id}"><b>${h.esc(r.claim.patient.display_name)}</b> #${r.claim.number}</button><span class="sub">${h.esc(it ? it.copy.treatment : r.claim.procedures)}, ${h.esc(r.claim.payer.short_name)}</span></div>
              <div><span>${h.gloss(r.carc)}${r.rarc ? ', ' + h.gloss(r.rarc) : ''}. ${h.esc(r.decoded)}.</span>${r.root_cause === 'ours' ? '<span class="tagours">Root cause: ours</span>' : ''}</div>
              <div class="n tn">${h.money(r.claim.billed_cents)}</div>
              <div data-part="denials.deadline">${dl ? `<b>${h.daysUntil(dl)} days</b><span class="sub">${h.esc(r.deadline.kind)} due ${h.dateYear(dl)}</span>` : '<span class="sub">No deadline</span>'}</div>
              <div>${r.patient_billable_if_lost ? '<span class="sub">Patient can be billed</span>' : '<span class="lose">Patient cannot be billed</span>'}</div>
              <div data-part="denials.action">${blocked
                ? `<button class="link" data-act="select:${it.id}"><b>Dr. Morgan signs this</b></button><span class="sub">Tier 3, human only</span>`
                : `<span class="mv ${mv.who}">${h.esc(mv.label)}</span>${it && !r.resolved && !inDock.includes(it.id) ? `<button class="link sub" data-act="select:${it.id}">Open in Inbox</button>` : ''}`}</div>
            </div>`
          }).join('')}</section>`
        }).join('')}
      </div>
      ${dockHtml ? `<div class="cdock">${dockHtml}</div>` : ''}
    </div>`
  }

  TorchProto.register({
    id: 'b',
    name: 'Docked decision',
    tagline: 'One dark dock says exactly what will happen, then becomes the run',
    keyApprove: (s) => { const sc = scopeOf(s); return sc && sc.all ? 'approve-group:' + sc.g.key : 'approve:' + s.selected.id },
    premise: 'The first thing you can act on is already open, with one dock that names the scope, what it touches and the one button. Approve, and the dock rises to fill the pane and streams the run.',
    proves: ['A1', 'A2', 'A3', 'A6'],
    serves: 'Demo steps 1, 2, 3',
    fonts: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap',
    autoOpen: true,
    css: `
      :host{--paper:#fff;--fill:#f5f6f7;--line:#e3e5e9;--ink:#1d1f23;--mid:#555b64;--acc:#2f5bd8;--acc-bg:#edf2fe;--acc-line:#c5d3f7;--agent:#0c6e68;--risk:#b3261e;--risk-bg:#fdecea;--amber:#b97a00;--slab:#0f1c3f;--slab2:#1b2c58;--on:#fff;--on2:#c7d1e8;--on3:#a4b3d3;--onl:rgba(255,255,255,.16);--go:#3265ee;--riskon:#ffb4a8}
      .app{width:1440px;height:900px;overflow:hidden;background:var(--paper);color:var(--ink);display:grid;grid-template-columns:176px 1fr;font-family:Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.45;font-feature-settings:'cv11','ss03';-webkit-font-smoothing:antialiased;position:relative}
      button{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;text-align:left;cursor:pointer}
      button:not([data-act]){cursor:default}
      button:focus-visible,summary:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
      h1,h2,h3,p,ul,ol,dl,dd{margin:0;padding:0}ul,ol{list-style:none}
      abbr{color:inherit}
      .tn,.amt,.n,.badge,.tile b,.stake b{font-variant-numeric:tabular-nums}
      kbd{font:500 12px Inter,sans-serif;padding:1px 6px;border-radius:4px;background:rgba(255,255,255,.2);color:#fff;margin-left:10px}

      .side{background:var(--fill);border-right:1px solid var(--line);display:flex;flex-direction:column;padding:14px 10px 12px;min-height:0}
      .logo{display:flex;gap:8px;align-items:center;font-size:20px;font-weight:600;padding:2px 8px 18px;letter-spacing:-.01em}
      .nv{display:flex;width:100%;justify-content:space-between;align-items:center;padding:6px 8px;border-radius:6px;font-size:14px;font-weight:500;color:var(--ink)}
      .nv:hover{background:#ebedef}.nv.on{background:var(--paper);box-shadow:0 0 0 1px var(--line);font-weight:600}
      .navq{margin-top:14px}.navq .nv{font-size:13px;font-weight:400;color:var(--mid);padding:4px 8px}
      .badge{font-size:12px;font-weight:600;color:#fff;background:var(--acc);padding:0 7px;border-radius:9px}
      .who{margin-top:auto;display:grid;gap:8px;padding:0 4px}
      .runs{font-size:13px;color:var(--agent);font-weight:500;display:flex;align-items:center;gap:6px}
      .agentdot{width:7px;height:7px;border-radius:50%;background:var(--agent);display:inline-block;flex:none}
      .persona{display:grid;grid-template-columns:1fr 1fr;background:#e7e9ec;border-radius:6px;padding:2px}
      .persona button{font-size:12px;padding:3px 0;text-align:center;border-radius:5px;color:var(--mid);white-space:nowrap}
      .persona button.on{background:var(--paper);color:var(--ink);font-weight:600}
      .clock{font-size:12px;color:var(--mid);line-height:1.4}

      .main{display:grid;grid-template-rows:52px 36px minmax(0,1fr);min-width:0;min-height:0;position:relative}
      .top{display:flex;align-items:center;gap:28px;padding:0 24px;min-width:0}
      .topl{display:flex;align-items:baseline;gap:12px;margin-right:auto;white-space:nowrap}
      .pt{font-size:20px;font-weight:600;letter-spacing:-.01em}
      .rec{font-size:13px;color:var(--mid)}
      .back{font-size:13px;font-weight:500;color:var(--acc)}
      .topl .mv{margin-left:4px}
      .week{font-size:13px;color:var(--mid);white-space:nowrap}.week b{color:var(--agent);font-weight:600}
      .outage{font-size:13px;color:var(--mid);white-space:nowrap;display:flex;align-items:center;gap:6px}
      .odot{width:7px;height:7px;border-radius:50%;background:var(--amber)}

      .rail{display:flex;align-items:center;gap:16px;padding:0 24px;background:var(--fill);border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:13px;white-space:nowrap}
      .railsum{color:var(--mid)}.railsum b{color:var(--ink);font-weight:600}
      .tiles{display:flex;flex:1;justify-content:space-between;gap:6px;margin:0 8px}
      .tile{display:inline-flex;gap:5px;align-items:center;color:var(--mid);font-size:13px;padding:2px 6px;border-radius:5px}
      .tile b{font-weight:600;color:var(--ink)}
      .tile i{font-style:normal;font-weight:600;color:var(--risk);display:inline-flex;gap:3px;align-items:center}
      .tile.denied:hover{background:#e7e9ec}
      .railflag{color:var(--risk);font-weight:500;display:inline-flex;align-items:center;gap:4px}
      .flag{flex:none}

      .ibody{display:grid;grid-template-columns:368px minmax(0,1fr);min-height:0}
      .queue{display:flex;flex-direction:column;border-right:1px solid var(--line);min-height:0}
      .ibody.busy .queue{opacity:.7;pointer-events:none}
      .qhead{padding:12px 16px 8px;border-bottom:1px solid var(--line)}
      .qhead h2,.owner h2{font-size:14px;font-weight:600}
      .qhead h2 span,.owner h2 span{color:var(--mid);font-weight:400}
      .qhead h2{display:flex;gap:6px;align-items:baseline}
      .keys{margin-left:auto;font-style:normal;font-size:12px;font-weight:400;color:var(--mid)}
      .keys kbd{background:var(--fill);color:var(--mid);box-shadow:inset 0 0 0 1px var(--line);margin:0 3px 0 0;padding:0 5px}
      .tabs{display:flex;gap:12px;margin-top:4px;white-space:nowrap}
      .tabs button{font-size:13px;color:var(--mid);padding:1px 0;border-bottom:2px solid transparent}
      .tabs button.on{color:var(--ink);border-color:var(--ink)}
      .qlist{flex:1;overflow:auto;min-height:0}
      .row{display:block;width:100%;padding:10px 16px;border-bottom:1px solid var(--line)}
      .row:hover,.mem:hover,.grph:hover{background:var(--fill)}
      .row.on,.mem.on{background:var(--acc-bg);box-shadow:inset 3px 0 0 var(--acc)}
      .r1{display:flex;align-items:baseline;gap:6px;font-size:14px}
      .r1 b{font-weight:600}.num{color:var(--mid);font-size:13px}
      .amt{margin-left:auto;font-size:14px;font-weight:500;padding-left:8px}
      .r2{display:block;font-size:13px;color:var(--mid);line-height:1.35;margin-top:1px}
      .r2.strong{color:var(--ink);font-size:14px;font-weight:600;margin:0;line-height:1.3}
      .grp{border-bottom:1px solid var(--line)}
      .grph{display:flex;gap:12px;width:100%;padding:10px 16px;align-items:flex-start}
      .grp.all{background:var(--acc-bg);box-shadow:inset 3px 0 0 var(--acc)}
      .grp.all .grph:hover,.grp.all .mem:hover{background:none}
      .mem{display:block;width:100%;padding:6px 16px 6px 28px;border-top:1px solid var(--line)}
      .grp.all .mem{border-top-color:var(--acc-line)}
      .mem .tx{font-size:13px;color:var(--mid);white-space:nowrap}
      .owner{border-top:2px solid var(--line);background:var(--fill)}
      .owner h2{padding:10px 16px 2px}
      .own{border-bottom:0;padding-top:2px}
      .own .r2{color:var(--ink);font-weight:500}
      .none{padding:14px 16px;color:var(--mid);font-size:13px}

      .detail{display:flex;flex-direction:column;min-height:0;min-width:0}
      .read{flex:1;min-height:0;overflow:auto;padding:16px 28px 20px}
      .over{display:flex;align-items:center;gap:14px;font-size:13px;margin-bottom:6px}
      .mv{font-size:13px;font-weight:500;white-space:nowrap}
      .mv.you{color:var(--ink);font-weight:600}.mv.agents{color:var(--agent)}.mv.payer,.mv.nobody{color:var(--mid)}
      .agent{color:var(--agent);display:inline-flex;align-items:center;gap:6px;font-weight:500}
      .tier{color:var(--mid)}
      .subj{display:flex;align-items:baseline;gap:6px;font-size:14px;color:var(--mid);margin-bottom:2px}
      .subj b{color:var(--ink);font-weight:600}.subj span{margin-left:8px}
      .link{color:var(--ink)}.link:hover{color:var(--acc);text-decoration:underline}
      .link.open{margin-left:auto;color:var(--acc);font-size:13px;font-weight:500}
      .read h1{font-size:28px;line-height:1.2;font-weight:600;letter-spacing:-.015em;text-wrap:balance}
      .whyp{font-size:16px;line-height:1.45;margin-top:6px;color:var(--ink);max-width:760px;text-wrap:pretty}
      .facts{display:flex;gap:32px;margin-top:14px}
      .facts>div{flex:1 1 0;min-width:0}.facts>.wider{flex-grow:1.6}
      h3{font-size:13px;font-weight:600;color:var(--mid)}
      .facts p{font-size:14px;margin-top:1px}.facts b{font-weight:600}
      .ours{margin-top:14px;padding:6px 10px;background:var(--risk-bg);color:var(--risk);font-size:14px;border-radius:4px}
      .ours b{font-weight:600}
      .ev{margin-top:16px}
      .ev li{padding:7px 0;border-top:1px solid var(--line)}
      .ev h3{margin-bottom:5px}
      .evh{display:flex;justify-content:space-between;gap:16px;font-size:13px;color:var(--mid)}
      .evh b{font-size:14px;font-weight:500;color:var(--ink)}
      .ev li p{font-size:14px;color:#33383f}
      .claims li{display:grid;grid-template-columns:200px minmax(0,1fr);gap:20px;padding:8px 0}
      .cwho{display:grid;align-content:start;font-size:14px}
      .cwho b{font-weight:600}.cwho span{color:var(--mid);font-size:13px}.cwho .tn{color:var(--ink);font-weight:500;font-size:14px}
      .cev p{font-size:13px;line-height:1.4;color:#33383f}.cev p+p{margin-top:2px}
      .cev b,.rep b{font-weight:500;color:var(--ink)}
      .rep{font-size:13px;border-top:1px solid var(--line);padding-top:8px;color:#33383f}
      .draft{margin-top:16px;border-left:3px solid var(--agent);padding-left:16px}
      .draft h3{color:var(--agent);margin-bottom:6px}
      .draft li{display:grid;grid-template-columns:minmax(0,1fr) 200px;gap:20px;padding:5px 0}
      .draft li p{font-size:16px;line-height:1.4}
      .cite{font-size:13px;color:var(--mid);line-height:1.35}

      .dock{flex:none;background:var(--slab);color:var(--on);padding:14px 28px;box-shadow:0 -10px 24px rgba(15,28,63,.14)}
      .dl{font-size:13px;color:var(--on3);display:block}
      .dtop{display:flex;align-items:center;justify-content:space-between;gap:20px}
      .scope{display:flex;align-items:center;gap:12px;min-width:0}
      .seg{display:inline-flex;background:rgba(255,255,255,.08);border-radius:7px;padding:3px}
      .seg button{font-size:14px;font-weight:500;padding:4px 12px;border-radius:5px;color:var(--on2);white-space:nowrap}
      .seg button[data-act]:hover{color:#fff;background:rgba(255,255,255,.08)}
      .seg button.on{background:rgba(255,255,255,.2);color:#fff;font-weight:600}
      .dstrong{font-size:14px;font-weight:600}.dnote{font-size:13px;color:var(--on3)}
      .stake{font-size:14px;color:var(--on2);white-space:nowrap}.stake.risk{color:var(--riskon)}
      .stake b{font-size:20px;font-weight:600}
      .dmid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:24px;align-items:center;margin-top:10px}
      .touch{display:grid;grid-auto-flow:column;grid-template-rows:repeat(2,auto);grid-auto-columns:max-content;gap:2px 32px;margin-top:3px}
      .touch li{font-size:14px;color:#fff;padding-left:13px;position:relative}
      .touch li::before{content:'';position:absolute;left:0;top:8px;width:5px;height:5px;border-radius:50%;background:var(--on3)}
      .touch li.hard{font-weight:600}.touch li.hard::before{background:var(--riskon)}
      .go{display:grid;gap:6px}
      .primary{display:flex;align-items:center;justify-content:center;width:100%;min-height:52px;padding:0 16px;border-radius:8px;background:var(--go);color:#fff;font-size:16px;font-weight:600;text-align:center;box-shadow:0 1px 0 rgba(255,255,255,.2) inset}
      .primary:hover{background:#2654d6}
      .primary.light{width:auto;background:var(--acc)}
      .minor{display:flex;justify-content:center;gap:20px}
      .minor button{font-size:13px;color:var(--on2)}.minor button:hover{color:#fff;text-decoration:underline}
      .pol{margin:10px -28px -14px;border-top:1px solid var(--onl)}
      .pol summary{list-style:none;display:flex;align-items:center;gap:12px;padding:8px 28px;cursor:pointer;font-size:14px}
      .pol summary::-webkit-details-marker{display:none}
      .polv{font-weight:600}.polm{color:var(--on2);font-size:13px}
      .polw{margin-left:auto;font-size:13px;color:var(--on2)}.polc{width:8px;height:8px;border-right:2px solid var(--on2);border-bottom:2px solid var(--on2);transform:rotate(-135deg) translate(-1px,-1px)}
      .pol[open] .polc{transform:rotate(45deg)}
      .polbody{padding:0 28px 12px;font-size:14px;color:var(--on2);animation:fade .18s ease-out}
      .polbody b{color:#fff;font-weight:600}
      .meter{display:flex;height:8px;background:rgba(255,255,255,.12);border-radius:4px;overflow:hidden;margin:8px 0 6px}
      .ran{background:#5ec6bd}.held{background:repeating-linear-gradient(135deg,#ffb4a8 0 3px,transparent 3px 6px)}
      .quiet{font-size:13px;color:var(--mid);margin-top:4px}.polbody .quiet{color:var(--on2)}
      .ghost{font-size:14px;font-weight:500;padding:9px 14px;border-radius:7px;border:1px solid var(--on3);color:#fff;white-space:nowrap}
      .ghost:hover{background:rgba(255,255,255,.08)}
      .ghost.dark{border-color:var(--ink);color:var(--ink)}.ghost.dark:hover{background:#dfe2e7}
      .ghostlink{font-size:13px;color:var(--on2);text-decoration:underline;text-underline-offset:2px}
      .polbody .ghost{margin-top:8px}

      .dock.held{background:#e7e9ee;color:var(--ink);display:flex;gap:28px;align-items:center;padding:16px 28px;box-shadow:inset 0 1px 0 #d5d8dc}
      .heldl{flex:1;min-width:0}
      .held h2{font-size:20px;font-weight:600;letter-spacing:-.01em}
      .held p{font-size:14px;color:#3b4047}
      .held .touch li{color:var(--ink)}.held .touch{margin-top:6px}

      .slab{background:var(--slab);color:#fff;display:flex;flex-direction:column;min-height:0;min-width:0;padding:28px 40px 0}
      .rise{animation:rise .38s cubic-bezier(.2,.8,.2,1)}
      .runs2{font-size:14px;font-weight:600;color:#7fe0d6}
      .runs2.live::before{content:'';display:inline-block;width:8px;height:8px;border-radius:50%;background:#7fe0d6;margin-right:8px;animation:pulse 1s ease-in-out infinite}
      .slab.failed .runs2{color:var(--riskon)}
      .slab h1{font-size:28px;font-weight:600;letter-spacing:-.015em;margin-top:2px}
      .fail{font-size:16px;color:#fff;margin-top:8px;max-width:680px}
      .doneline{font-size:16px;color:var(--on2);margin-top:6px}
      .steps{margin-top:28px;display:grid;gap:0}
      .st{display:grid;grid-template-columns:24px 1fr;gap:16px;padding:0 0 26px;position:relative}
      .st:not(:last-child)::before{content:'';position:absolute;left:11px;top:24px;bottom:0;width:2px;background:var(--onl)}
      .st.done:not(:last-child)::before{background:#5ec6bd}
      .mark{width:24px;height:24px;border-radius:50%;border:2px solid var(--onl);display:grid;place-items:center;color:var(--slab)}
      .st.done .mark{background:#5ec6bd;border-color:#5ec6bd}
      .st.failed .mark{background:var(--riskon);border-color:var(--riskon)}
      .st.active .mark{border-color:#fff;border-right-color:transparent;animation:spin .7s linear infinite}
      .st p{font-size:20px;color:var(--on3);line-height:24px}
      .st.done p,.st.active p,.st.failed p{color:#fff}.st.active p{font-weight:600;animation:fade .2s ease-out}
      .dt{font-size:14px;color:#7fe0d6;display:block;margin-top:2px;animation:fade .25s ease-out}
      .after{border-top:1px solid var(--onl);padding-top:14px;animation:fade .3s ease-out}
      .after h2{font-size:14px;font-weight:600;color:var(--on2)}
      .after ul{display:flex;gap:40px;margin-top:6px}
      .after li{flex:1 1 0;min-width:0}
      .big{display:flex;align-items:baseline;gap:8px;font-size:16px;white-space:nowrap}
      .big span{color:var(--on2)}.big b{font-size:28px;font-weight:600;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
      .after p{font-size:14px;color:var(--on2);margin-top:2px}
      .runfoot{margin-top:auto;display:flex;justify-content:flex-end;align-items:center;gap:12px;padding:16px 0 20px;min-height:88px}
      .runfoot .primary{width:auto;min-width:300px}
      .wait{font-size:14px;color:var(--on3);margin-right:auto}

      .empty{display:grid;align-content:center;justify-items:start;gap:8px;padding:0 64px}
      .empty h1{font-size:28px;font-weight:600;letter-spacing:-.015em}
      .empty p{font-size:16px;color:var(--mid)}
      .empty .primary{margin-top:8px;min-width:220px}

      .wide{display:flex;min-height:0}.wide .slab{flex:1}
      .cbody,.dbody{display:flex;flex-direction:column;min-height:0}
      .ccols{flex:1;min-height:0;overflow:auto;display:grid;grid-template-columns:minmax(0,1fr) 440px;gap:40px;padding:16px 24px 24px;align-items:start}
      .cmain{min-width:0}
      .csub{font-size:14px;color:var(--mid)}
      .stakeb{display:flex;gap:48px;margin-top:10px}
      .stakeb b{display:block;font-size:28px;font-weight:600;letter-spacing:-.015em;line-height:1.15;font-variant-numeric:tabular-nums}
      .stakeb b.risk{color:var(--risk)}
      .stakeb span{font-size:13px;color:var(--mid);display:block;max-width:330px}
      .queued{margin-top:12px;color:var(--agent);font-size:14px;font-weight:500}
      .cmain section+section{margin-top:18px}
      .tl{margin-top:6px}
      .tl li{display:grid;grid-template-columns:12px 1fr;gap:12px;padding-bottom:12px;position:relative}
      .tl li:not(:last-child)::before{content:'';position:absolute;left:5px;top:14px;bottom:0;width:2px;background:var(--line)}
      .tdot{width:12px;height:12px;border-radius:50%;margin-top:3px;background:var(--paper);border:2px solid #8b9098;position:relative;z-index:1}
      .tl li.l-agent .tdot{background:var(--agent);border-color:var(--agent)}
      .tl li.rc .tdot{background:var(--risk);border-color:var(--risk)}
      .tl li.rc p{color:var(--risk)}
      .tt,.td{font-size:13px;color:var(--mid);display:block}
      .tl p{font-size:14px;font-weight:500}
      .cside{display:grid;gap:18px;min-width:0}
      .mny{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:4px}
      .mny dt{font-size:13px;color:var(--mid)}.mny dt em{font-style:normal;font-weight:600;color:var(--ink)}
      .mny dd{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
      .lines{width:100%;border-collapse:collapse;margin-top:4px;font-size:13px}
      .lines th{font-weight:500;color:var(--mid);text-align:left;padding:3px 8px 3px 0;border-bottom:1px solid var(--line)}
      .lines td{padding:4px 8px 4px 0;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums}
      .lines .n{text-align:right;padding-right:14px}
      .acks{margin-top:4px;font-size:13px}
      .acks li{display:flex;justify-content:space-between;gap:12px;padding:3px 0}
      .acks time{color:var(--mid)}
      .cdock .dock{padding-left:24px;padding-right:24px}
      .cdock .pol{margin-left:-24px;margin-right:-24px}.cdock .pol summary{padding-left:24px;padding-right:24px}.cdock .polbody{padding-left:24px;padding-right:24px}

      .dtable{flex:1;min-height:0;overflow:auto;padding:0 0 16px}
      .dcols,.drow{display:grid;grid-template-columns:230px minmax(0,1fr) 84px 150px 176px 170px;gap:20px;padding:0 24px}
      .dcols{position:sticky;top:0;background:var(--paper);font-size:13px;font-weight:500;color:var(--mid);padding-top:10px;padding-bottom:6px;border-bottom:1px solid var(--line);z-index:1}
      .dg{font-size:14px;font-weight:600;padding:12px 24px 6px}
      .dg span{font-weight:400;color:var(--mid);font-size:13px;margin-left:6px}
      .drow{padding-top:9px;padding-bottom:9px;border-top:1px solid var(--line);font-size:14px;align-items:start}
      .drow b{font-weight:600}
      .drow.marked{background:var(--acc-bg);box-shadow:inset 3px 0 0 var(--acc)}
      .sub{display:block;font-size:13px;color:var(--mid)}
      .link.sub{color:var(--acc);font-weight:500}
      .tagours{display:block;color:var(--risk);font-size:13px;font-weight:600}
      .lose{font-size:14px;font-weight:500}
      .toast{position:absolute;top:100px;left:50%;transform:translateX(-50%);background:var(--ink);color:#fff;font-size:14px;padding:8px 14px;border-radius:7px;z-index:5;animation:fade .15s ease-out}
      @keyframes rise{from{clip-path:inset(72% 0 0 0)}to{clip-path:inset(0)}}
      @keyframes fade{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
      @keyframes spin{to{transform:rotate(360deg)}}
      @keyframes pulse{50%{opacity:.35}}
      @media (prefers-reduced-motion:reduce){.rise,.polbody,.dt,.after,.toast,.st.active p{animation:none}.st.active .mark,.runs2.live::before{animation:none}}
    `,
    render(s, h) {
      const screen = s.screen === 'claim' ? claimScreen(s, h) : s.screen === 'denials' ? denials(s, h) : inbox(s, h)
      return `<div class="app">${nav(s, h)}<main class="main">${screen}</main>${s.toast ? `<div class="toast" role="status">${h.esc(s.toast)}</div>` : ''}</div>`
    },
  })
})()
