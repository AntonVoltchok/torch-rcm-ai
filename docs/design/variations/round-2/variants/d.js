/* Variation D: Whose move.

   DESIGN PLAN
   The idea: a claim is a baton, not a status. Status says what the payer decided; the baton says whose
   move it is. Those are two facts, so they get two columns that move independently. Approve 3 slides
   three batons while the Denied column beside them does not budge.

   Palette
     --paper  #EEF2F1  operatory wall, a cool gray with almost no chroma
     --sheet  #FBFCFC  chart paper, the decision surface
     --film   #16242B  x-ray film, blue-black. Top band and the evidence mount only
     --ink    #10262B  --ink2 #3F5559  --ink3 #566C70  --rule #D2DBD9
     --you    #F0B429  marigold, the hand on the claim. Also the filled button: it is always your move
     --agent  #0C7C86  operatory teal
     --payer  #4338A3  articulating-paper indigo
     --risk   #B3261E  ledger red, money at risk and "root cause: ours" only
     Each party also has a shape, so nothing depends on hue: You is a pill, Agents a block, Payer a leaf.

   Type
     Barlow Semi Condensed 500/600: instrument-tray labelling. Numbers, headlines, the sentence.
     Atkinson Hyperlegible Next 400/600: body. Built so 1, l, I and 0, O never collide, which matters
     when two Diazes differ by a claim number.
     Scale: 12, 14, 17, 21, 30. Bold only for a name or a number that decides something.

   Layout
     film band   TorchRCM  Inbox 12  Denials  ...             Cigna quiet   clock   Dana | Dr. Morgan
     sentence    12 items are yours (...). 11 claims are with the agents (...). 88 claims are with payers.
     strip       Ready 6  Sent 5  ...  Denied 5 [#####]  ...            this week agents ran 41 ...
     +--------------------------------+------------------------------------------------------+
     | Yours        You Agents Payer  | Headline                                             |
     | [=]--|--|  F. Diaz #4840       | Why                                                  |
     | [=]--|--|  K. Owens #4821      | Claim      Status     You ---- Agents ---- Delta     |
     | ...                            | F. Diaz    Denied     [===]----|-----------|         |
     | Dr. Morgan signs               | [ Send 3 x-rays and resubmit ]  what it touches      |
     | > With the agents 11           | why it stopped, track record, recommendation         |
     | > With payers 88               | film mount: evidence excerpts                        |
     +--------------------------------+------------------------------------------------------+

   The one memorable thing
     The baton line, and the moment after Approve 3: the three rods leave You, the Denied column stays
     still, and the five-tick tally in the strip recolours while the number 5 stays 5.
*/
(function () {
  const STOP = { you: 0, agents: 1, payer: 2 }
  const WORD = { you: 'you', agents: 'the agents', payer: 'the payer', nobody: 'nobody' }

  // Where the baton lands once an approved item finishes. In production this is server-derived, like h.move.
  const LANDS = {
    itm_4611: 'nobody', itm_4733: 'payer', itm_4840: 'agents', itm_4821: 'agents', itm_4836: 'agents', itm_4705: 'payer',
    itm_4748: 'nobody', itm_4772: 'payer', itm_4851: 'agents', itm_elig_chen: 'nobody', itm_elig_park: 'nobody', itm_elig_kim: 'nobody',
  }
  const CDT = {
    D0140: 'Limited exam', D0150: 'New-patient exam', D0210: 'Full-mouth x-rays', D0220: 'Intraoral PA, first film', D1110: 'Adult cleaning',
    D2392: 'Composite, two surfaces', D2740: 'Crown, porcelain/ceramic', D2750: 'Crown, porcelain fused to metal', D2950: 'Core buildup', D3330: 'Root canal, molar',
  }
  const EV_KIND = {
    portal_screenshot: 'Payer portal', era_line: '835 line', pms_record: 'PMS record', prior_eob: 'Prior EOB',
    ivr_transcript: 'IVR transcript', rep_call: 'Rep call', policy_clause: 'Rulebook',
  }

  // Render is called on every state change, which would restart any CSS animation. The clock below lets
  // each animation resume at the right offset through a negative delay, so a re-render is invisible.
  const known = {}
  const plans = {}
  const handed = new Map()
  let clock = { key: null, t0: 0, doneAt: 0 }
  const now = () => (window.performance ? performance.now() : Date.now())
  const still = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)

  const open = (window.__torchDopen = window.__torchDopen || { agents: false, payer: false })

  function sync(s) {
    s.items.forEach((i) => { known[i.id] = i })
    if (s.run) {
      const key = s.run.title + s.run.ids.join()
      if (clock.key !== key) clock = { key, t0: now(), doneAt: 0 }
      if (s.run.done && !clock.doneAt) clock.doneAt = now()
      s.run.ids.forEach((id) => (s.run.failed ? handed.delete(id) : handed.set(id, LANDS[id] || 'nobody')))
    } else clock = { key: null, t0: 0, doneAt: 0 }
    handed.forEach((_, id) => { if (s.items.some((i) => i.id === id)) handed.delete(id) })
  }

  const elapsed = () => (clock.key ? now() - clock.t0 : Infinity)
  const sinceDone = () => (clock.doneAt ? now() - clock.doneAt : Infinity)
  const running = (s, id) => !!(s.run && !s.run.done && s.run.ids.includes(id))
  const startAt = (n, i) => (n > 1 ? 300 + 220 * i : 120)
  const settled = (s) => !s.run || s.run.done || still() || elapsed() >= 1200

  // A rod glides from stop `a` to wherever its element rests. The resting transform is always the truth.
  function pass(a, start, since) {
    if (still() || since > start + 620) return ''
    return `--a:${a};animation:pass 500ms cubic-bezier(.3,.75,.25,1) ${start - since}ms both;`
  }

  const clean = (t) => String(t ?? '').replace(/\s+·\s+/g, ', ').replace(/\s+—\s+/g, ': ')
  const cap = (t) => { const x = String(t ?? ''); return x.charAt(0).toUpperCase() + x.slice(1) }
  const plural = (n, one, many) => (n === 1 ? one : many || one + 's')

  function holder(s, h, claim, itemId) {
    if (itemId && handed.has(itemId)) return running(s, itemId) ? 'agents' : handed.get(itemId)
    return h.move(claim).who
  }

  /* The baton line: three stops, one rod. Hue, shape and position all say the same thing. */
  function baton(who, o) {
    const opt = o || {}
    const stops = [0, 1, 2].map((i) => `<i class="st" style="--i:${i}"></i>`).join('')
    const ghost = opt.next && opt.next !== who && STOP[opt.next] !== undefined ? `<b class="rod gh" style="--p:${STOP[opt.next]}"></b>` : ''
    const from = opt.trail !== undefined && STOP[who] !== undefined && opt.trail !== STOP[who]
      ? `<u class="tr ${who}" style="--l:${Math.min(opt.trail, STOP[who])};--n:${Math.abs(opt.trail - STOP[who])}"></u>` : ''
    const rod = STOP[who] === undefined ? '' : `<b class="rod ${who}${opt.hatch ? ' hatch' : ''}" style="--p:${STOP[who]};${opt.anim || ''}">${opt.count || ''}</b>`
    const aria = opt.aria || (who === 'nobody' ? 'Nobody holds this now' : `Held by ${WORD[who]}`)
    return `<span class="bt ${opt.size || 'sm'}" role="img" aria-label="${aria}">${stops}${from}${ghost}${rod}</span>`
  }

  const legend = (size, payer) => `<span class="lgd ${size}" aria-hidden="true"><em class="you" style="--i:0">You</em><em class="agents" style="--i:1">Agents</em><em class="payer" style="--i:2">${payer || 'Payer'}</em></span>`

  function totals(s, h) {
    const tiles = s.strip.tiles
    const ready = tiles.find((t) => t.status === 'ready').count
    const sent = tiles.find((t) => t.status === 'sent').count
    const base = tiles.filter((t) => t.status !== 'paid' && h.move({ status: t.status }).who === 'agents').reduce((a, t) => a + t.count, 0)
    const ids = [...handed.keys()]
    const hasClaim = (id) => known[id] && known[id].claim
    const heldByAgents = ids.filter((id) => hasClaim(id) && (running(s, id) || handed.get(id) === 'agents'))
    const gone = ids.filter((id) => hasClaim(id) && !running(s, id) && handed.get(id) === 'nobody' && known[id].claim.status !== 'paid')
    const parked = s.resolvedCount - handed.size
    const yoursOpen = s.items.filter((i) => i.claim && i.claim.status !== 'paid').length
    let yours = s.strip.inbox_open
    let claims = s.reconcile.claims
    const visits = s.reconcile.visits
    let agents = base + heldByAgents.length
    let just = heldByAgents.length
    const payers = s.strip.open_count - base - yoursOpen - heldByAgents.length - gone.length - parked
    if (!settled(s)) {
      // Counts change when the rods arrive, not before they leave.
      const moving = s.run.ids.filter(hasClaim).length
      yours += s.run.ids.length; claims += moving; agents -= moving; just -= moving
    }
    return { yours, claims, visits, agents, payers, ready, sent, just, paidYours: s.items.filter((i) => i.claim && i.claim.status === 'paid').length }
  }

  /* Shell */
  function clockText(s) {
    const d = new Date(s.clock.now)
    const day = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' })
    return `${day} ${window.TorchProto.helpers.date(s.clock.now)}, ${window.TorchProto.helpers.time(s.clock.now)}`
  }

  function top(s) {
    const links = ["Today's claims", 'Claims', 'Payments', 'Patients', 'Eligibility', 'Activity', 'Settings']
    const cur = s.screen
    return `<header class="top" data-part="shell.nav">
      <span class="brand"><span class="mark" aria-hidden="true"><i></i></span>TorchRCM</span>
      <nav>
        <button class="main${cur === 'inbox' ? ' on' : ''}" data-act="nav:inbox">Inbox <span class="c">${s.strip.inbox_open}</span></button>
        <button class="main${cur === 'denials' ? ' on' : ''}" data-act="nav:denials">Denials</button>
        ${links.map((l) => `<button data-act="nav:${l}">${l}</button>`).join('')}
      </nav>
      <div class="tr-side">
        <span class="out" data-part="shell.outage" title="${s.outage}"><i></i>Cigna portal unreachable</span>
        <span class="clk" data-part="shell.demo-controls" title="Demo clock, frozen">${clockText(s)}</span>
        <span class="who" data-part="shell.demo-controls" role="group" aria-label="Signed in as">
          ${s.users.map((u) => `<button class="${u.id === s.user.id ? 'on' : ''}" data-act="user:${u.id}" title="${u.title}">${u.name}</button>`).join('')}
        </span>
      </div>
    </header>`
  }

  function sentence(s, h) {
    const t = totals(s, h)
    const agentsDetail = t.just > 0 ? `${t.ready} ready, ${t.sent} sent, ${t.just} you just handed over` : `${t.ready} ready and ${t.sent} sent`
    const glyph = (w) => `<b class="rod mini ${w}" aria-hidden="true"></b>`
    return `<p class="sum" data-part="shell.header" title="These add up to the ${s.strip.open_count} open claims, plus ${t.paidYours} paid ${plural(t.paidYours, 'claim')} still in your Inbox, and ${t.visits} upcoming visits.">
      <span>${glyph('you')}<strong class="you">${t.yours} ${plural(t.yours, 'item')}</strong> ${t.yours === 1 ? 'is' : 'are'} yours <small>(${t.claims} ${plural(t.claims, 'claim')}, ${t.visits} upcoming ${plural(t.visits, 'visit')})</small></span>
      <span>${glyph('agents')}<strong class="agents">${t.agents} claims</strong> are with the agents <small>(${agentsDetail})</small></span>
      <span>${glyph('payer')}<strong class="payer">${t.payers} claims</strong> are with payers <small>(waiting on a reply)</small></span>
    </p>`
  }

  function tally(s, h, big) {
    const d = s.strip.tiles.find((t) => t.status === 'denied')
    const ids = [...handed.keys()].filter((id) => known[id] && known[id].claim && known[id].claim.status === 'denied')
    const heldAgents = ids.filter((id) => running(s, id) || handed.get(id) === 'agents')
    const heldPayer = ids.filter((id) => !running(s, id) && handed.get(id) === 'payer')
    const yours = Math.max(0, d.count - heldAgents.length - heldPayer.length)
    const n = heldAgents.length
    const since = elapsed()
    let out = ''
    for (let i = 0; i < yours; i++) out += '<i class="tk you"></i>'
    for (let i = 0; i < n; i++) {
      const start = startAt(n, i) + 300
      const anim = still() || since > start + 500 ? '' : `animation:tick 300ms ease ${start - since}ms both;`
      out += `<i class="tk agents" style="${anim}"></i>`
    }
    for (let i = 0; i < heldPayer.length; i++) out += '<i class="tk payer"></i>'
    const parts = [yours ? `${yours} with you` : '', n ? `${n} with the agents` : '', heldPayer.length ? `${heldPayer.length} with payers` : ''].filter(Boolean).join(', ')
    return `<span class="tally${big ? ' big' : ''}" role="img" aria-label="${parts}" title="${parts}">${out}</span>`
  }

  function pipe(s, h) {
    const r = s.run
    const step = r && !r.done ? r.steps.findIndex((x) => x.state === 'active') + 1 : 0
    const summary = r && !r.done
      ? `<span class="agents">Agents are running this now:</span> ${h.esc(r.title)}, step ${step} of ${r.steps.length}`
      : `This week agents ran <strong>${s.week.ranAlone}</strong> on their own. <strong>${s.week.cameToYou}</strong> came to you.`
    return `<div class="pipe${s.screen === 'inbox' ? '' : ' alone'}">
      <div class="tiles" data-part="shell.pipeline">
        ${s.strip.tiles.map((t) => {
          const lab = clean(t.label).replace(',', '')
          if (t.status === 'denied') return `<span class="ti den"><span>${lab}</span> <strong>${t.count}</strong> ${tally(s, h)}</span>`
          return `<span class="ti"><span>${lab}</span> <strong>${t.count}</strong></span>`
        }).join('')}
        <span class="ti q">${s.strip.open_count} open, ${h.money(s.strip.ar_cents)} A/R</span>
      </div>
      <div class="week" data-part="shell.agent-summary">${summary}</div>
    </div>`
  }

  /* Inbox queue */
  function itemRow(s, h, it, opts) {
    const o = opts || {}
    const c = it.claim
    const sel = s.selected && s.selected.id === it.id
    const blocked = !s.canAct(it)
    const num = c ? `<span class="num">#${c.number}</span>` : ''
    return `<button class="row${sel ? ' sel' : ''}${o.member ? ' member' : ''}" data-act="select:${it.id}" data-part="inbox.queue-row">
      ${baton('you', { hatch: blocked, next: blocked ? null : LANDS[it.id], aria: blocked ? 'Dr. Morgan holds this' : `With you, next ${WORD[LANDS[it.id]]}` })}
      <span class="rt">
        <span class="l1"><span class="name">${h.esc(it.copy.who)}</span> ${num} <span class="tre">${h.esc(it.copy.treatment)}</span></span>
        ${o.member ? '' : `<span class="l2">${h.esc(it.copy.headline)}</span>`}
      </span>
      <span class="amt">${h.money(it.cents)}</span>
    </button>`
  }

  function groupRow(s, h, g) {
    const has = s.selected && s.selected.group_key === g.key
    return `<div class="grp${g.open ? ' open' : ''}" data-part="inbox.group">
      <button class="row g${has && !g.open ? ' sel' : ''}" data-act="group:${g.key}" aria-expanded="${g.open}">
        ${baton('you', { count: g.count, next: 'agents', aria: `${g.count} claims with you, next the agents` })}
        <span class="rt"><span class="l1"><span class="name">${h.esc(g.copy.headline)}</span></span></span>
        <span class="amt">${h.money(g.cents)}</span>
      </button>
      ${g.open ? g.items.map((m) => itemRow(s, h, m, { member: true })).join('') : ''}
    </div>`
  }

  function claimRow(h, c, who, line) {
    return `<div class="row plain">
      ${baton(who)}
      <span class="rt">
        <span class="l1"><span class="name">${h.esc(c.patient.display_name)}</span> <span class="num">#${c.number}</span> <span class="tre">${h.esc(c.procedures)}</span></span>
        <span class="l2">${h.esc(line)}</span>
      </span>
      <span class="amt">${h.money(c.billed_cents)}</span>
    </div>`
  }

  function handedBlock(s, h, ids, who) {
    const live = ids.filter((id) => known[id] && known[id].claim)
    if (!live.length) return ''
    const lineOf = (id) => (running(s, id) ? 'Running now' : known[id].copy.doneLine)
    const lines = [...new Set(live.map(lineOf))]
    const n = s.run ? s.run.ids.length : 1
    const rows = live.map((id) => {
      const it = known[id]
      const i = s.run ? s.run.ids.indexOf(id) : -1
      const anim = i >= 0 ? pass(0, startAt(n, i), elapsed()) : ''
      return `<div class="row plain member">
        ${baton(who, { anim, trail: 0 })}
        <span class="rt"><span class="l1"><span class="name">${h.esc(it.copy.who)}</span> <span class="num">#${it.claim.number}</span> <span class="tre">${h.esc(it.copy.treatment)}</span></span>
        ${lines.length > 1 ? `<span class="l2">${h.esc(lineOf(id))}</span>` : ''}</span>
        <span class="amt">${h.money(it.cents)}</span>
      </div>`
    }).join('')
    return (lines.length === 1 ? `<p class="jl">${h.esc(lines[0])}</p>` : '') + rows
  }

  function section(key, title, count, unit, justRows, listRows, rest) {
    const head = (extra) => `<span class="sh"><b class="rod mini ${key}" aria-hidden="true"></b><span class="st-t">${title}</span> <span class="st-c">${count} ${unit}</span>${extra || ''}</span>`
    const details = (label) => `<details class="sec" ${open[key] ? 'open' : ''} ontoggle="window.__torchDopen.${key}=this.open"><summary>${label}</summary><div class="list">${listRows}</div></details>`
    if (justRows) return `<section class="lane ${key}"><div class="hd">${head()}</div>${justRows}${details(`<span class="sh more">Show the other ${rest}</span>`)}</section>`
    return `<section class="lane ${key}">${details(head())}</section>`
  }

  function queue(s, h) {
    const t = totals(s, h)
    const rows = s.queue.filter((q) => q.type === 'group' || s.canAct(q.item))
    const blocked = s.queue.filter((q) => q.type === 'item' && !s.canAct(q.item))
    const ids = [...handed.keys()]
    const toAgents = ids.filter((id) => running(s, id) || handed.get(id) === 'agents')
    const toPayer = ids.filter((id) => !running(s, id) && handed.get(id) === 'payer')
    const list = s.claimsList.map((c) => ({ c, who: h.move(c).who }))
    const agentRows = list.filter((x) => x.who === 'agents').map(({ c }) => {
      const reason = c.reason && c.reason !== 'held' ? `. ${cap(clean(c.reason))}` : c.reason === 'held' ? '. On hold' : ''
      return claimRow(h, c, 'agents', `${cap(c.status)} for ${c.payer.short_name}${reason}`)
    }).join('')
    const payerList = list.filter((x) => x.who === 'payer')
    const payerRows = payerList.map(({ c }) => {
      const note = clean(c.agent_note || c.reason || '')
      return claimRow(h, c, 'payer', `Waiting on ${c.payer.short_name}, day ${c.age_days}${note ? `. ${cap(note)}` : ''}`)
    }).join('') + `<p class="shown">Showing ${payerList.length} of ${t.payers}, the longest waits first. The rest are in Claims.</p>`
    return `<aside class="queue" data-part="inbox.queue" data-scroll="queue">
      <div class="qh">
        <span class="yt"><b class="rod mini you" aria-hidden="true"></b>Yours</span>
        <div class="tabs" role="tablist">
          ${s.tabs.map((x) => `<button role="tab" aria-selected="${x.key === s.filter}" class="${x.key === s.filter ? 'on' : ''}" data-act="filter:${x.key}">${x.label} <span>${x.count}</span></button>`).join('')}
        </div>
      </div>
      <div class="legend">${legend('sm')}<span class="lgn">Dashed is where it goes next</span></div>
      ${rows.map((q) => (q.type === 'group' ? groupRow(s, h, q) : itemRow(s, h, q.item))).join('')}
      ${!rows.length && !blocked.length ? '<p class="qnone">Nothing of this kind is waiting on you.</p>' : ''}
      ${blocked.length ? `<div class="sub">Not yours to do. Dr. Morgan signs ${blocked.length === 1 ? 'this one' : 'these'}.</div>${blocked.map((q) => itemRow(s, h, q.item)).join('')}` : ''}
      ${section('agents', 'With the agents', t.agents, 'claims', handedBlock(s, h, toAgents, 'agents'), agentRows, t.agents - toAgents.length)}
      ${section('payer', 'With payers', t.payers, 'claims', handedBlock(s, h, toPayer, 'payer'), payerRows, t.payers - toPayer.length)}
    </aside>`
  }

  /* The relay table: status and baton as two separate columns. Used for the decision and the run, in the same place. */
  function relay(s, h, its, cell) {
    const payer = its.map((i) => i.claim && i.claim.payer.short_name).find(Boolean)
    return `<div class="relay">
      <div class="rh"><span>${its.length > 1 ? `${its.length} claims` : 'Claim'}</span><span>Billed</span><span>Status</span><span class="rl">${legend('big', payer)}</span></div>
      ${its.map((it, i) => {
        const c = it.claim
        const sel = s.selected && s.selected.id === it.id && its.length > 1
        const name = `<span class="name">${h.esc(it.copy.who)}</span>${c ? ` <span class="num">#${c.number}</span>` : ''} <span class="tre">${h.esc(it.copy.treatment)}</span>`
        return `<div class="rr${sel ? ' sel' : ''}">
          ${c ? `<button class="lnk" data-act="open-claim:${c.id}" title="Open claim #${c.number}">${name}</button>` : `<span>${name}</span>`}
          <span class="amt">${h.money(it.cents)}</span>
          <span class="stat ${c ? c.status : 'visit'}">${c ? cap(c.status) : 'Upcoming visit'}</span>
          <span class="rc">${cell(it, i)}</span>
        </div>`
      }).join('')}
    </div>`
  }

  function evidence(h, list) {
    if (!list || !list.length) return ''
    return `<section class="mount" data-part="inbox.evidence">
      <h3>What the agent read</h3>
      <div class="frames n${Math.min(list.length, 3)}">
        ${list.map((e) => `<article class="frame-f">
          <h4>${h.esc(clean(e.title))}</h4>
          <p>${h.esc(e.excerpt)}</p>
          <footer>${EV_KIND[e.kind] || 'Record'}, ${h.date(e.captured_at)} at ${h.time(e.captured_at)}${e.ref ? `, ref ${h.esc(e.ref)}` : ''}</footer>
        </article>`).join('')}
      </div>
    </section>`
  }

  function draft(h, d) {
    if (!d) return ''
    const cited = d.filter((x) => x.cites.length).length
    return `<section class="draft" data-part="inbox.draft">
      <h3>The note that goes to Delta <span>${d.length} sentences, ${cited} cited. Read it, because it cannot be recalled.</span></h3>
      <ol>${d.map((x) => `<li><span class="say">${h.esc(x.text)}</span><span class="cite">${x.cites.length ? x.cites.map((c) => h.esc(clean(c))).join(', ') : 'No citation needed: a request, not a fact'}</span></li>`).join('')}</ol>
    </section>`
  }

  function record(h, it) {
    if (!it.record) return h.esc(cap(clean(it.noRecord)))
    const m = clean(it.record).match(/^(\d+ of \d+)\s(.*)$/)
    return m ? `<strong>${h.esc(m[1])}</strong> ${h.esc(m[2])}` : h.esc(clean(it.record))
  }

  const oursLine = (h, it) => (it.root_cause === 'ours'
    ? `<p class="ours"><strong>Root cause: ours.</strong> ${h.esc(cap(clean(it.audit_note || '').replace(/^root cause: ours:\s*/i, '')))}.</p>` : '')

  function decision(s, h) {
    const it = s.selected
    const g = s.group
    const c = g ? g.copy : it.copy
    const blocked = !s.canAct(it)
    const members = g ? g.items : [it]
    const pol = h.policy(it)
    members.forEach((m) => { plans[m.id] = c })
    const owner = it.required_role === 'owner'
    const land = LANDS[it.id]
    const fill = blocked ? '' : g
      ? `<button class="fill" data-act="approve-group:${g.key}">${h.esc(c.action)}<kbd>⇧A</kbd></button>`
      : `<button class="fill" data-act="approve:${it.id}">${h.esc(c.action)}<kbd>A</kbd></button>`
    return `<section class="dec" data-part="inbox.decision">
      <h1>${h.esc(c.headline)}</h1>
      <p class="why">${h.esc(c.why)}</p>
      ${oursLine(h, it)}
      ${relay(s, h, members, () => baton('you', { size: 'lg', hatch: blocked, next: blocked ? null : land, aria: blocked ? 'Dr. Morgan holds this' : `With you, next ${WORD[land]}` }))}
      ${blocked ? `<div class="bar blocked" data-part="inbox.action-bar">
        <div><h2>Dr. Morgan signs this</h2><p>${h.esc(c.signerNote)}</p></div>
        <button class="line" data-act="user:usr_morgan">Switch to Dr. Morgan</button>
      </div>` : `<div class="bar" data-part="inbox.action-bar">
        <div class="go">${fill}
          <div class="alt">
            ${g ? `<button data-act="approve:${it.id}">Send only #${it.claim.number}</button>` : ''}
            <button data-act="reject:${it.id}">Reject</button>
            <button data-act="snooze:${it.id}">Snooze</button>
          </div>
        </div>
        <div class="touch"><h3>${owner ? 'What your signature does' : 'What this does'}</h3><ul>${(c.touches || []).map((t) => `<li>${h.esc(t)}</li>`).join('')}</ul></div>
      </div>`}
      ${blocked ? `<div class="touch wide"><h3>What the signature does</h3><ul>${(c.touches || []).map((t) => `<li>${h.esc(t)}</li>`).join('')}</ul></div>` : ''}
      <div class="facts">
        <div data-part="inbox.why-stopped"><h3>Why it stopped at ${blocked ? 'a person' : 'you'}</h3><p>${h.esc(c.stoppedBy)}</p></div>
        <div data-part="inbox.recommendation"><h3>${h.agentName(it.agent)} agent recommends</h3><p>${h.esc(clean(it.recommendation))}</p></div>
        <div><h3>Track record</h3><p>${record(h, it)}</p></div>
      </div>
      ${pol ? `<p class="pol${pol.canLearn ? '' : ' never'}" data-part="inbox.policy">${pol.canLearn ? `<strong>Can learn to run alone.</strong> ${h.esc(pol.reason)} Change it in Settings.` : `<strong>Always auto-run is off the table here.</strong> ${h.esc(pol.reason)}`}</p>` : ''}
      ${draft(h, it.draft)}
      ${evidence(h, it.evidence)}
      <p class="keys"><kbd>J</kbd> <kbd>K</kbd> move through your list</p>
    </section>`
  }

  function afterState(s, h) {
    const r = s.run
    const t = totals(s, h)
    const moved = r.failed ? 0 : r.ids.filter((id) => known[id] && known[id].claim && handed.get(id) === 'agents').length
    const rows = []
    r.changes.forEach((c) => {
      const same = c.from === c.to
      const isDenied = c.label === 'Denied'
      rows.push(`<div class="led${isDenied ? ' den' : ''}">
        <span class="k">${h.esc(c.label)}</span>
        <span class="v">${same ? `<em>stays</em> <strong>${c.to}</strong>` : `${c.from} <em>to</em> <strong>${c.to}</strong>`}</span>
        ${isDenied ? tally(s, h, true) : ''}
        ${c.note ? `<p>${h.esc(c.note)}</p>` : ''}
      </div>`)
      if (c.label === 'Inbox' && moved) rows.push(`<div class="led"><span class="k">With the agents</span><span class="v">${t.agents - moved} <em>to</em> <strong>${t.agents}</strong></span></div>`)
    })
    return `<div class="after" data-part="inbox.after-state"><h3>What changed</h3>${rows.join('')}</div>`
  }

  function runPane(s, h) {
    const r = s.run
    const its = r.ids.map((id) => known[id]).filter(Boolean)
    const n = its.length
    const active = r.steps.findIndex((x) => x.state === 'active') + 1
    const plan = plans[r.ids[0]] || {}
    const failAt = r.steps.findIndex((x) => x.state === 'failed')
    return `<section class="dec run${r.failed ? ' fail' : ''}" data-part="inbox.run">
      <h1>${h.esc(plan.headline || r.title)}</h1>
      ${plan.why ? `<p class="why">${h.esc(plan.why)}</p>` : ''}
      ${its[0] ? oursLine(h, its[0]) : ''}
      ${relay(s, h, its, (it, i) => {
        const land = LANDS[it.id]
        if (r.failed) return baton('you', { size: 'lg', trail: 1, anim: pass(1, 0, sinceDone()), aria: 'Came back to you' })
        if (r.done && land === 'payer') return baton('payer', { size: 'lg', trail: 0, anim: pass(1, 0, sinceDone()) })
        if (r.done && land === 'nobody') return baton('nobody', { size: 'lg' }) + '<span class="off">Finished</span>'
        return baton('agents', { size: 'lg', trail: 0, next: 'payer', anim: pass(0, startAt(n, i), elapsed()), aria: 'Moved from you to the agents' })
      })}
      <div class="runhead">
        <h2>${h.esc(r.failed ? 'Stopped, and back with you' : r.done ? r.doneLine : r.title)}</h2>
        ${r.failed ? `<p class="kick bad">${h.esc(r.failedText)}</p>` : r.done ? '' : `<p class="kick live">Agents are on it. Step ${active} of ${r.steps.length}.</p>`}
      </div>
      <div class="rungrid">
        <ol class="steps">
          ${r.steps.map((x, i) => `<li class="${x.state}${failAt === i ? ' bad' : ''}"><i aria-hidden="true"></i><span>${h.esc(x.text)}${x.detail ? `<small>${h.esc(x.detail)}</small>` : ''}</span></li>`).join('')}
        </ol>
        ${r.done ? afterState(s, h) : `<div class="touch side"><h3>What this does</h3><ul>${(plan.touches || []).map((t) => `<li>${h.esc(t)}</li>`).join('')}</ul></div>`}
      </div>
      ${r.done ? `<div class="foot">
        ${r.failed
          ? `<button class="fill" data-act="select:${r.ids[0]}">Back to ${h.esc(its[0].copy.who)} #${its[0].claim.number}</button>${s.nextItem ? '<button class="line" data-act="next">Go to the next item</button>' : ''}`
          : s.nextItem
            ? `<button class="fill" data-act="next">Next: ${h.esc(s.nextItem.copy.who)}${s.nextItem.claim ? ` #${s.nextItem.claim.number}` : ''}</button><button class="line" data-act="dismiss">Stay here</button>`
            : '<button class="fill" data-act="next">Finish</button>'}
      </div>` : ''}
    </section>`
  }

  function emptyPane(s, h) {
    const n = s.nextItem
    return `<section class="dec empty" data-part="inbox.empty">
      <h1>${n ? 'Pick up where you left off' : 'Nothing is waiting on you'}</h1>
      <p class="why">${n ? `${h.esc(n.copy.who)}${n.claim ? ` #${n.claim.number}` : ''} is next. ${h.esc(n.copy.headline)}.` : 'Every baton is with the agents or a payer.'}</p>
      ${n ? `<div class="foot"><button class="fill" data-act="select:${n.id}">Open ${h.esc(n.copy.who)}</button></div>` : ''}
    </section>`
  }

  const inbox = (s, h) => `<main class="split">
    ${queue(s, h)}
    <div class="pane" data-scroll="pane">${s.run ? runPane(s, h) : s.selected ? decision(s, h) : emptyPane(s, h)}</div>
  </main>`

  /* Claim: the baton line at scale, drawn from the real timeline lanes. */
  function shortLabel(e) {
    const k = e.kind
    if (k === 'visit') return 'Visit'
    if (k === 'built') return 'Built the claim'
    if (k === 'payer_277ca_a1') return 'Accepted'
    if (k === 'payer_277ca_a7') return 'Rejected'
    if (k === 'remittance') return /Denied/.test(e.title) ? 'Denied' : 'Paid part'
    if (k === 'root_cause') return 'Root cause'
    if (/IVR status|Portal status/.test(e.title)) return 'Status check'
    if (/Rep call/.test(e.title)) return 'Rep call'
    return 'Proposed fix'
  }

  function legs(claim, cur, at, approved) {
    const out = []
    claim.timeline.forEach((e) => {
      const who = e.kind === 'run' ? null : e.lane === 'agent' ? 'agents' : e.lane === 'payer' ? 'payer' : e.kind === 'visit' ? 'you' : null
      if (!who) return
      const lab = shortLabel(e)
      const last = out[out.length - 1]
      if (last && last.who === who) { if (!last.labels.includes(lab)) last.labels.push(lab); last.end = e.at } else out.push({ who, start: e.at, end: e.at, labels: [lab] })
    })
    if (approved) out.push({ who: 'you', start: at, end: at, labels: ['You approved'] })
    const words = { you: 'Your move', agents: 'Running your approval', payer: 'Waiting on a reply' }
    if (cur !== 'nobody' && (!out.length || out[out.length - 1].who !== cur)) out.push({ who: cur, start: at, end: at, labels: [words[cur]] })
    return out
  }

  function history(s, h, cur, next, approved) {
    const c = s.claim
    const ls = legs(c, cur, s.clock.now, approved)
    const W = 1392
    const left = 76
    const ghostW = next && next !== cur ? 130 : 0
    const avail = W - left - ghostW - 20
    const text = ls.map((l) => {
      const d = h.date(l.start) === h.date(l.end) ? h.date(l.start) : `${h.date(l.start)}–${h.date(l.end)}`
      return { d, t: l.labels.join(', ') }
    })
    const weights = ls.map((_, i) => Math.max(110, (text[i].d.length + text[i].t.length) * 5.9 + 34))
    const sum = weights.reduce((a, b) => a + b, 0)
    const scale = avail / sum
    const y = { you: 26, agents: 62, payer: 98 }
    const hue = { you: 'var(--you)', agents: 'var(--agent)', payer: 'var(--payer)' }
    const payer = c.claim.payer.short_name
    let x = left
    const segs = []
    const links = []
    ls.forEach((l, i) => {
      const w = weights[i] * scale
      const x1 = x + w - 10
      const lastOne = i === ls.length - 1
      segs.push(`<rect class="seg" x="${x}" y="${y[l.who] - (lastOne ? 7 : 4)}" width="${w - 10}" height="${lastOne ? 14 : 8}" rx="${l.who === 'you' ? (lastOne ? 7 : 4) : l.who === 'agents' ? 2 : 0}" fill="${hue[l.who]}"/>`)
      segs.push(`<text class="d" x="${x}" y="${y[l.who] - 11}">${h.esc(text[i].d)}<tspan class="t" dx="7">${h.esc(text[i].t)}</tspan>${lastOne ? '<tspan class="n" dx="7">now</tspan>' : ''}</text>`)
      if (!lastOne) links.push(`<path class="hop" d="M${x1} ${y[l.who]} H${x1 + 5} V${y[ls[i + 1].who]} H${x1 + 10}"/>`)
      x += w
    })
    let ghost = ''
    if (ghostW) {
      const prev = ls[ls.length - 1]
      links.push(`<path class="hop nx" d="M${x - 10} ${y[prev.who]} H${x - 5} V${y[next]} H${x}"/>`)
      ghost = `<rect class="ghost" x="${x}" y="${y[next] - 7}" width="${ghostW}" height="14" rx="2"/><text class="d" x="${x}" y="${y[next] - 11}"><tspan class="t">${cur === 'you' ? 'If you approve' : 'Next'}</tspan></text>`
    }
    const lanes = ['you', 'agents', 'payer'].map((k) => `<line class="lane-l" x1="${left - 6}" x2="${W}" y1="${y[k]}" y2="${y[k]}"/><text class="ln ${k}" x="0" y="${y[k] + 4}">${k === 'you' ? 'You' : k === 'agents' ? 'Agents' : h.esc(payer)}</text>`).join('')
    const aria = ls.map((l) => `${WORD[l.who]}: ${l.labels.join(', ')}`).join('; ')
    return `<svg class="hist" viewBox="0 0 ${W} 116" width="${W}" height="116" role="img" aria-label="Handoffs so far. ${h.esc(aria)}">${lanes}${links.join('')}${segs.join('')}${ghost}</svg>`
  }

  function claimOpen(s, h, cur) {
    const c = s.claim
    const r = s.run
    const mine = r && c.open_inbox_items && c.open_inbox_items.some((i) => r.ids.includes(i.id))
    if (mine && !r.done) {
      const step = r.steps.findIndex((x) => x.state === 'active') + 1
      return `<section class="openit run" data-part="claim.open-item"><h2>${h.esc(r.title)}</h2><p>Agents are on it, step ${step} of ${r.steps.length}: ${h.esc((r.steps[step - 1] || {}).text || '')}</p></section>`
    }
    if (mine && r.failed) return `<section class="openit fail" data-part="claim.open-item"><h2>Stopped, and back with you</h2><p>${h.esc(r.failedText)}</p></section>`
    if (c.queued) return `<section class="openit run" data-part="claim.open-item"><h2>${h.esc(c.queued)}</h2>${cur === 'nobody' ? '' : `<p>The status does not change until ${h.esc(c.claim.payer.short_name)} replies. The baton has moved.</p>`}</section>`
    const it = c.openItems[0]
    if (!it) return ''
    plans[it.id] = plans[it.id] || it.copy
    known[it.id] = it
    const blocked = !s.canAct(it)
    return `<section class="openit" data-part="claim.open-item">
      <div><h2>${h.esc(it.copy.headline)}</h2>
      <p>${blocked ? h.esc(it.copy.signerNote) : `${h.esc(it.copy.stoppedBy)}${it.group_key ? ' Two more claims share this decision.' : ''}`}</p></div>
      <div class="oa">
        ${blocked ? `<span class="sig">Dr. Morgan signs this</span><button class="line" data-act="user:usr_morgan">Switch to Dr. Morgan</button>`
          : `<button class="fill" data-act="approve:${it.id}">${h.esc(it.copy.action)}</button><button class="quiet" data-act="select:${it.id}">Decide in Inbox</button>`}
      </div>
    </section>`
  }

  function claimScreen(s, h) {
    const c = s.claim
    const cl = c.claim
    const openItem = (c.open_inbox_items || [])[0]
    const iid = openItem ? openItem.id : null
    const cur = holder(s, h, cl, iid)
    const next = cur === 'you' && iid ? (LANDS[iid] === 'nobody' ? null : LANDS[iid]) : cur === 'agents' ? 'payer' : null
    const m = c.money
    const est = /^estimate/.test(m.basis || '')
    const tag = est ? ', estimate' : ''
    const denied = cl.status === 'denied'
    const dl = c.deadline || {}
    const days = dl.due_on ? h.daysUntil(dl.due_on) : null
    const timeline = [...c.timeline].reverse()
    const live = iid && s.run && s.run.ids.includes(iid) && !s.run.failed
    const laneKey = { agent: 'agents', payer: 'payer' }
    const ledger = [
      ['Billed', m.billed_cents], ['Paid', m.paid_cents], [`Allowed${tag}`, m.allowed_cents], [`Contractual${tag}`, m.contractual_cents === null ? null : -m.contractual_cents],
      [`Insurance${tag}`, m.insurance_est_cents], [`Patient${tag}`, m.patient_est_cents],
    ]
    const label = h.move(cl).who === cur ? h.move(cl).label : cur === 'agents' ? 'With the agents' : cur === 'payer' ? `Waiting on ${cl.payer.short_name}` : 'Finished'
    return `<main class="claim">
      <div class="chead" data-part="claim.header">
        <button class="back" data-act="back">Back to ${s.from === 'denials' ? 'Denials' : 'Inbox'}</button>
        <div class="ctitle">
          <div>
            <h1>${h.esc(cl.patient.display_name)} <span class="num">#${cl.number}</span></h1>
            <p>${h.esc(cl.payer.name)}, ${h.esc(c.coverage.plan_name)}. Seen ${h.dateYear(cl.dos)} by ${h.esc(c.provider_name)}, ${h.esc(c.location_name)}.${cl.icn ? ` ICN ${h.esc(cl.icn)}.` : ''}</p>
          </div>
          <div class="cfacts">
            <span class="cf"><small>Status</small><span class="stat ${cl.status}">${cap(cl.status)}</span></span>
            <span class="cf"><small>Whose move</small><span class="cfb">${baton(cur, { size: 'md', next, anim: live ? pass(0, startAt(1, 0), elapsed()) : '', trail: handed.has(iid) ? 0 : undefined })}<strong class="${cur}">${h.esc(label)}</strong></span></span>
            <span class="cf"><small>${denied ? 'At stake' : 'Billed'}</small><strong class="${denied ? 'risk' : ''}">${h.money(m.billed_cents)}</strong></span>
            <span class="cf"><small>${dl.kind === 'appeal' ? 'Appeal by' : 'Deadline'}</small><strong>${dl.due_on ? `${h.dateYear(dl.due_on)}, ${days} days` : 'None'}</strong></span>
          </div>
        </div>
        ${history(s, h, cur, next, handed.has(iid))}
      </div>
      <div class="cbody" data-scroll="claim">
        <div class="cleft">
          ${claimOpen(s, h, cur)}
          ${c.denial ? `<section class="cdenial" data-part="claim.denial">
            <h2>Denied ${h.gloss(c.denial.carc)}${c.denial.rarc ? ` ${h.gloss(c.denial.rarc)}` : ''}</h2>
            <p>${h.esc(c.denial.decoded)}.</p>
            ${c.denial.root_cause === 'ours' ? `<p class="ours"><strong>Root cause: ours.</strong> ${h.esc(cap(clean((c.timeline.find((e) => e.kind === 'root_cause') || {}).title).replace(/^root cause: ours:\s*/i, '')))}.</p>` : `<p>Root cause: ${h.esc(c.denial.root_cause)}.</p>`}
            ${dl.basis ? `<p class="q">${h.esc(dl.basis)}.</p>` : ''}
          </section>` : ''}
          <section class="cmoney" data-part="claim.money">
            <h2>Money</h2>
            <dl>${ledger.map(([k, v]) => `<div><dt>${k}</dt><dd>${h.money(v)}</dd></div>`).join('')}</dl>
            <p class="q">${est ? `Allowed, insurance and patient are estimates from the contract, ${h.esc(c.coverage.plan_name)}. ${h.esc(cl.payer.short_name)} has not agreed them.` : 'From the 835.'}</p>
          </section>
          <section class="clines" data-part="claim.lines">
            <h2>Lines</h2>
            <table>
              <thead><tr><th>Procedure</th><th>Tooth</th><th class="r">Billed</th><th class="r">Allowed${est ? ' est.' : ''}</th><th class="r">Paid</th><th>Adjustments</th></tr></thead>
              <tbody>${c.lines.map((l) => `<tr><td>${h.esc(CDT[l.cdt] || l.cdt)} <span class="q">${h.esc(l.cdt)}</span></td><td>${h.esc(l.tooth || '')}</td><td class="r">${h.money(l.fee_cents)}</td><td class="r">${h.money(l.allowed_cents)}</td><td class="r">${h.money(l.paid_cents)}</td><td>${(l.adj || []).map((a) => `${h.esc(a.group)}-${h.esc(a.code)} ${h.money(a.cents)}`).join(', ') || 'None'}</td></tr>`).join('')}</tbody>
            </table>
          </section>
          <section class="cside" data-part="claim.side">
            <h2>Attachments and acknowledgments</h2>
            <ul>
              ${(c.attachments || []).map((a) => `<li><strong>${h.gloss(a.kind.toUpperCase())}</strong> ${a.note ? h.esc(cap(a.note)) : ''}, NEA# ${h.esc(a.nea_number)}, ${h.date(a.created_at)}</li>`).join('')}
              ${(c.acks || []).map((a) => `<li>${h.esc(clean(a.message))}, ${h.date(a.at)} at ${h.time(a.at)}</li>`).join('')}
            </ul>
          </section>
        </div>
        <div class="cright">
          <section class="tline" data-part="claim.timeline">
            <h2>What happened, newest first</h2>
            <ol>${timeline.map((e) => {
              const k = laneKey[e.lane]
              return `<li><b class="rod mini ${k || 'sys'}" aria-hidden="true"></b><div><time>${h.date(e.at)} at ${h.time(e.at)}</time><p>${h.esc(clean(e.title))}</p>${e.detail ? `<small>${h.esc(clean(e.detail))}</small>` : ''}</div></li>`
            }).join('')}</ol>
          </section>
        </div>
      </div>
    </main>`
  }

  /* Denials: deadline and baton first, everything else stacked under the claim. */
  function denialRow(s, h, r) {
    const c = r.claim
    const it = r.item
    const who = holder(s, h, c, r.inbox_item_id)
    const blocked = it && !s.canAct(it) && !r.resolved
    const dl = r.deadline
    const days = dl && dl.due_on ? h.daysUntil(dl.due_on) : null
    const moved = handed.has(r.inbox_item_id)
    const caption = blocked ? 'Dr. Morgan signs' : moved ? (who === 'agents' ? 'With the agents' : who === 'payer' ? `Waiting on ${c.payer.short_name}` : 'Finished') : h.move(c).label
    return `<div class="drow" data-part="denials.row">
      <div class="dl" data-part="denials.deadline">
        ${days !== null ? `<strong>${days} days</strong><span>Appeal by ${h.dateYear(dl.due_on)}</span><small>${h.esc(dl.basis)}</small>` : '<strong class="none">No deadline</strong><span>Nothing to appeal</span>'}
      </div>
      <div class="db">${baton(who, { size: 'md', hatch: blocked, next: who === 'agents' ? 'payer' : blocked ? null : who === 'you' ? LANDS[r.inbox_item_id] : null, trail: moved ? 0 : undefined, anim: s.run && s.run.ids.includes(r.inbox_item_id) ? pass(0, startAt(s.run.ids.length, s.run.ids.indexOf(r.inbox_item_id)), elapsed()) : '' })}<span class="cap ${blocked ? 'you' : who}">${h.esc(caption)}</span></div>
      <div class="di">
        <button class="lnk" data-act="open-claim:${c.id}"><span class="name">${h.esc(c.patient.display_name)}</span> <span class="num">#${c.number}</span> <span class="tre">${h.esc(c.procedures)}</span></button>
        <p><span class="codes">${h.gloss(r.carc)}${r.rarc ? ` ${h.gloss(r.rarc)}` : ''}</span> ${h.esc(r.decoded)}</p>
        ${r.root_cause === 'ours' ? '<p class="ours-t">Root cause: ours</p>' : `<p class="q">Root cause: ${h.esc(r.root_cause)}</p>`}
      </div>
      <div class="dm"><strong class="risk">${h.money(c.billed_cents)}</strong><span>${r.patient_billable_if_lost ? 'Patient can be billed' : 'Patient cannot be billed if lost'}</span></div>
      <div class="da" data-part="denials.action">
        ${moved ? `<p>${h.esc(it.copy.doneLine)}</p>`
          : r.resolved ? '<p>Set aside for now.</p>'
            : blocked ? `<button class="line" data-act="select:${it.id}">See why</button>`
              : it ? `<button class="line" data-act="select:${it.id}">Review</button>` : ''}
      </div>
    </div>`
  }

  function denials(s, h) {
    const groups = s.denials.groups
    const rows = groups.flatMap((g) => g.rows)
    const hold = { you: 0, agents: 0, payer: 0, nobody: 0 }
    rows.forEach((r) => { hold[holder(s, h, r.claim, r.inbox_item_id)] += 1 })
    const tile = s.strip.tiles.find((t) => t.status === 'denied')
    const nextRow = rows.find((r) => r.item && !r.resolved && s.canAct(r.item))
    const part = (n, w, t) => `<strong class="${w}">${n}</strong> ${t}`
    const list = [part(hold.you, 'you', n1(hold.you) + ' yours'), part(hold.agents, 'agents', n1(hold.agents) + ' with the agents'), part(hold.payer, 'payer', n1(hold.payer) + ' with payers')]
    if (hold.nobody) list.push(part(hold.nobody, '', 'finished'))
    return `<main class="dscreen">
      <div class="dtop" data-part="denials.summary">
        <p class="dsum"><strong>${s.denials.total} denied claims</strong>, ${h.money(tile.cents)} billed. ${list.join(', ')}.</p>
        ${nextRow ? `<button class="fill" data-act="select:${nextRow.item.id}">Review ${h.esc(nextRow.item.copy.who)} #${nextRow.claim.number}</button>` : ''}
      </div>
      <div class="dlist" data-scroll="denials">
        <div class="dhead"><span>Deadline</span><span class="rl">${legend('md')}</span><span>Claim and reason</span><span>At stake</span><span></span></div>
        ${groups.map((g) => {
          const [title, sub] = g.label.split(' · ')
          return `<section class="dgroup">
            <h2>Next: ${h.esc(title.toLowerCase())}<span>${h.esc(cap(sub || ''))}. ${g.count} ${plural(g.count, 'claim')}, ${h.money(g.cents)}.</span></h2>
            ${g.rows.map((r) => denialRow(s, h, r)).join('')}
          </section>`
        }).join('')}
      </div>
    </main>`
  }
  const n1 = (n) => (n === 1 ? 'is' : 'are')

  const css = `
  .app{--paper:#EEF2F1;--sheet:#FBFCFC;--film:#16242B;--ink:#10262B;--ink2:#3F5559;--ink3:#566C70;--rule:#D2DBD9;--you:#F0B429;--you-d:#7A5200;--you-w:#FCF1D2;--agent:#0C7C86;--agent-d:#0A6570;--agent-w:#DDEEF0;--payer:#4338A3;--payer-d:#3F3599;--risk:#B3261E;--risk-w:#FBE9E6;
    --disp:'Barlow Semi Condensed','Arial Narrow',sans-serif;--body:'Atkinson Hyperlegible Next','Atkinson Hyperlegible',system-ui,sans-serif;
    position:relative;width:1440px;height:900px;overflow:hidden;background:var(--paper);color:var(--ink);font:400 14px/1.45 var(--body);display:flex;flex-direction:column}
  button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
  h1,h2,h3,h4,p,ol,ul,dl,dd{margin:0;padding:0}ol,ul{list-style:none}
  strong{font-weight:600}abbr{cursor:help}
  :focus-visible{outline:2px solid var(--ink);outline-offset:2px}
  .num{color:var(--ink2);font-variant-numeric:tabular-nums}
  .name{font-weight:600}
  .tre{color:var(--ink2)}
  .q{color:var(--ink3)}
  .amt{font-family:var(--disp);font-weight:500;font-size:17px;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
  .risk{color:var(--risk)}
  strong.you,.cap.you{color:var(--you-d)}strong.agents,.cap.agents,span.agents{color:var(--agent-d)}strong.payer,.cap.payer{color:var(--payer-d)}.cap.nobody{color:var(--ink2)}

  /* The baton line */
  .bt{--w:26px;--h:14px;--g:34px;position:relative;display:inline-block;flex:none;width:calc(var(--g)*2 + var(--w));height:var(--h);vertical-align:middle}
  .bt.md{--w:32px;--h:16px;--g:40px}
  .bt.lg{--w:64px;--h:22px;--g:104px}
  .bt::before{content:'';position:absolute;left:calc(var(--w)/2);right:calc(var(--w)/2);top:calc(50% - 1px);height:2px;background:#B9C6C4}
  .st{position:absolute;left:calc(var(--i)*var(--g) + var(--w)/2 - 1px);top:calc(50% - 4px);width:2px;height:8px;background:#94A5A5}
  .bt.lg .st{top:calc(50% - 6px);height:12px}
  .rod{position:absolute;left:0;top:0;display:block;width:var(--w);height:var(--h);transform:translateX(calc(var(--p)*var(--g)));font:600 12px/14px var(--disp);text-align:center;color:var(--ink)}
  .rod.you{background:var(--you);border-radius:99px}
  .rod.agents{background:var(--agent);border-radius:3px}
  .rod.payer{background:var(--payer);border-radius:0 9px 0 9px}
  .rod.sys{background:#94A5A5;border-radius:1px}
  .rod.hatch{background:repeating-linear-gradient(-45deg,var(--you) 0 3px,var(--you-w) 3px 6px);box-shadow:inset 0 0 0 1.5px var(--you-d)}
  .rod.gh{background:var(--paper);border:1.5px dashed #6F8585;border-radius:3px}
  .pane .rod.gh,.dlist .rod.gh{background:var(--sheet)}
  .rod.mini{position:relative;display:inline-block;--p:0;width:18px;height:10px;transform:none;vertical-align:baseline;flex:none}
  .tr{position:absolute;top:calc(50% - 2px);height:4px;left:calc(var(--l)*var(--g) + var(--w)/2);width:calc(var(--n)*var(--g));opacity:.45}
  .tr.agents{background:var(--agent)}.tr.payer{background:var(--payer)}.tr.you{background:var(--you)}
  @keyframes pass{0%{transform:translateX(calc(var(--a)*var(--g)));background:var(--you);border-radius:99px}100%{transform:translateX(calc(var(--p)*var(--g)))}}
  @keyframes tick{0%{background:var(--you);border-radius:99px}100%{}}
  @keyframes rise{0%{opacity:0;transform:translateY(5px)}100%{opacity:1;transform:none}}
  @keyframes pulse{50%{opacity:.35}}
  .lgd{position:relative;display:inline-block;--w:26px;--g:34px;width:calc(var(--g)*2 + var(--w));height:17px;font:600 12px/17px var(--disp)}
  .lgd.md{--w:32px;--g:40px;font-size:13px}.lgd.big{--w:64px;--g:104px;font-size:14px}
  .lgd em{position:absolute;left:calc(var(--i)*var(--g) + var(--w)/2);transform:translateX(-50%);font-style:normal;white-space:nowrap}
  .lgd .you{color:var(--you-d)}.lgd .agents{color:var(--agent-d)}.lgd .payer{color:var(--payer-d)}

  /* Film band */
  .top{flex:none;height:46px;background:var(--film);color:#DCE7EA;display:flex;align-items:center;gap:26px;padding:0 24px}
  .brand{display:flex;align-items:center;gap:9px;font:600 21px/1 var(--disp);color:#fff}
  .mark{position:relative;width:26px;height:10px;display:inline-block}.mark::before{content:'';position:absolute;left:0;right:0;top:4px;height:2px;background:#6F8A92}
  .mark i{position:absolute;left:0;top:0;width:12px;height:10px;border-radius:9px;background:var(--you)}
  .top nav{display:flex;align-items:center;gap:2px}
  .top nav button{padding:5px 9px;color:#B7C7CC;border-radius:4px}
  .top nav button:hover{color:#fff}
  .top nav .main{color:#fff;font-weight:600}
  .top nav .on{background:#2B3D45}
  .top nav .c{font-family:var(--disp);font-size:14px;margin-left:3px;color:var(--you)}
  .tr-side{margin-left:auto;display:flex;align-items:center;gap:18px;color:#B7C7CC;font-size:13px}
  .out{display:flex;align-items:center;gap:7px}.out i{width:7px;height:7px;border-radius:50%;background:#B7C7CC}
  .who{display:inline-flex;background:#2B3D45;border-radius:5px;padding:2px}
  .who button{padding:3px 9px;border-radius:4px;color:#B7C7CC}.who .on{background:#DCE7EA;color:var(--film);font-weight:600}

  /* Sentence and strip */
  .sum{flex:none;display:flex;justify-content:space-between;align-items:baseline;gap:24px;padding:13px 24px 9px;font:500 21px/1.2 var(--disp)}
  .sum strong{font-weight:600}
  .sum small{font:400 14px/1 var(--body);color:var(--ink2);margin-left:2px}
  .sum .rod.mini{margin-right:8px}
  .pipe{flex:none;display:flex;justify-content:space-between;align-items:center;gap:24px;padding:0 24px 9px;color:var(--ink2);font-size:13px;border-bottom:1px solid var(--rule)}
  .pipe.alone{padding-top:9px}
  .tiles{display:flex;align-items:center;gap:15px}
  .ti{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}.ti.q{color:var(--ink3);margin-left:6px}.ti strong{color:var(--ink);font:600 15px/1 var(--disp)}
  .ti.den{color:var(--ink);font-weight:600}.ti.den strong{font-size:17px;color:var(--risk)}
  .tally{display:inline-flex;gap:2px;margin-left:4px;vertical-align:middle}
  .tk{display:block;width:7px;height:13px;background:var(--ink3)}
  .tk.you{background:var(--you);border-radius:99px}.tk.agents{background:var(--agent);border-radius:2px}.tk.payer{background:var(--payer);border-radius:0 4px 0 4px}
  .tally.big{gap:4px;margin:0}.tally.big .tk{width:15px;height:26px}
  .week strong{color:var(--ink);font:600 15px/1 var(--disp)}

  /* Inbox */
  .split{flex:1;min-height:0;display:grid;grid-template-columns:592px 1fr}
  .queue{overflow-y:auto;border-right:1px solid var(--rule);padding-bottom:12px}
  .qh{position:sticky;top:0;z-index:2;background:var(--paper);display:flex;align-items:center;justify-content:space-between;padding:11px 16px 4px}
  .yt{font:600 17px/1 var(--disp);display:flex;align-items:center;gap:8px}
  .tabs{display:flex;gap:12px;font-size:13px;color:var(--ink2)}
  .tabs button{padding:2px 0;border-bottom:2px solid transparent}.tabs .on{color:var(--ink);font-weight:600;border-color:var(--ink)}
  .legend{display:flex;align-items:center;gap:14px;padding:2px 16px 3px;color:var(--ink3);font-size:12px}
  .row{display:grid;grid-template-columns:94px 1fr auto;gap:14px;align-items:center;width:100%;padding:5px 16px;text-align:left;min-height:46px}
  button.row:hover{background:#E4EBE9}
  .row.sel{background:var(--sheet);box-shadow:inset 3px 0 0 var(--ink)}
  .row.sel .rod.gh{background:var(--sheet)}
  .row.member{min-height:34px;padding-top:3px;padding-bottom:3px}
  .row.g{min-height:42px}
  .rt{min-width:0;display:block}
  .l1,.l2{display:block}
  .l2{font-size:13px;color:var(--ink2);line-height:1.35}
  .sig{color:var(--you-d);font-weight:600}
  .sub{margin:6px 16px 0;padding-top:8px;border-top:1px solid var(--rule);font-size:13px;color:var(--ink2)}
  .qnone{padding:16px;color:var(--ink2)}
  .lane{border-top:1px solid var(--rule);margin-top:6px}
  .lane+.lane{margin-top:0}
  .sh{display:flex;align-items:center;gap:8px}
  .st-t{font:600 17px/1 var(--disp)}.st-c{font:500 15px/1 var(--disp);color:var(--ink2)}
  .hd,summary{padding:10px 16px}
  summary{cursor:pointer;list-style:none;position:relative}summary::-webkit-details-marker{display:none}
  summary::after{content:'';position:absolute;right:20px;top:15px;width:7px;height:7px;border-right:2px solid var(--ink2);border-bottom:2px solid var(--ink2);transform:rotate(45deg)}
  details[open] summary::after{transform:rotate(-135deg);top:18px}
  summary:hover{background:#E4EBE9}
  .more{font-size:13px;color:var(--ink2)}
  .row.plain{min-height:46px}.row.plain.member{min-height:32px}
  .jl{padding:0 16px 3px 124px;font-size:13px;color:var(--ink2)}
    .shown{padding:8px 16px 4px 124px;font-size:13px;color:var(--ink3)}

  /* Decision */
  .pane{overflow-y:auto;background:var(--sheet);min-height:0}
  .dec{padding:22px 32px 26px}
  .dec h1{font:600 30px/1.14 var(--disp);letter-spacing:-.003em}
  .why{margin-top:7px;font-size:14.5px;color:var(--ink2);max-width:760px}
  .ours{margin-top:10px;padding:6px 10px;background:var(--risk-w);color:#9C1F18;box-shadow:inset 3px 0 0 var(--risk)}
  .relay{margin-top:14px}
  .rh,.rr{display:grid;grid-template-columns:1fr 66px 92px 272px;gap:14px;align-items:center}
  .rh{font-size:12px;color:var(--ink3);padding:0 8px 4px;border-bottom:1px solid var(--rule)}
  .rh>span:nth-child(2){text-align:right}
  .rl{justify-self:start}
  .rr{padding:7px 8px;border-bottom:1px solid var(--rule);min-height:38px}
  .rr.sel{background:#EEF2F1}
  .rr .amt{font-size:15px}
  .rc{position:relative;display:block;height:22px}
  .off{position:absolute;right:0;top:1px;font-size:13px;color:var(--ink2);background:var(--sheet);padding-left:6px}
  .lnk{text-align:left}.lnk:hover .name{text-decoration:underline}
  .stat{font-weight:600;font-size:13px;color:var(--ink2)}
  .stat.denied,.stat.rejected{color:var(--risk)}
  .bar{margin-top:14px;display:grid;grid-template-columns:auto 1fr;gap:28px;align-items:start}
  .fill{display:inline-flex;align-items:center;gap:12px;background:var(--you);color:var(--ink);font:600 17px/1 var(--disp);padding:12px 16px;border-radius:999px;white-space:nowrap}
  .fill:hover{background:#E5A615}
  kbd{font:600 12px/1 var(--disp);padding:3px 5px;border-radius:4px;background:rgba(16,38,43,.1)}
  .keys{margin-top:14px;font-size:12px;color:var(--ink3)}.keys kbd{background:#E4EBE9}
  .alt{display:flex;gap:14px;margin-top:9px;padding-left:4px;font-size:13px;color:var(--ink2)}
  .alt button{text-decoration:underline;text-underline-offset:2px;text-decoration-color:#94A5A5}.alt button:hover{color:var(--ink)}
  .touch h3,.facts h3,.after h3{font:600 14px/1.2 var(--disp);color:var(--ink2)}
  .touch ul{margin-top:4px;display:grid;grid-auto-flow:column;grid-template-rows:repeat(2,auto);justify-content:start;gap:1px 28px;font-size:13.5px}
  .touch.wide{margin-top:12px}
  .touch.side ul{grid-auto-flow:row;grid-template-rows:none}
  .blocked{grid-template-columns:1fr auto;align-items:center;padding:12px 14px;background:var(--you-w);border-radius:4px}
  .blocked h2{font:600 21px/1.1 var(--disp)}.blocked p{margin-top:3px;font-size:14px}
  .line{padding:9px 14px;border-radius:999px;box-shadow:inset 0 0 0 1.5px var(--ink);font:600 15px/1 var(--disp);white-space:nowrap}
  .line:hover{background:#E4EBE9}
  .quiet{font-size:13px;color:var(--ink2);text-decoration:underline;text-underline-offset:2px}
  .facts{margin-top:16px;display:grid;grid-template-columns:1fr 1.5fr 1fr;gap:24px}
  .facts p{margin-top:3px;font-size:13.5px;color:var(--ink)}
  .pol{margin-top:12px;font-size:13.5px;color:var(--ink2)}
  .pol.never strong{color:var(--ink)}
  .draft{margin-top:16px}
  .draft h3{font:600 17px/1.2 var(--disp)}.draft h3 span{font:400 13px/1 var(--body);color:var(--ink2);margin-left:8px}
  .draft ol{margin-top:6px;background:#fff;box-shadow:inset 0 0 0 1px var(--rule);border-radius:3px}
  .draft li{display:grid;grid-template-columns:1fr 190px;gap:18px;padding:7px 12px;border-bottom:1px solid #E7ECEB}
  .draft li:last-child{border:0}
  .say{font-size:14.5px}.cite{font-size:12px;color:var(--ink3);line-height:1.35}
  .mount{margin-top:16px;background:var(--film);color:#DCE7EA;border-radius:6px;padding:10px 12px 12px}
  .mount h3{font:600 14px/1.2 var(--disp);color:#A3B7BD}
  .frames{margin-top:7px;display:grid;gap:8px}
  .frames.n1{grid-template-columns:1fr}.frames.n2{grid-template-columns:1fr 1fr}.frames.n3{grid-template-columns:1fr 1fr 1fr}
  .frame-f{background:#0D171C;border-radius:3px;padding:9px 10px;box-shadow:inset 0 0 0 1px #2B3D45;display:flex;flex-direction:column;gap:4px}
  .frame-f h4{font:600 14px/1.2 var(--body);color:#fff}
  .frame-f p{font-size:13px;line-height:1.38;color:#DCE7EA}
  .frame-f footer{margin-top:auto;font-size:12px;line-height:1.3;color:#A3B7BD}

  /* Run */
  .kick{font-size:14px;color:var(--ink2)}
  .runhead{margin-top:16px}.runhead h2{font:600 21px/1.2 var(--disp)}
  .kick.live{color:var(--agent-d);font-weight:600}.kick.bad{color:var(--ink);max-width:760px}
    .rungrid{margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:start}
  .steps li{display:grid;grid-template-columns:22px 1fr;gap:6px;padding:4px 0;color:var(--ink3)}
  .steps i{width:14px;height:8px;margin-top:6px;border-radius:2px;box-shadow:inset 0 0 0 1.5px #94A5A5}
  .steps small{display:block;font-size:13px;color:var(--ink2)}
  .steps .done{color:var(--ink)}.steps .done i{background:var(--agent);box-shadow:none}
  .steps .active{color:var(--ink);font-weight:600}.steps .active i{background:var(--agent);box-shadow:none;animation:pulse .9s ease infinite}
  .steps .active small{font-weight:400}
  .steps .failed{color:var(--risk);font-weight:600}.steps .failed i{background:var(--risk);box-shadow:none}
  .after{animation:rise .3s ease both}
  .led{display:grid;grid-template-columns:128px auto 1fr;gap:4px 12px;align-items:center;padding:6px 0;border-bottom:1px solid var(--rule)}
  .led .k{font-weight:600}
  .led .v{font:500 17px/1.1 var(--disp);font-variant-numeric:tabular-nums}.led .v em{font-style:normal;color:var(--ink3);margin:0 2px}.led .v strong{font-size:21px}
  .led p{grid-column:1/-1;font-size:13.5px;color:var(--ink2)}
  .led.den .v strong{font-size:30px;color:var(--risk)}
  .after h3{margin-bottom:2px}
  .foot{margin-top:18px;display:flex;align-items:center;gap:12px}

  /* Claim */
  .claim,.dscreen{flex:1;min-height:0;display:flex;flex-direction:column}
  .chead{flex:none;padding:10px 24px 8px;background:var(--sheet);border-bottom:1px solid var(--rule)}
  .back{font-size:13px;color:var(--ink2);text-decoration:underline;text-underline-offset:2px}
  .ctitle{display:flex;justify-content:space-between;gap:24px;align-items:flex-end;margin:2px 0 6px}
  .ctitle h1{font:600 30px/1.1 var(--disp)}.ctitle h1 .num{font-weight:500}
  .ctitle p{font-size:13.5px;color:var(--ink2)}
  .cfacts{display:flex;gap:26px;flex:none}
  .cf{display:flex;flex-direction:column;gap:1px}
  .cf small{font-size:12px;color:var(--ink3)}
  .cfb{display:inline-flex;align-items:center;gap:10px}.cfb .rod.gh{background:var(--sheet)}
  .cf strong,.cf .stat{font:600 17px/1.15 var(--disp);white-space:nowrap}
  .hist{display:block;width:1392px;height:116px;overflow:visible}
  .lane-l{stroke:#DDE4E2;stroke-width:1}
  .ln{font:600 13px/1 var(--disp)}.ln.you{fill:var(--you-d)}.ln.agents{fill:var(--agent-d)}.ln.payer{fill:var(--payer-d)}
  .hist .d{font:400 12px/1 var(--body);fill:var(--ink3)}.hist .t{fill:var(--ink);font-size:13px}.hist .n{fill:var(--you-d);font-weight:600;font-size:13px}
  .hop{fill:none;stroke:#7E9292;stroke-width:1.5}.hop.nx{stroke-dasharray:3 3}
  .ghost{fill:none;stroke:#6F8585;stroke-width:1.5;stroke-dasharray:4 3}
  .cbody{flex:1;min-height:0;overflow-y:auto;display:grid;grid-template-columns:1fr 480px;gap:32px;padding:14px 24px 20px;align-items:start}
  .cleft{display:grid;grid-template-columns:1fr 1fr;gap:14px 28px}
  .cleft>.openit,.cleft>.clines,.cleft>.cside{grid-column:1/-1}
  .cleft h2,.cright h2{font:600 17px/1.2 var(--disp);margin-bottom:4px}
  .openit{display:flex;justify-content:space-between;align-items:center;gap:20px;background:var(--you-w);padding:11px 14px;border-radius:4px}
  .openit h2{font-size:21px}.openit p{font-size:13.5px;color:var(--ink2)}
  .openit.run{display:block;background:var(--agent-w)}.openit.fail{display:block;background:var(--risk-w)}
  .oa{display:flex;align-items:center;gap:12px;flex:none}
  .cdenial p{font-size:14px}.cdenial .ours{margin:6px 0}
  .cmoney dl{display:grid;grid-template-columns:1fr 1fr;gap:1px 20px}
  .cmoney dl div{display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid var(--rule)}
  .cmoney dt{font-size:13px;color:var(--ink2)}.cmoney dd{font:500 15px/1.3 var(--disp);font-variant-numeric:tabular-nums}
  .cmoney .q{margin-top:5px;font-size:12.5px}
  .clines table{width:100%;border-collapse:collapse;font-size:13.5px}
  .clines th{text-align:left;font-weight:400;font-size:12px;color:var(--ink3);padding:3px 8px 3px 0;border-bottom:1px solid var(--rule)}
  .clines td{padding:4px 8px 4px 0;border-bottom:1px solid var(--rule)}
  .clines .r{text-align:right;font-variant-numeric:tabular-nums}
  .tline ol{display:grid;gap:7px}
  .tline li{display:grid;grid-template-columns:18px 1fr;gap:10px}
  .tline .rod.mini{margin-top:5px}
  .tline time{font-size:12px;color:var(--ink3)}
  .tline p{font-size:13.5px;line-height:1.3}.tline small{display:block;font-size:12px;line-height:1.3;color:var(--ink3)}
  .cside ul{display:grid;grid-template-columns:1fr 1fr;gap:1px 28px}.cside li{font-size:13px;color:var(--ink2);padding:1px 0}.cside strong{color:var(--ink)}

  /* Denials */
  .dtop{flex:none;display:flex;align-items:center;justify-content:space-between;gap:24px;padding:14px 24px 12px;background:var(--sheet);border-bottom:1px solid var(--rule)}
  .dsum{font:500 21px/1.2 var(--disp)}.dsum strong{font-weight:600}
  .dlist{flex:1;min-height:0;overflow-y:auto;background:var(--sheet);padding:0 24px 20px}
  .dhead,.drow{display:grid;grid-template-columns:216px 132px 1fr 190px 170px;gap:22px}
  .dhead{position:sticky;top:0;z-index:2;background:var(--sheet);padding:9px 0 4px;font-size:12px;color:var(--ink3);align-items:end}
  .dgroup h2{font:600 17px/1.2 var(--disp);padding:9px 0 5px;margin-top:6px;border-bottom:2px solid var(--ink)}
  .dgroup h2 span{font:400 13px/1 var(--body);color:var(--ink2);margin-left:10px}
  .drow{padding:9px 0;border-bottom:1px solid var(--rule);align-items:start}
  .dl strong{display:block;font:600 21px/1.1 var(--disp);font-variant-numeric:tabular-nums}
  .dl strong.none{color:var(--ink2)}
  .dl span{display:block;font-size:13.5px}.dl small{display:block;font-size:12px;color:var(--ink3);line-height:1.3}
  .db{padding-top:4px}.db .cap{display:block;margin-top:5px;font-size:13px;font-weight:600}
  .di p{font-size:13.5px;line-height:1.35;color:var(--ink2)}
  .codes{color:var(--ink);font-weight:600;margin-right:4px}
  .ours-t{display:inline-block;margin-top:3px;padding:1px 7px;background:var(--risk-w);font-weight:600;color:#9C1F18 !important;box-shadow:inset 3px 0 0 var(--risk)}
  .dm strong{display:block;font:600 21px/1.1 var(--disp);font-variant-numeric:tabular-nums}
  .dm span{font-size:13px;color:var(--ink2)}
  .da{justify-self:end;text-align:right}.da p{font-size:13.5px;color:var(--ink2)}

  .toast{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);background:var(--film);color:#fff;padding:9px 16px;border-radius:5px;font-size:14px;animation:rise .2s ease both;z-index:5}
  @media (prefers-reduced-motion:reduce){*{animation:none !important;transition:none !important}}
  `

  window.TorchProto.register({
    id: 'd',
    name: 'Whose move',
    tagline: 'Every claim is a baton passed between you, the agents and the payer',
    premise: 'Status says what the payer decided. The baton line says whose move it is, on every row, every claim and every denial, so a billable action visibly moves work without pretending the claim has been fixed.',
    proves: ['R4', 'R5', 'H2', 'A3', 'A4', 'D1', 'D2', 'D4'],
    serves: 'Demo steps 1, 3 and 4',
    fonts: "https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:wght@400;500;600&family=Barlow+Semi+Condensed:wght@500;600&display=swap",
    autoOpen: true,
    css,
    render(s, h) {
      sync(s)
      const body = s.screen === 'claim' ? claimScreen(s, h) : s.screen === 'denials' ? denials(s, h) : inbox(s, h)
      return `<div class="app">
        ${top(s)}
        ${s.screen === 'inbox' ? sentence(s, h) : ''}
        ${pipe(s, h)}
        ${body}
        ${s.toast ? `<div class="toast" role="status">${h.esc(s.toast)}</div>` : ''}
      </div>`
    },
  })
})()
