/* Variation D1: Dashboard. A restyle of D with the owner's words as the brief: "a clean modern dashboard look,
   same functionality".

   DESIGN PLAN
   The idea: D's clarity, set in a working dashboard. A claim is still a baton, not a status, but the baton is now a
   slim three-stop track that sits on every row like a segmented progress bar. The whose-move sentence becomes three
   KPI cards, and each card carries the track with the rod at that party's stop, so the header doubles as the legend.

   Palette
     --canvas #F6F7F9  page behind the panels        --surface #FFFFFF  every panel
     --ink #161A22  --ink2 #4B5364  --ink3 #5C6577   --line #E7E9EE     soft borders
     --you #F2B01E   amber, the claim is in your hands
     --agent #0E929B teal, the agents hold it
     --payer #8A3FBC violet, a payer holds it
     --risk #BC2A22  red, money at risk and "root cause: ours" only
     --act #2A55D6   cobalt, the one action colour. Buttons, focus and the selected row. D made the button marigold;
                     here the action colour must not also mean "yours", because the party hues now carry a header.
     Shape still backs hue: You is a pill, Agents a block, Payer a leaf.

   Type
     Geist 400/500/600 with tabular numerals. Scale: 12, 13, 14, 16, 22, 34. Weight 600 only for a name, a number
     that decides something, or a heading.

   Layout
     +---------+-------------------------------------------------------------------------+
     | Logo    |  [Yours 12] [With the agents 11] [With payers 88]  [Open claims: bar]   |
     | Inbox   +-------------------------------+-----------------------------------------+
     | Denials | Yours       All Approvals ... | Headline                                |
     | ...     | [==|--|--]  J. Webb #4733  $  | Why                                     |
     |         | [==|--|--]  K. Owens #4821 $  | Claim   Status   You --- Agents --- Delta|
     |         | ...                           | [ Send 3 x-rays and resubmit ]  touches |
     | Agents  | Dr. Morgan signs              | why stopped, recommends, track record   |
     | Outage  | > With the agents 11          | draft, evidence                         |
     | Clock   | > With payers 88              |                                         |
     | Persona |                               |                                         |
     +---------+-------------------------------+-----------------------------------------+

   The one memorable thing
     The pipeline bar is drawn in neutral, because status does not say whose move it is. Only the Denied segment has
     colour, and it is made of five ticks in the holder's hue. Approve 3 slides the three rods and recolours three
     ticks, while the segment keeps its width and the number 5 stays 5.
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

  const open = (window.__torchD1open = window.__torchD1open || { agents: false, payer: false })

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
    const ghost = opt.next && opt.next !== who && STOP[opt.next] !== undefined ? `<b class="rod gh ${opt.next}" style="--p:${STOP[opt.next]}"></b>` : ''
    const from = opt.trail !== undefined && STOP[who] !== undefined && opt.trail !== STOP[who]
      ? `<u class="tr ${who}" style="--l:${Math.min(opt.trail, STOP[who])};--n:${Math.abs(opt.trail - STOP[who])}"></u>` : ''
    const rod = STOP[who] === undefined ? '' : `<b class="rod ${who}${opt.hatch ? ' hatch' : ''}${opt.count ? ' ct' : ''}" style="--p:${STOP[who]};${opt.anim || ''}">${opt.count || ''}</b>`
    const aria = opt.aria || (who === 'nobody' ? 'Nobody holds this now' : `Held by ${WORD[who]}`)
    return `<span class="bt ${opt.size || 'sm'}" role="img" aria-label="${aria}">${stops}${from}${ghost}${rod}</span>`
  }

  const legend = (size, payer) => (size === 'sm'
    ? `<span class="key" aria-hidden="true"><span><b class="rod mini you"></b>You</span><span><b class="rod mini agents"></b>Agents</span><span><b class="rod mini payer"></b>Payer</span></span>`
    : `<span class="lgd ${size}" aria-hidden="true"><em class="you" style="--i:0">You</em><em class="agents" style="--i:1">Agents</em><em class="payer" style="--i:2">${payer || 'Payer'}</em></span>`)

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

  const ICON = {
    inbox: '<path d="M3 11.5 5.2 4.6A1 1 0 0 1 6.1 4h7.8a1 1 0 0 1 .9.6l2.2 6.9V15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 11.5h4l1 2h4l1-2h4"/>',
    denials: '<circle cx="10" cy="10" r="7"/><path d="m7.5 7.5 5 5m0-5-5 5"/>',
    "Today's claims": '<rect x="3.5" y="4.5" width="13" height="12" rx="1.5"/><path d="M3.5 8.5h13M7 3v3m6-3v3"/><path d="m7.5 12.5 1.8 1.6 3.2-3.2"/>',
    Claims: '<path d="M5 3.5h6.5L15 7v9a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 5 16z"/><path d="M11.5 3.5V7H15M7.5 10.5h5m-5 3h5"/>',
    Payments: '<rect x="2.5" y="5" width="15" height="10.5" rx="1.5"/><path d="M2.5 8.5h15m-12 4h3"/>',
    Patients: '<circle cx="8" cy="7" r="3"/><path d="M2.8 16c.6-2.8 2.6-4.2 5.2-4.2s4.6 1.4 5.2 4.2"/><path d="M13 4.3a3 3 0 0 1 0 5.4m1.6 2.4c1.4.6 2.3 1.9 2.6 3.9"/>',
    Eligibility: '<path d="m10 3 5.5 2v4.5c0 3.4-2.2 6-5.5 7.3-3.3-1.3-5.5-3.9-5.5-7.3V5z"/><path d="m7.5 10 1.8 1.8 3.2-3.4"/>',
    Activity: '<path d="M2.5 10.5h3.2l2-6 4.4 11 2-5h3.4"/>',
    Settings: '<path d="M3.5 6h8m4 0h1M3.5 14h1m4 0h8"/><circle cx="13.5" cy="6" r="2"/><circle cx="6.5" cy="14" r="2"/>',
  }
  const icon = (k) => `<svg class="ic" viewBox="0 0 20 20" aria-hidden="true">${ICON[k]}</svg>`

  function sidebar(s, h) {
    const links = ["Today's claims", 'Claims', 'Payments', 'Patients', 'Eligibility', 'Activity', 'Settings']
    const cur = s.screen
    const r = s.run
    const t = totals(s, h)
    const step = r && !r.done ? r.steps.findIndex((x) => x.state === 'active') + 1 : 0
    const status = r && !r.done
      ? `<strong class="agents">Agents are running this now.</strong> ${h.esc(r.title)}, step ${step} of ${r.steps.length}.`
      : `This week agents ran <strong>${s.week.ranAlone}</strong> on their own. <strong>${s.week.cameToYou}</strong> came to you.`
    return `<aside class="rail">
      <span class="brand"><span class="mark" aria-hidden="true"><i></i></span>TorchRCM</span>
      <nav data-part="shell.nav">
        <button class="nv${cur === 'inbox' ? ' on' : ''}" data-act="nav:inbox"${cur === 'inbox' ? ' aria-current="page"' : ''}>${icon('inbox')}Inbox<span class="c">${t.yours}</span></button>
        <button class="nv${cur === 'denials' ? ' on' : ''}" data-act="nav:denials"${cur === 'denials' ? ' aria-current="page"' : ''}>${icon('denials')}Denials</button>
        <span class="nsep" aria-hidden="true"></span>
        ${links.map((l) => `<button class="nv" data-act="nav:${l}">${icon(l)}${l}</button>`).join('')}
      </nav>
      <div class="sfoot">
        <p class="ag${r && !r.done ? ' live' : ''}" data-part="shell.agent-summary">${status}</p>
        <p class="out" data-part="shell.outage" title="${s.outage}"><i></i>Cigna portal unreachable</p>
        <div class="ctl" data-part="shell.demo-controls">
          <span class="clk" title="Demo clock, frozen">${clockText(s)}</span>
          <span class="who" role="group" aria-label="Signed in as">
            ${s.users.map((u) => `<button class="${u.id === s.user.id ? 'on' : ''}" data-act="user:${u.id}" title="${u.title}">${u.name}</button>`).join('')}
          </span>
        </div>
      </div>
    </aside>`
  }

  function kpis(s, h) {
    const t = totals(s, h)
    const agentsDetail = t.just > 0 ? `${t.ready} ready, ${t.sent} sent, ${t.just} handed over` : `${t.ready} ready and ${t.sent} sent`
    const card = (who, label, n, unit, sub) => `<div class="kpi ${who}">
      <div class="kh"><span>${label}</span>${baton(who, { aria: `Baton at ${WORD[who]}` })}</div>
      <p class="kn"><strong>${n}</strong><span>${unit}</span></p>
      <p class="ks">${sub}</p>
    </div>`
    return `<div class="kpis" data-part="shell.header" title="These add up to the ${s.strip.open_count} open claims, plus ${t.paidYours} paid ${plural(t.paidYours, 'claim')} still in your Inbox, and ${t.visits} upcoming visits.">
      ${card('you', 'Yours', t.yours, plural(t.yours, 'item'), `${t.claims} ${plural(t.claims, 'claim')}, ${t.visits} upcoming ${plural(t.visits, 'visit')}`)}
      ${card('agents', 'With the agents', t.agents, 'claims', agentsDetail)}
      ${card('payer', 'With payers', t.payers, 'claims', 'Waiting on a reply')}
    </div>`
  }

  function tally(s, h, mode) {
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
    return `<span class="tally${mode ? ` ${mode}` : ''}" role="img" aria-label="${parts}" title="${parts}">${out}</span>`
  }

  const tileLabel = (t) => clean(t.label).replace(',', '')

  /* Drawn to scale from the strip. Neutral, because status is not whose move. Only Denied carries the holder's hue. */
  function pipeline(s, h) {
    const open = s.strip.tiles.filter((t) => t.status !== 'paid')
    const paid = s.strip.tiles.find((t) => t.status === 'paid')
    const bar = open.map((t) => (t.status === 'denied'
      ? `<span class="sg den" style="flex:${t.count} 0 0" title="${tileLabel(t)} ${t.count}">${tally(s, h, 'inbar')}</span>`
      : `<span class="sg" style="flex:${t.count} 0 0" title="${tileLabel(t)} ${t.count}"></span>`)).join('')
    const cells = open.map((t) => `<span class="ti${t.status === 'denied' ? ' den' : ''}"><span>${tileLabel(t)}</span><strong>${t.count}</strong></span>`).join('')
    return `<div class="plc" data-part="shell.pipeline">
      <div class="ph"><span><strong>${s.strip.open_count} open</strong>, ${h.money(s.strip.ar_cents)} A/R</span>${paid ? `<span>${tileLabel(paid)} <strong>${paid.count}</strong></span>` : ''}</div>
      <div class="sbar" role="img" aria-label="Open claims by status, to scale">${bar}</div>
      <div class="tgrid">${cells}</div>
    </div>`
  }

  function slimPipe(s, h) {
    return `<div class="pipe" data-part="shell.pipeline">
      ${s.strip.tiles.map((t) => (t.status === 'denied'
        ? `<span class="ti den"><span>${tileLabel(t)}</span><strong>${t.count}</strong>${tally(s, h)}</span>`
        : `<span class="ti"><span>${tileLabel(t)}</span><strong>${t.count}</strong></span>`)).join('')}
      <span class="ti q">${s.strip.open_count} open, ${h.money(s.strip.ar_cents)} A/R</span>
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
    const details = (label) => `<details class="sec" ${open[key] ? 'open' : ''} ontoggle="window.__torchD1open.${key}=this.open"><summary>${label}</summary><div class="list">${listRows}</div></details>`
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
    return `<section class="evs" data-part="inbox.evidence">
      <h3>What the agent read</h3>
      <div class="evl">
        ${list.map((e) => `<article class="ev">
          <div><h4>${h.esc(clean(e.title))}</h4><footer>${EV_KIND[e.kind] || 'Record'}, ${h.date(e.captured_at)} at ${h.time(e.captured_at)}${e.ref ? `, ref ${h.esc(e.ref)}` : ''}</footer></div>
          <p>${h.esc(e.excerpt)}</p>
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
        ${isDenied ? tally(s, h, 'big') : ''}
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
    const W = 1158
    const left = 62
    const ghostW = next && next !== cur ? 100 : 0
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
        <button class="back" data-act="back"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 3.5 5 8l4.5 4.5"/></svg>Back to ${s.from === 'denials' ? 'Denials' : 'Inbox'}</button>
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
    const part = (w, n, t) => `<span class="dst"><span class="dsh">${baton(w)}<span>${t}</span></span><strong class="${w}">${n}</strong></span>`
    return `<main class="dscreen">
      <div class="dtop" data-part="denials.summary">
        <p class="dsum"><strong>${s.denials.total}</strong><span>denied claims<br>${h.money(tile.cents)} billed</span></p>
        <div class="dparts">
          ${part('you', hold.you, 'Yours')}
          ${part('agents', hold.agents, 'With the agents')}
          ${part('payer', hold.payer, 'With payers')}
          ${hold.nobody ? `<span class="dst"><span class="dsh"><span>Finished</span></span><strong>${hold.nobody}</strong></span>` : ''}
        </div>
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

  const css = `
  .app{--canvas:#F6F7F9;--surface:#FFFFFF;--sunk:#F8F9FB;--hover:#F2F4F7;--line:#E7E9EE;--line2:#D8DCE3;--track:#E6E9EF;
    --ink:#161A22;--ink2:#4B5364;--ink3:#5C6577;
    --you:#F2B01E;--you-d:#8A5B00;--you-n:#9C6600;--you-w:#FEF5DF;
    --agent:#0E929B;--agent-d:#0B7480;--agent-w:#E4F4F5;
    --payer:#8A3FBC;--payer-d:#7A32A8;--payer-w:#F5EDFA;
    --risk:#BC2A22;--risk-d:#A8231C;--risk-w:#FDECEA;--risk-l:#F6CFCB;
    --act:#2A55D6;--act-h:#2348BC;--act-w:#EFF3FE;
    --e:0 1px 2px rgba(22,26,34,.04);
    --sans:'Geist','Inter',system-ui,-apple-system,sans-serif;
    position:relative;width:1440px;height:900px;overflow:hidden;background:var(--canvas);color:var(--ink);font:400 14px/1.45 var(--sans);font-variant-numeric:tabular-nums;display:grid;grid-template-columns:208px 1fr}
  button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
  h1,h2,h3,h4,p,ol,ul,dl,dd{margin:0;padding:0;font-weight:inherit}ol,ul{list-style:none}
  strong{font-weight:600}abbr{cursor:help}
  :focus-visible{outline:2px solid var(--act);outline-offset:2px;border-radius:4px}
  .num{color:var(--ink2)}
  .name{font-weight:600}
  .tre{color:var(--ink2)}
  .q{color:var(--ink3)}
  .amt{font-weight:500;text-align:right;white-space:nowrap}
  .risk{color:var(--risk)}
  strong.you,.cap.you{color:var(--you-d)}strong.agents,.cap.agents,span.agents{color:var(--agent-d)}strong.payer,.cap.payer{color:var(--payer-d)}.cap.nobody{color:var(--ink2)}

  /* The baton: a three-stop track, one rod. Position, hue and shape all say the same thing. */
  .bt{--w:20px;--h:9px;--g:23px;position:relative;display:inline-block;flex:none;width:calc(var(--g)*2 + var(--w));height:var(--h);vertical-align:middle}
  .bt.md{--w:34px;--h:10px;--g:44px}
  .bt.lg{--w:50px;--h:12px;--g:60px}
  .st{position:absolute;left:calc(var(--i)*var(--g));top:0;width:var(--w);height:var(--h);background:var(--track);border-radius:3px}
  .rod{position:absolute;left:0;top:0;display:block;width:var(--w);height:var(--h);transform:translateX(calc(var(--p)*var(--g)));font:600 12px/16px var(--sans);text-align:center;color:var(--ink)}
  .rod.you{background:var(--you);border-radius:99px}
  .rod.agents{background:var(--agent);border-radius:2px}
  .rod.payer{background:var(--payer);border-radius:0 7px 0 7px}
  .rod.sys{background:#A7AFBC;border-radius:2px}
  .rod.ct{height:16px;top:calc(50% - 8px)}
  .rod.hatch{background:repeating-linear-gradient(-45deg,var(--you) 0 3px,#fff 3px 5.5px);box-shadow:inset 0 0 0 1px var(--you-d)}
  .rod.gh{background:var(--surface);border:1.25px dashed var(--ink3);border-radius:3px}
  .rod.gh.agents{border-color:var(--agent-d)}.rod.gh.payer{border-color:var(--payer-d)}
  .rod.mini{position:relative;display:inline-block;--p:0;width:16px;height:9px;transform:none;vertical-align:baseline;flex:none}
  .tr{position:absolute;top:0;height:var(--h);left:calc(var(--l)*var(--g));width:calc(var(--n)*var(--g) + var(--w));opacity:.28;border-radius:3px}
  .tr.agents{background:var(--agent)}.tr.payer{background:var(--payer)}.tr.you{background:var(--you)}
  @keyframes pass{0%{transform:translateX(calc(var(--a)*var(--g)));background:var(--you);border-radius:99px}100%{transform:translateX(calc(var(--p)*var(--g)))}}
  @keyframes tick{0%{background:var(--you);border-radius:99px}100%{}}
  @keyframes rise{0%{opacity:0;transform:translateY(5px)}100%{opacity:1;transform:none}}
  @keyframes pulse{50%{box-shadow:0 0 0 5px rgba(14,146,155,.14)}}
  .key{display:inline-flex;gap:12px;color:var(--ink2);font-weight:500}
  .key>span{display:inline-flex;align-items:center;gap:5px}
  .lgd{position:relative;display:inline-block;--w:20px;--g:23px;width:calc(var(--g)*2 + var(--w));height:18px;font:500 12px/18px var(--sans)}
  .lgd.md{--w:34px;--g:44px}.lgd.big{--w:50px;--g:60px}
  .lgd em{position:absolute;left:calc(var(--i)*var(--g) + var(--w)/2);transform:translateX(-50%);font-style:normal;white-space:nowrap}
  .lgd .you{color:var(--you-d)}.lgd .agents{color:var(--agent-d)}.lgd .payer{color:var(--payer-d)}

  /* Sidebar */
  .rail{display:flex;flex-direction:column;min-height:0;background:var(--surface);border-right:1px solid var(--line);padding:16px 12px 14px}
  .brand{display:flex;align-items:center;gap:9px;padding:2px 6px 16px;font:600 16px/24px var(--sans);letter-spacing:-.012em}
  .mark{position:relative;width:24px;height:24px;border-radius:6px;background:var(--ink);display:inline-block}
  .mark::before{content:'';position:absolute;left:5px;right:5px;top:11px;height:2px;background:#6C7586}
  .mark i{position:absolute;left:5px;top:8.5px;width:8px;height:7px;border-radius:9px;background:var(--you)}
  .rail nav{display:flex;flex-direction:column;gap:1px}
  .nv{display:flex;align-items:center;gap:10px;width:100%;height:34px;padding:0 8px;border-radius:7px;color:var(--ink2);text-align:left}
  .nv:hover{background:var(--hover);color:var(--ink)}
  .nv.on{background:var(--hover);color:var(--ink);font-weight:500}
  .ic{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
  .nv .c{margin-left:auto;min-width:22px;padding:0 6px;border-radius:99px;background:var(--you-w);color:var(--you-d);font-size:12px;font-weight:600;line-height:20px;text-align:center}
  .nsep{height:1px;background:var(--line);margin:8px}
  .sfoot{margin-top:auto;display:flex;flex-direction:column;gap:12px;padding:0 6px}
  .ag{font-size:13px;line-height:1.45;color:var(--ink2)}
  .ag strong{color:var(--ink)}.ag strong.agents{color:var(--agent-d)}
  .out{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--ink3)}.out i{width:6px;height:6px;border-radius:50%;background:#A7AFBC;flex:none}
  .ctl{display:flex;flex-direction:column;gap:7px;padding-top:12px;border-top:1px solid var(--line)}
  .clk{font-size:12px;color:var(--ink3)}
  .who{display:flex;background:var(--hover);border-radius:7px;padding:2px}
  .who button{flex:1;padding:4px 0;border-radius:5px;color:var(--ink2);font-size:12.5px;white-space:nowrap}
  .who .on{background:var(--surface);color:var(--ink);font-weight:500;box-shadow:0 0 0 1px var(--line),var(--e)}

  /* Main */
  .main{position:relative;min-width:0;min-height:0;display:flex;flex-direction:column}
  .dash{flex:none;display:grid;grid-template-columns:744px 1fr;gap:12px;padding:14px 16px 12px}
  .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
  .kpi,.plc{height:108px;background:var(--surface);border:1px solid var(--line);border-radius:10px;box-shadow:var(--e);padding:12px 16px}
  .kh{display:flex;align-items:center;justify-content:space-between;font-size:13px;line-height:18px;font-weight:500;color:var(--ink2)}
  .kn{margin-top:4px;display:flex;align-items:baseline;gap:6px}
  .kn strong{font-size:34px;line-height:38px;letter-spacing:-.022em;font-variant-numeric:proportional-nums}
  .kn span{font-size:13px;color:var(--ink2)}
  .kpi.you .kn strong{color:var(--you-n)}.kpi.agents .kn strong{color:var(--agent-d)}.kpi.payer .kn strong{color:var(--payer-d)}
  .ks{margin-top:1px;font-size:12px;line-height:16px;color:var(--ink3);white-space:nowrap}
  .ph{display:flex;justify-content:space-between;font-size:13px;line-height:18px;color:var(--ink2)}
  .ph strong{color:var(--ink);font-weight:600}
  .sbar{display:flex;gap:2px;height:10px;margin-top:7px}
  .sg{min-width:2px;background:#CBD1DB;border-radius:2px}
  .sg:nth-child(even){background:#DDE1E8}
  .sg.den{background:none;display:flex}
  .tgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:1px 12px;margin-top:8px}
  .ti{display:flex;align-items:center;gap:5px;font-size:12.5px;line-height:17px;color:var(--ink2);white-space:nowrap}
  .ti strong{color:var(--ink);font-weight:600}
  .ti.den{color:var(--risk-d);font-weight:500}.ti.den strong{color:var(--risk-d)}
  .pipe{flex:none;display:flex;align-items:center;gap:22px;padding:12px 20px 11px}
  .pipe .ti{font-size:13px}
  .pipe .ti.q{margin-left:auto;color:var(--ink3)}
  .tally{display:inline-flex;gap:2px;vertical-align:middle}
  .tk{display:block;width:6px;height:12px;background:var(--ink3)}
  .tk.you{background:var(--you);border-radius:99px}.tk.agents{background:var(--agent);border-radius:1.5px}.tk.payer{background:var(--payer);border-radius:0 4px 0 4px}
  .tally.inbar{display:flex;flex:1;gap:1px;height:10px}.tally.inbar .tk{flex:1;width:auto;height:10px}
  .tally.big{gap:4px}.tally.big .tk{width:12px;height:24px}

  /* Inbox */
  .split{flex:1;min-height:0;display:grid;grid-template-columns:516px 1fr;gap:12px;padding:0 16px 14px}
  .queue,.pane{min-height:0;overflow-y:auto;background:var(--surface);border:1px solid var(--line);border-radius:10px;box-shadow:var(--e)}
  .queue{padding-bottom:8px}
  .qh{position:sticky;top:-1px;z-index:2;background:var(--surface);display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 16px 8px;border-radius:10px 10px 0 0}
  .yt{font-size:16px;line-height:22px;font-weight:600;display:flex;align-items:center;gap:8px}
  .tabs{display:flex;gap:2px;font-size:13px;color:var(--ink2)}
  .tabs button{padding:3px 8px;border-radius:6px}.tabs button:hover{background:var(--hover)}
  .tabs .on{background:var(--hover);color:var(--ink);font-weight:500}
  .tabs span{color:var(--ink3)}
  .legend{display:flex;align-items:center;justify-content:space-between;padding:0 16px 8px;color:var(--ink3);font-size:12px}
  .row{display:grid;grid-template-columns:66px 1fr auto;column-gap:12px;align-items:center;width:calc(100% - 16px);margin:0 8px;padding:7px 8px;min-height:52px;border-radius:8px;text-align:left}
  button.row:hover{background:var(--hover)}
  .row.sel,button.row.sel:hover{background:var(--act-w);box-shadow:inset 0 0 0 1px #CBD8F9}
  .row>.bt{grid-column:1;grid-row:1/3}
  .rt{display:contents}
  .l1{grid-column:2;grid-row:1;min-width:0}
  .row>.amt{grid-column:3;grid-row:1}
  .l2{grid-column:2/4;grid-row:2;font-size:13px;line-height:18px;color:var(--ink2)}
  .row.member{min-height:36px;padding-top:4px;padding-bottom:4px}
  .row.g{min-height:44px}
  .sig{color:var(--you-d);font-weight:600}
  .sub{margin:8px 16px 4px;padding-top:10px;border-top:1px solid var(--line);font-size:13px;color:var(--ink2)}
  .qnone{padding:16px;color:var(--ink2)}
  .lane{border-top:1px solid var(--line);margin-top:8px}
  .lane+.lane{margin-top:0}
  .sh{display:flex;align-items:center;gap:8px}
  .st-t{font-weight:600}.st-c{color:var(--ink2);font-size:13px}
  .hd,summary{padding:11px 16px}
  summary{cursor:pointer;list-style:none;position:relative}summary::-webkit-details-marker{display:none}
  summary::after{content:'';position:absolute;right:20px;top:16px;width:6px;height:6px;border-right:1.5px solid var(--ink3);border-bottom:1.5px solid var(--ink3);transform:rotate(45deg)}
  details[open] summary::after{transform:rotate(-135deg);top:19px}
  summary:hover{background:var(--hover)}
  .more{font-size:13px;color:var(--ink2)}
  .row.plain{min-height:52px}.row.plain.member{min-height:36px}
  .jl{padding:0 16px 4px 94px;font-size:13px;color:var(--ink2)}
  .shown{padding:8px 16px 4px 94px;font-size:13px;color:var(--ink3)}

  /* Decision */
  .dec{padding:20px 24px 22px}
  .dec h1{font-size:22px;line-height:1.25;font-weight:600;letter-spacing:-.014em;text-wrap:balance}
  .why{margin-top:6px;color:var(--ink2);line-height:1.5}
  .ours{margin-top:12px;padding:8px 12px;background:var(--risk-w);color:var(--risk-d);border:1px solid var(--risk-l);border-radius:7px}
  .relay{margin-top:16px;border:1px solid var(--line);border-radius:8px}
  .rh,.rr{display:grid;grid-template-columns:1fr 54px 96px 170px;gap:12px;align-items:center;padding:0 12px}
  .rh{height:32px;font-size:12px;font-weight:500;color:var(--ink3);background:var(--sunk);border-bottom:1px solid var(--line);border-radius:8px 8px 0 0}
  .rh>span:nth-child(2){text-align:right}
  .rl{justify-self:start}
  .rr{min-height:42px;padding-top:6px;padding-bottom:6px;border-bottom:1px solid var(--line)}
  .rr:last-child{border-bottom:0}
  .rr.sel{background:var(--act-w)}
  .rc{position:relative;display:flex;align-items:center;height:22px}
  .off{position:absolute;right:0;top:1px;font-size:13px;color:var(--ink2);background:var(--surface);padding-left:6px}
  .lnk{text-align:left}.lnk:hover .name{text-decoration:underline;text-underline-offset:2px}
  .stat{display:inline-block;justify-self:start;padding:1px 8px;border-radius:99px;background:#EEF0F4;color:var(--ink2);font-size:12px;line-height:18px;font-weight:500;white-space:nowrap}
  .stat.denied,.stat.rejected{background:var(--risk-w);color:var(--risk-d)}
  .bar{margin-top:14px;display:grid;grid-template-columns:auto 1fr;gap:24px;align-items:start}
  .fill{display:inline-flex;align-items:center;gap:10px;height:40px;padding:0 16px;background:var(--act);color:#fff;font-weight:600;border-radius:8px;white-space:nowrap;box-shadow:0 1px 2px rgba(42,85,214,.24)}
  .fill:hover{background:var(--act-h)}
  kbd{font:500 12px/1 var(--sans);padding:3px 5px;border-radius:4px;background:rgba(10,20,60,.28)}
  .keys{margin-top:14px;font-size:12px;color:var(--ink3)}.keys kbd{background:var(--hover);border:1px solid var(--line);color:var(--ink2)}
  .alt{display:flex;gap:4px;margin-top:6px;font-size:13px;color:var(--ink2)}
  .alt button{padding:3px 8px;border-radius:6px}.alt button:hover{background:var(--hover);color:var(--ink)}
  .touch h3,.facts h3,.after h3,.evs h3{font-size:13px;font-weight:600;line-height:18px}
  .touch ul{margin-top:3px;font-size:13px;color:var(--ink2)}
  .touch li{position:relative;padding-left:13px;line-height:1.45}
  .touch li::before{content:'';position:absolute;left:0;top:7px;width:4px;height:4px;border-radius:50%;background:#A7AFBC}
  .touch.wide{margin-top:14px}
  .blocked{grid-template-columns:1fr auto;gap:16px;align-items:center;padding:14px 16px;background:var(--you-w);border:1px solid #F7E2AE;border-radius:8px}
  .blocked h2{font-size:16px;line-height:22px;font-weight:600}.blocked p{margin-top:2px;font-size:13px;color:var(--ink)}
  .line{display:inline-flex;align-items:center;height:36px;padding:0 13px;border-radius:8px;background:var(--surface);border:1px solid var(--line2);font-weight:500;white-space:nowrap}
  .line:hover{background:var(--hover)}
  .quiet{font-size:13px;color:var(--ink2);padding:3px 6px;border-radius:6px}.quiet:hover{background:var(--hover);color:var(--ink)}
  .facts{margin-top:16px;padding-top:14px;border-top:1px solid var(--line);display:grid;grid-template-columns:1fr 1.35fr 1fr;gap:20px}
  .facts p{margin-top:2px;font-size:13px;color:var(--ink2);line-height:1.45}.facts strong{color:var(--ink)}
  .pol{margin-top:12px;padding:8px 12px;background:var(--sunk);border-radius:7px;font-size:13px;color:var(--ink2)}
  .pol strong{color:var(--ink)}
  .draft{margin-top:16px}
  .draft h3{font-size:14px;font-weight:600;line-height:20px}.draft h3 span{font-size:13px;font-weight:400;color:var(--ink2);margin-left:6px}
  .draft ol{margin-top:6px;border:1px solid var(--line);border-radius:8px}
  .draft li{display:grid;grid-template-columns:1fr 168px;gap:16px;padding:8px 12px;border-bottom:1px solid var(--line)}
  .draft li:last-child{border:0}
  .cite{font-size:12px;color:var(--ink3);line-height:1.4}
  .evs{margin-top:16px}
  .evl{margin-top:6px;border:1px solid var(--line);border-radius:8px;background:var(--sunk)}
  .ev{display:grid;grid-template-columns:186px 1fr;gap:16px;padding:9px 12px;border-bottom:1px solid var(--line)}
  .ev:last-child{border:0}
  .ev h4{font-size:13px;font-weight:600;line-height:1.35}
  .ev footer{margin-top:2px;font-size:12px;line-height:1.35;color:var(--ink3)}
  .ev p{font-size:13px;line-height:1.45;color:var(--ink)}

  /* Run */
  .kick{font-size:13px;color:var(--ink2)}
  .runhead{margin-top:16px}.runhead h2{font-size:16px;line-height:22px;font-weight:600}
  .kick.live{color:var(--agent-d);font-weight:500;margin-top:2px}
  .kick.bad{margin-top:4px;color:var(--ink)}
  .fail .runhead{padding:12px 14px;background:var(--risk-w);border:1px solid var(--risk-l);border-radius:8px}
  .fail .runhead h2{color:var(--risk-d)}
  .rungrid{margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start}
  .steps li{position:relative;display:grid;grid-template-columns:16px 1fr;gap:10px;padding:0 0 12px;color:var(--ink3)}
  .steps li:last-child{padding-bottom:0}
  .steps li:not(:last-child)::before{content:'';position:absolute;left:7px;top:19px;bottom:1px;width:2px;background:var(--line)}
  .steps li.done:not(:last-child)::before{background:var(--agent)}
  .steps i{position:relative;width:16px;height:16px;margin-top:2px;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--line2);background:var(--surface)}
  .steps small{display:block;font-size:13px;color:var(--ink2)}
  .steps .done{color:var(--ink)}.steps .done i{background:var(--agent);box-shadow:none}
  .steps .done i::after{content:'';position:absolute;left:5px;top:3px;width:4px;height:7px;border:solid #fff;border-width:0 1.75px 1.75px 0;transform:rotate(42deg)}
  .steps .active{color:var(--ink);font-weight:500}
  .steps .active i{box-shadow:inset 0 0 0 5px var(--agent);animation:pulse 1.1s ease infinite}
  .steps .active small{font-weight:400}
  .steps .failed{color:var(--risk-d);font-weight:500}.steps .failed i{background:var(--risk);box-shadow:none}
  .steps .failed i::after{content:'';position:absolute;left:7.25px;top:3.5px;width:1.5px;height:9px;background:#fff;transform:rotate(45deg);box-shadow:none}
  .steps .failed i::before{content:'';position:absolute;left:7.25px;top:3.5px;width:1.5px;height:9px;background:#fff;transform:rotate(-45deg)}
  .after{animation:rise .3s ease both;padding:12px 14px;background:var(--sunk);border:1px solid var(--line);border-radius:8px}
  .led{display:flex;flex-wrap:wrap;align-items:center;gap:2px 10px;padding:7px 0;border-top:1px solid var(--line)}
  .after h3+.led{margin-top:6px}
  .led .k{font-weight:500;margin-right:auto}
  .led .v{font-size:14px;color:var(--ink2);white-space:nowrap}.led .v em{font-style:normal;color:var(--ink3);margin:0 2px}.led .v strong{font-size:16px;color:var(--ink)}
  .led p{flex-basis:100%;font-size:13px;color:var(--ink2)}
  .led.den{padding-bottom:0}
  .led.den .k{color:var(--risk-d)}
  .led.den .v{display:inline-flex;align-items:center;gap:4px}.led.den .v strong{font-size:34px;line-height:38px;letter-spacing:-.02em;font-variant-numeric:proportional-nums;color:var(--risk-d)}
  .foot{margin-top:16px;display:flex;align-items:center;gap:10px}
  .empty{padding-top:56px}

  /* Claim */
  .claim,.dscreen{flex:1;min-height:0;display:flex;flex-direction:column}
  .card,.chead,.dtop,.openit,.cdenial,.cmoney,.clines,.cside,.tline,.dlist{background:var(--surface);border:1px solid var(--line);border-radius:10px;box-shadow:var(--e)}
  .chead{flex:none;margin:0 16px 12px;padding:10px 20px 10px}
  .back{display:inline-flex;align-items:center;gap:3px;margin-left:-5px;padding:2px 6px 2px 2px;border-radius:6px;font-size:13px;color:var(--ink2)}
  .back:hover{background:var(--hover);color:var(--ink)}
  .back svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
  .ctitle{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin:4px 0 8px}
  .ctitle h1{font-size:22px;line-height:1.25;font-weight:600;letter-spacing:-.014em}.ctitle h1 .num{font-weight:400}
  .ctitle p{margin-top:2px;font-size:13px;color:var(--ink2);max-width:520px}
  .cfacts{display:flex;gap:24px;flex:none}
  .cf{display:flex;flex-direction:column;gap:3px}
  .cf small{font-size:12px;color:var(--ink3)}
  .cfb{display:inline-flex;align-items:center;gap:10px}
  .cf strong{font-size:14px;line-height:20px;font-weight:600;white-space:nowrap}
  .cf .stat{align-self:flex-start}
  .hist{display:block;width:1158px;height:116px;overflow:visible}
  .hist text{paint-order:stroke;stroke:var(--surface);stroke-width:4px;stroke-linejoin:round}
  .lane-l{stroke:var(--line);stroke-width:1}
  .ln{font:500 13px/1 var(--sans)}.ln.you{fill:var(--you-d)}.ln.agents{fill:var(--agent-d)}.ln.payer{fill:var(--payer-d)}
  .hist .d{font:400 12px/1 var(--sans);fill:var(--ink3)}.hist .t{fill:var(--ink);font-size:13px}.hist .n{fill:var(--you-d);font-weight:600;font-size:13px}
  .hop{fill:none;stroke:#A7AFBC;stroke-width:1.25}.hop.nx{stroke-dasharray:3 3}
  .ghost{fill:none;stroke:var(--ink3);stroke-width:1.25;stroke-dasharray:4 3}
  .cbody{flex:1;min-height:0;overflow-y:auto;display:grid;grid-template-columns:1fr 416px;gap:12px;padding:0 16px 16px;align-items:start}
  .cleft{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .cleft>.openit,.cleft>.clines,.cleft>.cside{grid-column:1/-1}
  .cleft h2,.cright h2{font-size:14px;line-height:20px;font-weight:600;margin-bottom:6px}
  .cdenial,.cmoney,.clines,.cside,.tline{padding:14px 16px}
  .openit{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:14px 16px;background:var(--you-w);border-color:#F7E2AE;box-shadow:none}
  .openit h2{font-size:16px;line-height:22px;margin:0}.openit p{font-size:13px;color:var(--ink2)}
  .openit.run{display:block;background:var(--agent-w);border-color:#C6E6E8}.openit.fail{display:block;background:var(--risk-w);border-color:var(--risk-l)}
  .openit.fail h2{color:var(--risk-d)}
  .oa{display:flex;align-items:center;gap:8px;flex:none}
  .cdenial p{font-size:13px;line-height:1.45}.cdenial .ours{margin:8px 0;padding:6px 10px}
  .cdenial abbr{text-decoration-thickness:1px;text-underline-offset:2px}
  .cmoney dl{display:grid;grid-template-columns:1fr}
  .cmoney dl div{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--line)}
  .cmoney dt{font-size:13px;color:var(--ink2)}.cmoney dd{font-size:13px;font-weight:500}
  .cmoney .q{margin-top:6px;font-size:12px;line-height:1.4}
  .clines table{width:100%;border-collapse:collapse;font-size:13px}
  .clines th{text-align:left;font-weight:500;font-size:12px;color:var(--ink3);padding:4px 8px 4px 0;border-bottom:1px solid var(--line)}
  .clines td{padding:6px 8px 6px 0;border-bottom:1px solid var(--line)}
  .clines tr:last-child td{border-bottom:0}
  .clines .r{text-align:right}
  .tline ol{display:grid;gap:10px}
  .tline li{display:grid;grid-template-columns:16px 1fr;gap:10px}
  .tline .rod.mini{margin-top:4px}
  .tline time{font-size:12px;color:var(--ink3)}
  .tline p{font-size:13px;line-height:1.35}.tline small{display:block;font-size:12px;line-height:1.35;color:var(--ink3)}
  .cside ul{display:grid;grid-template-columns:1fr 1fr;gap:2px 24px}.cside li{font-size:13px;color:var(--ink2)}.cside strong{color:var(--ink)}

  /* Denials */
  .dtop{flex:none;display:flex;align-items:center;gap:32px;margin:0 16px 12px;padding:12px 20px}
  .dsum{display:flex;align-items:center;gap:10px}
  .dsum strong{font-size:34px;line-height:38px;letter-spacing:-.022em;font-variant-numeric:proportional-nums;color:var(--risk-d)}
  .dsum span{font-size:13px;line-height:18px;color:var(--ink2)}
  .dparts{display:flex;gap:32px;padding-left:32px;border-left:1px solid var(--line)}
  .dst{display:flex;align-items:center;gap:12px}
  .dsh{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--ink2)}
  .dst strong{font-size:22px;line-height:28px;font-weight:600}
  .dtop .fill{margin-left:auto}
  .dlist{flex:1;min-height:0;overflow-y:auto;margin:0 16px 16px;padding:0 20px 8px}
  .dhead,.drow{display:grid;grid-template-columns:208px 124px 1fr 196px 128px;gap:16px}
  .dhead{position:sticky;top:0;z-index:2;background:var(--surface);padding:10px 0 8px;font-size:12px;font-weight:500;color:var(--ink3);align-items:end;border-bottom:1px solid var(--line)}
  .dgroup h2{padding:14px 0 6px;font-size:14px;font-weight:600;line-height:20px;border-bottom:1px solid var(--line)}
  .dgroup h2 span{font-size:13px;font-weight:400;color:var(--ink2);margin-left:8px}
  .drow{padding:11px 0;border-bottom:1px solid var(--line);align-items:start}
  .dgroup:last-child .drow:last-child{border-bottom:0}
  .dl strong{display:block;font-size:16px;line-height:22px;font-weight:600}
  .dl strong.none{color:var(--ink2)}
  .dl span{display:block;font-size:13px}.dl small{display:block;font-size:12px;color:var(--ink3);line-height:1.35}
  .db{padding-top:6px}.db .cap{display:block;margin-top:7px;font-size:13px;font-weight:500}
  .di p{font-size:13px;line-height:1.45;color:var(--ink2)}
  .codes{color:var(--ink);font-weight:500;margin-right:4px}
  .ours-t{display:inline-block;margin-top:4px;padding:1px 8px;border-radius:99px;background:var(--risk-w);border:1px solid var(--risk-l);font-weight:600;font-size:12px;line-height:18px;color:var(--risk-d) !important}
  .dm strong{display:block;font-size:16px;line-height:22px;font-weight:600}
  .dm span{font-size:13px;color:var(--ink2)}
  .da{justify-self:end;text-align:right}.da p{font-size:13px;color:var(--ink2)}

  .toast{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);background:var(--ink);color:#fff;padding:9px 16px;border-radius:8px;font-size:14px;animation:rise .2s ease both;z-index:5;box-shadow:0 6px 20px rgba(22,26,34,.18)}
  @media (prefers-reduced-motion:reduce){*{animation:none !important;transition:none !important}}
  `

  window.TorchProto.register({
    id: 'd1',
    name: 'Dashboard',
    tagline: 'Whose move, in a clean modern dashboard',
    premise: 'Every feature of Whose move, set in a light dashboard with a sidebar and three KPI cards for you, the agents and the payers. Each card shows the baton at that party’s stop, so the header teaches the track that runs down every row.',
    proves: ['R4', 'R5', 'H2', 'A3', 'A4', 'D1', 'D2', 'D4'],
    serves: 'Demo steps 1, 3 and 4',
    fonts: 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap',
    autoOpen: true,
    css,
    render(s, h) {
      sync(s)
      const body = s.screen === 'claim' ? claimScreen(s, h) : s.screen === 'denials' ? denials(s, h) : inbox(s, h)
      return `<div class="app">
        ${sidebar(s, h)}
        <div class="main">
          ${s.screen === 'inbox' ? `<div class="dash">${kpis(s, h)}${pipeline(s, h)}</div>` : slimPipe(s, h)}
          ${body}
          ${s.toast ? `<div class="toast" role="status">${h.esc(s.toast)}</div>` : ''}
        </div>
      </div>`
    },
  })
})()
