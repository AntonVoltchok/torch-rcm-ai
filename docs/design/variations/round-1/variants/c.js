/* Variation C: Shift brief.

   Design plan
   Subject: the note a sharp colleague leaves a billing coordinator, in a dental back office, at 10:40 on a Wednesday.
   Palette, from bookkeeping rather than from software. Pale green ledger paper, and the inks a bookkeeper actually uses.
     paper  #EDF1E1  ledger green, the page. Not cream: it is the tint of accounting stock.
     sheet  #F8FAF2  the note being reviewed
     rail   #DFE7D2  the queue rail and strip
     ink    #1E2A22  reading text
     ink2   #47544A  quiet text, 7:1 on paper
     act    #0E4F3C  bottle green: only what Dana can press or owns
     agent  #283C9C  blue ink: only what agents wrote or did
     risk   #A5162B  red ink: only money at risk
   Type. Besley, a Clarendon: the voice of the note. It is the slab of printed forms and practice letterhead, friendly and upright,
   and nothing like a literary serif. Libre Franklin for data: Clarendon with Franklin Gothic is the
   pairing of American job printing, so forms and statements have looked like this for a century. Tabular figures for the money.
   Scale 13, 15, 17, 20, 32, 44. Bold marks money, ownership and what cannot be undone, nothing else.
   Layout. No sidebar. Top bar, compressed strip, then either the brief or the walk.

     Torch  Inbox 12  Denials  Claims  More        Cigna portal unreachable   Dana S., 10:40 AM
     107 open $75,500   Ready 6  Sent 5  ...  Denied 5 (5 with you)  ...     12 with you: 9 claims, 3 visits
     ------------------------------------------------------------------------------------------------
     BRIEF   Dana, here is where things stand at 10:40 AM.
             Agents handled 41 of this week's 53 decisions.        (blue ink)
             12 came to you: 9 claims and 3 upcoming visits.       (black ink)
             [Start with the 3 Delta crowns]
             3  Delta crowns need one x-ray each        $3,730  |  What they did
             1  note to Delta is ready to read          $1,240  |  Worth knowing
             ...                                                |
             ====
             12 came to you                             $9,697
     WALK    rail | who, headline, why, the action | why it stopped, track record, evidence

   The memorable thing: the agenda is a ledger column. Its counts foot to 12 under a double rule, so the reconciliation that the
   app never showed is the page itself, and the headline's two inks are the 41 and the 12.
   Why not generic: the tint, the inks, the footing and the letterhead slab all come from billing paperwork. Swap in another
   industry and the ledger idea stops making sense.
*/
(function () {
  const clean = (t) => String(t ?? '').replace(/\s*·\s*/g, ', ').replace(/\s+—\s+/g, ': ').replace(/\s*→\s*/g, ': ')
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`
  const list = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1])
  const CDT = { D2740: 'Crown, porcelain/ceramic', D2750: 'Crown, porcelain fused to metal', D2950: 'Core buildup', D0220: 'Intraoral PA, first film', D0210: 'Full-mouth x-rays', D0150: 'Comprehensive exam', D0140: 'Limited exam', D1110: 'Adult cleaning', D2392: 'Filling, two surfaces', D3330: 'Root canal, molar' }
  const key = (k) => `<kbd>${k}</kbd>`
  const mix = (r, join) => join([r.claims ? plural(r.claims, 'claim') : '', r.visits ? plural(r.visits, 'upcoming visit') : ''].filter(Boolean))
  const proc = (p) => {
    const m = String(p).match(/^(D\d{4})(?: #(\w+))?(?: \+(\d+))?/)
    if (!m) return clean(p)
    const name = (CDT[m[1]] || m[1]).split(',')[0]
    return `${name}${m[2] ? ', tooth ' + m[2] : ''}${m[3] ? `, plus ${m[3]} more` : ''}`
  }

  const glossed = (h, t) => h.esc(clean(t)).replace(/\b(NEA|BWX|PA|ICN|CO-16|CO-119|PR-119|N29)\b/g, (m) => h.gloss(m))
  const tag = (it) => `${it.copy.who}${it.claim ? ' #' + it.claim.number : ''}`
  const isGroup = (g) => g && g.count > 1
  const count3 = (t, g) => String(t).replace(/\b3\b/, g.count)
  const payerOf = (it) => (it.claim ? it.claim.payer.short_name : '')
  const sourceOf = (e) => {
    if (e.source === 'pms') return 'the PMS'
    if (e.source === 'vyne') return 'Vyne'
    if (e.source === 'rulebook') return 'the rulebook'
    if (/^payer:/.test(e.source)) return 'the payer'
    return 'the remittance file'
  }

  /* Decisions, as the queue groups them. A group of one reads as a single item. */
  function decisions(s) {
    const out = []
    s.queue.forEach((q) => {
      if (q.type === 'group') {
        const mine = q.items.filter(s.canAct)
        if (!mine.length) return
        out.push(isGroup(q) ? { group: q, top: q.top, ids: q.items.map((i) => i.id) } : { top: q.items[0], ids: [q.items[0].id] })
      } else if (s.canAct(q.item)) out.push({ top: q.item, ids: [q.item.id] })
    })
    return out
  }

  /* The agenda: the queue, in sentences. Counts sum to what is open. */
  const PHRASE = {
    itm_4705: (p) => `prompt-pay request is ready for ${p}`,
    itm_4851: (p) => `subscriber ID change is ready for ${p}`,
    itm_4611: () => 'write-off needs your signature',
  }
  function agenda(s, h) {
    const rows = []
    const bundle = {}
    decisions(s).forEach((d) => {
      const it = d.top
      if (d.group) {
        const names = d.group.items.map((m) => `${m.copy.who} #${m.claim.number}`)
        rows.push({ first: 1, n: d.group.count, text: `${payerOf(it)} crowns need one x-ray each`, short: `the ${d.group.count} ${payerOf(it)} crowns`, sub: `${list(names)}.${it.root_cause === 'ours' ? ' Root cause: ours.' : ''}`, cents: d.group.cents, risk: true, act: it.id })
      } else if (it.kind === 'eligibility_flag') {
        const m = (it.copy.treatment.match(/\w{3} \d\d\/\d\d/) || [''])[0]
        if (!bundle.visit) { bundle.visit = { n: 0, text: '', short: '', subs: [], cents: 0, risk: false, act: it.id }; rows.push(bundle.visit) }
        bundle.visit.n += 1; bundle.visit.cents += it.cents; bundle.visit.subs.push(`${it.copy.who}, ${m}`)
      } else if (it.agent === 'posting' && it.tier !== 3) {
        if (!bundle.post) { bundle.post = { n: 0, text: '', short: '', subs: [], cents: 0, risk: true, act: it.id }; rows.push(bundle.post) }
        bundle.post.n += 1; bundle.post.cents += it.cents; bundle.post.subs.push(tag(it))
      } else if (it.group_key) {
        rows.push({ first: 1, n: 1, text: `${payerOf(it)} crown needs one x-ray`, short: tag(it), sub: `${tag(it)}.${it.root_cause === 'ours' ? ' Root cause: ours.' : ''}`, cents: it.cents, risk: true, act: it.id })
      } else if (it.kind === 'review_draft') {
        rows.push({ n: 1, text: `note to ${payerOf(it)} is ready to read`, short: `the note to ${payerOf(it)}`, sub: `${tag(it)}. ${it.copy.headline}.`, cents: it.cents, risk: true, act: it.id })
      } else {
        const p = PHRASE[it.id]
        rows.push({ n: 1, text: p ? p(payerOf(it)) : it.copy.headline, short: tag(it), sub: `${tag(it)}. ${it.copy.headline}.`, cents: it.cents, risk: true, act: it.id })
      }
    })
    if (bundle.visit) {
      const v = bundle.visit
      v.text = v.n === 1 ? 'upcoming visit needs a note for the front desk' : 'upcoming visits need a note for the front desk'
      v.short = 'the upcoming visits'
      v.sub = v.subs.join('; ') + '.'
    }
    if (bundle.post) {
      const v = bundle.post
      v.text = v.n === 1 ? 'payment posting needs a second look' : 'payment postings need a second look'
      v.short = 'the payment postings'
      v.sub = list(v.subs) + '.'
    }
    return rows.sort((a, b) => (b.first || 0) - (a.first || 0))
  }

  /* Shell */
  function shell(s, h) {
    const here = (x) => (s.screen === x ? 'aria-current="page"' : '')
    const more = [["Today's claims", 0], ['Payments', s.strip.nav_badges.payments], ['Patients', 0], ['Eligibility', s.strip.nav_badges.eligibility], ['Activity', 0], ['Settings', 0]]
    return `<header class="top" data-part="shell.header">
      <div class="brand">Torch</div>
      <nav data-part="shell.nav" aria-label="Main">
        <button ${here('inbox')} data-act="select:none">Inbox <b>${s.strip.inbox_open}</b></button>
        <button ${here('denials')} data-act="nav:denials">Denials</button>
        <button ${here('claim')} data-act="open-claim:clm_4821">Claims</button>
        <details class="pop"><summary>More</summary><div class="menu">${more.map(([n, c]) => `<button data-act="nav:${h.esc(n)}">${h.esc(n)}${c ? `<span>${c}</span>` : ''}</button>`).join('')}</div></details>
      </nav>
      <div class="outage" data-part="shell.outage" title="${h.esc(s.outage)}">${h.esc(s.outage.split('. ')[0])}</div>
      <details class="pop who" data-part="shell.demo-controls">
        <summary><b>${h.esc(s.user.name)}</b> <span>${h.date(s.clock.now)}, ${h.time(s.clock.now)}</span></summary>
        <div class="menu right">
          ${s.users.map((u) => `<button data-act="user:${u.id}" aria-pressed="${u.id === s.user.id}">${h.esc(u.name)}<span>${h.esc(u.title)}</span></button>`).join('')}
          <p>The clock is frozen at ${h.time(s.clock.now)} on ${h.dateYear(s.clock.now)}.</p>
        </div>
      </details>
    </header>
    <section class="strip" data-part="shell.pipeline" aria-label="Claim pipeline">
      <div class="sum"><b>${s.strip.open_count}</b> open<br><b>${h.money(s.strip.ar_cents)}</b> in A/R</div>
      <ul>${s.strip.tiles.map((t) => `<li class="${t.flagged ? 'hot' : ''}"><span>${h.esc(t.label.replace(' · ', ' '))}</span><div><b>${t.count}</b>${t.flagged ? `<i>${t.flagged} with you</i>` : ''}</div></li>`).join('')}</ul>
      <div class="rec"><b>${s.strip.inbox_open} with you</b><br>${mix(s.reconcile, (a) => a.join(', '))}</div>
    </section>`
  }

  /* The brief */
  function brief(s, h) {
    const rows = agenda(s, h)
    const first = rows[0]
    const weekday = new Date(s.clock.now).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' })
    const name = s.user.role === 'owner' ? s.user.name : s.user.name.split(' ')[0]
    const left = s.items.length
    const done = s.resolvedCount
    const second = done
      ? (left ? `${s.week.cameToYou} came to you, and ${left} ${left === 1 ? 'is' : 'are'} left: ${mix(s.reconcile, list)}.` : `${s.week.cameToYou} came to you, and you have cleared them all.`)
      : `${s.week.cameToYou} came to you: ${mix(s.reconcile, list)}.`
    const w = s.week
    const blocked = s.waitingOnOwner
    return `<main class="brief" data-part="inbox.empty" data-scroll="brief">
      <p class="hello">${h.esc(name)}, here is where things stand at ${h.time(s.clock.now)} on ${weekday}.</p>
      <h1 class="lead" data-part="shell.agent-summary"><span class="ag">Agents handled ${w.ranAlone} of this week’s ${w.decisions} decisions.</span><br>${h.esc(second)}</h1>
      <div class="begin" data-part="inbox.action-bar">
        ${first ? `<button class="go" data-act="select:${first.act}">Start with ${h.esc(first.short)}</button>` : `<span class="clear">That is everything you can act on.</span>`}
      </div>
      <div class="desk">
        <section class="ledger" data-part="inbox.queue" aria-label="What came to you">
          ${rows.map((r) => `<button class="line" data-part="${r.first ? 'inbox.group' : 'inbox.queue-row'}" data-act="select:${r.act}">
            <span class="n">${r.n}</span>
            <span class="said"><span class="t">${h.esc(r.text)}</span><span class="d">${h.esc(clean(r.sub))}</span></span>
            <span class="c ${r.risk ? 'risk' : ''}">${h.money(r.cents)}${r.risk ? '' : '<small>planned</small>'}</span>
          </button>`).join('')}
          ${blocked.length ? `<h2>Waiting on Dr. Morgan</h2>${blocked.map((b) => `<div class="line held" data-part="inbox.queue-row">
            <span class="n">1</span>
            <span class="said"><span class="t">write-off needs Dr. Morgan’s signature</span><span class="d">${h.esc(tag(b))}. ${h.esc(b.copy.signerNote)}</span>
              <span class="ops"><button class="link" data-act="select:${b.id}">Read it</button><button class="link" data-act="user:usr_morgan">Switch to Dr. Morgan</button></span></span>
            <span class="c risk">${h.money(b.cents)}</span>
          </div>`).join('')}` : ''}
          <div class="foot">
            <span class="n">${left}</span>
            <span class="t">${done ? `left of the ${w.cameToYou} that came to you` : 'came to you'}</span>
            <span class="c">${h.money(s.strip.inbox_open_cents)}</span>
          </div>
        </section>
        <aside class="aside">
          <h2>What they did without you</h2>
          <p class="ag">They sent ${plural(w.claimsSent, 'claim')}, posted ${plural(w.remittancesPosted, 'remittance')}, ran ${plural(w.statusChecks, 'status check')} and made ${plural(w.payerCalls, 'payer call')}.</p>
          <p>${plural(s.agents.agents, 'agent')}, ${s.agents.running} running now. <button class="link" data-act="nav:Activity">See the activity</button></p>
          <h2>Worth knowing</h2>
          <p>${h.esc(s.outage)}</p>
          <h2 data-part="inbox.keyboard">Once you start</h2>
          <p>${key('J')} and ${key('K')} move between decisions. ${key('A')} runs the one in front of you. ${key('⇧A')} runs a whole group.</p>
        </aside>
      </div>
    </main>`
  }

  /* The walk */
  function rail(s, h) {
    const busy = s.run && !s.run.done
    const cur = s.selected && s.selected.id
    const act = (id) => (busy ? 'aria-disabled="true"' : `data-act="select:${id}"`)
    const row = (it, cls) => `<button class="r ${cls || ''} ${it.id === cur ? 'on' : ''}" ${act(it.id)} ${it.id === cur ? 'aria-current="true"' : ''} data-part="inbox.queue-row">
      <span>${h.esc(it.copy.who)}${it.claim ? ` <em>#${it.claim.number}</em>` : ''}</span><i>${it.claim ? h.money(it.cents) : 'visit'}</i></button>`
    const body = decisions(s).map((d) => {
      if (!d.group) return row(d.top)
      const g = d.group
      return `<div class="g ${s.selected && d.ids.includes(s.selected.id) ? 'in' : ''}" data-part="inbox.group">
        <button class="gh" ${act(g.top.id)}><span>${g.count} ${h.esc(payerOf(g.top))} crowns</span><i>${h.money(g.cents)}</i></button>
        ${g.items.map((m) => row(m, 'm')).join('')}</div>`
    }).join('')
    const left = decisions(s).length
    return `<nav class="rail" data-part="inbox.queue" data-scroll="rail" aria-label="Queue">
      <button class="link home" ${busy ? 'aria-disabled="true"' : 'data-act="select:none"'}>Back to the brief</button>
      <p class="pos"><b>${plural(left, 'decision')} left</b>${s.resolvedCount ? `<br>${s.resolvedCount} done` : ''}</p>
      ${s.waitingOnOwner.length ? `<h3>Waiting on Dr. Morgan</h3>${s.waitingOnOwner.map((i) => row(i, 'wait')).join('')}` : ''}
      ${left ? `<h3>Yours</h3>${body}` : ''}
    </nav>`
  }

  function evidence(it, h, heading) {
    if (!it.evidence.length) return `<section data-part="inbox.evidence"><h2>${h.esc(heading)}</h2><p class="quiet">Nothing on file. The payer could not be reached, so there is nothing to show.</p></section>`
    return `<section class="ev" data-part="inbox.evidence"><h2>${h.esc(heading)}</h2>
      ${it.evidence.map((e) => `<article><h4>${h.esc(clean(e.title))}</h4><blockquote>${h.esc(e.excerpt)}</blockquote>
        <p>From ${sourceOf(e)}, ${h.date(e.captured_at)} at ${h.time(e.captured_at)}${e.ref ? `, ref ${h.esc(e.ref)}` : ''}</p></article>`).join('')}
    </section>`
  }

  function policy(it, h, g) {
    const p = h.policy(it)
    if (!p) return ''
    if (!p.canLearn) {
      const v = p.preview
      return `<section class="pol" data-part="inbox.policy"><h2>Can this always run on its own? No.</h2>
        <p>${h.esc(p.reason)}</p>
        ${v ? `<p class="quiet">Turning ${h.esc(p.rule)} on would lift agents from ${v.from} to ${v.to} of ${v.total}, but these ${v.held} stay held, so the week still reads ${v.net}.</p>` : ''}</section>`
    }
    return `<section class="pol" data-part="inbox.policy"><h2>This could run on its own next time</h2>
      <p>${h.esc(p.reason)} <button class="link" data-act="nav:Settings">Change ${h.esc(p.rule)} in Settings</button></p></section>`
  }

  const moveLine = (s, h, it) => {
    if (!s.canAct(it)) return { who: 'owner', label: 'Waiting on Dr. Morgan' }
    return it.claim ? h.move(it.claim) : { who: 'you', label: 'Waiting on you' }
  }

  function stepper(s, h, it, g) {
    const items = s.items
    const i = items.findIndex((x) => x.id === it.id)
    const prev = items[i - 1]
    const next = items[i + 1]
    const inGroup = (x) => g && x && x.group_key === g.key
    const nextName = inGroup(next) ? 'Next crown' : 'Next decision'
    const prevName = inGroup(prev) ? 'Previous crown' : 'Back'
    return `<div class="stepper" data-part="inbox.keyboard">
      ${prev ? `<button class="step" data-act="select:${prev.id}">${prevName} ${key('K')}</button>` : ''}
      ${next ? `<button class="step" data-act="select:${next.id}">${nextName} ${key('J')}</button>` : `<button class="step" data-act="select:none">Back to the brief</button>`}
    </div>`
  }

  function touches(list_, h) {
    return `<ul class="touch" aria-label="What this touches">${list_.map((t) => `<li class="${/recalled/.test(t) ? 'stop' : ''}">${glossed(h, t)}</li>`).join('')}</ul>`
  }

  function decision(s, h) {
    const it = s.selected
    const g = isGroup(s.group) ? s.group : null
    const can = s.canAct(it)
    const mv = moveLine(s, h, it)
    const c = g ? g.copy : it.copy
    const stake = it.claim && ['denied', 'rejected', 'pending'].includes(it.claim.status)
    const metaBits = g
      ? [`${plural(g.count, 'claim')} with ${payerOf(it)}`, `<b class="risk">${h.money(g.cents)}</b> at stake`]
      : [`${h.esc(it.copy.who)}${it.claim ? ` #${it.claim.number}` : ''}`, h.esc(it.copy.treatment), it.claim ? h.esc(payerOf(it)) : '', it.claim ? (stake ? `<b class="risk">${h.money(it.cents)}</b> at stake` : `${h.money(it.cents)} claim`) : `${h.money(it.cents)} planned`]
    const ours = it.root_cause === 'ours' ? `<p class="ours"><b>Root cause: ours.</b> ${glossed(h, (it.audit_note || '').replace(/^root cause: ours\s*—\s*/, ''))}</p>` : ''
    const n = g ? g.items.findIndex((m) => m.id === it.id) + 1 : 0

    const members = g ? `<section class="members" data-part="inbox.group" aria-label="Claims in this decision">
      ${g.items.map((m) => `<button class="mem ${m.id === it.id ? 'on' : ''}" data-act="select:${m.id}" data-part="inbox.queue-row">
        <span><b>${h.esc(m.copy.who)}</b> #${m.claim.number}</span><span>${h.esc(m.copy.treatment)}</span><span class="risk">${h.money(m.cents)}</span></button>`).join('')}
      <p class="memo">Looking at ${n} of ${g.count}. <button class="link" data-act="open-claim:${it.claim.id}">Open claim #${it.claim.number}</button><button class="link" data-act="approve:${it.id}">Send only this one ${key('A')}</button></p>
    </section>` : ''

    const draft = it.draft ? `<section class="note" data-part="inbox.draft" aria-label="The note">
      <h2>What ${h.esc(payerOf(it))} will read, word for word</h2>
      ${it.draft.map((d) => `<div class="sent"><p>${h.esc(d.text)}</p><span>${d.cites.length ? 'Source: ' + d.cites.map((t) => h.esc(clean(t))).join(', ') : 'The request itself, so no source'}</span></div>`).join('')}
    </section>` : ''

    const actionBar = can ? `<div class="bar" data-part="inbox.action-bar">
        ${g ? `<button class="go" data-act="approve-group:${h.esc(g.key)}">${h.esc(count3(c.action, g))} ${key('⇧A')}</button>` : `<button class="go" data-act="approve:${it.id}">${h.esc(c.action)} ${key('A')}</button>`}
        ${g ? '' : `<span class="minor"><button class="link quiet" data-act="snooze:${it.id}">Snooze</button><button class="link quiet" data-act="reject:${it.id}">Reject</button></span>`}
      </div>
      ${touches(g ? c.touches.map((t) => count3(t, g)) : c.touches, h)}` : `<div class="held-box" data-part="inbox.action-bar">
        <p class="signer"><b>Dr. Morgan signs this.</b> ${h.esc(it.copy.signerNote)}</p>
        <p class="would">When signed: ${h.esc(list(it.copy.touches))}.</p>
        <div class="bar">
          ${s.nextItem ? `<button class="go" data-act="select:${s.nextItem.id}">Go to your next decision</button>` : `<button class="go" data-act="select:none">Back to the brief</button>`}
          <button class="link" data-act="user:usr_morgan">Switch to Dr. Morgan</button>
        </div>
      </div>`

    const recommends = `<section data-part="inbox.recommendation"><h2>${h.esc(h.agentName(it.agent))} agent recommends</h2>
      <p class="ag">${glossed(h, it.recommendation)}</p>
      ${it.record ? `<p class="rec-line">${glossed(h, it.record)}.</p>` : (/no base rate/.test(it.noRecord || '') ? '' : `<p class="quiet">No track record: ${h.esc(clean(it.noRecord))}.</p>`)}
    </section>`

    return `<div class="page">
      <div class="col main" data-scroll="walk-main">
        <div class="head"><span class="mv ${mv.who}">${h.esc(mv.label)}</span>${stepper(s, h, it, g)}</div>
        <p class="meta">${metaBits.filter(Boolean).map((b) => `<span>${b}</span>`).join('')}</p>
        <section data-part="inbox.decision">
          <h1>${glossed(h, g ? count3(c.headline, g) : c.headline)}</h1>
          <p class="why">${glossed(h, c.why)}</p>
          ${ours}
        </section>
        ${members}${draft}
        ${actionBar}
      </div>
      <aside class="col side" data-scroll="walk-side">
        <section data-part="inbox.why-stopped"><h2>Why this came to you</h2><p>${h.esc(c.stoppedBy || it.copy.stoppedBy)}</p>${it.tier ? `<p class="quiet">${{ 1: 'Tier 1: agents may run this under a rule.', 2: 'Tier 2: touches the ledger or patients, so it needs a signed rule or a person.', 3: 'Tier 3: human only.' }[it.tier]}</p>` : ''}</section>
        ${recommends}
        ${policy(it, h, g)}
        ${evidence(it, h, g ? `Evidence for ${it.copy.who} #${it.claim.number}` : 'Evidence')}
      </aside>
    </div>`
  }

  /* The run owns the page until it is done */
  function nextUp(s) {
    const r = s.run
    const n = s.mine.find((i) => !(r && r.failed && r.ids.includes(i.id)))
    if (!n) return null
    const q = s.queue.find((x) => x.type === 'group' && x.key === n.group_key)
    return { act: s.mine[0] && s.mine[0].id === n.id ? 'next' : `select:${n.id}`, label: q && isGroup(q) ? `${q.count} ${payerOf(n)} crowns` : `${tag(n)}` }
  }

  function runPage(s, h) {
    const r = s.run
    const up = nextUp(s)
    const denied = s.strip.tiles.find((t) => t.status === 'denied')
    const stepCls = { pending: 'p', active: 'a', done: 'd', failed: 'f' }
    const steps = `<ol class="steps" aria-label="Steps">${r.steps.map((x) => `<li class="${stepCls[x.state]}">
        <span class="mark" aria-hidden="true"></span>
        <span><span class="st">${glossed(h, x.text)}</span>${x.detail && x.state !== 'pending' ? `<span class="dt">${glossed(h, x.detail)}</span>` : ''}${x.state === 'failed' ? '<span class="dt fail">Stopped here</span>' : ''}${r.failed && x.state === 'pending' ? '<span class="dt">Not run</span>' : ''}</span>
      </li>`).join('')}</ol>`
    const changes = r.done ? `<section class="after" data-part="inbox.after-state"><h2>What changed</h2>
      ${r.changes.map((c) => {
        const same = c.from === c.to
        return `<div class="chg"><p class="big"><span>${h.esc(c.label)}</span> ${same ? `stays <b>${c.to}</b>` : `${c.from} to <b>${c.to}</b>`}</p>
          ${c.note ? `<p>${h.esc(c.note)}</p>` : ''}${c.label === 'Denied' ? `<p class="quiet">The strip above now shows ${denied.flagged} of the ${denied.count} with you.</p>` : ''}</div>`
      }).join('')}
      <div class="bar">
        ${up ? `<button class="go" data-act="${up.act}">Next decision: ${h.esc(up.label)}</button>` : `<button class="go" data-act="next">Back to the brief</button>`}
        ${up ? `<button class="link" data-act="dismiss">Back to the brief</button>` : ''}
      </div>
      ${r.failed ? `<p class="quiet"><button class="link" data-act="select:${r.ids[0]}">Look at this one again</button></p>` : ''}
    </section>` : `<section class="holdnote"><p>The next decision opens when this finishes. Nothing else can be approved until then.</p></section>`
    const status = r.failed ? 'Stopped' : r.done ? 'Done' : 'Running'
    return `<div class="page">
      <div class="col main" data-part="inbox.run">
        <p class="stat ${r.failed ? 'bad' : r.done ? 'ok' : 'live'}">${status}: ${h.esc(r.title)}</p>
        <h1>${h.esc(r.failed ? r.failedText.split('. ')[0] + '.' : r.done ? r.doneLine : 'The agents are on it.')}</h1>
        ${r.failed ? `<p class="why">${h.esc(r.failedText.split('. ').slice(1).join('. '))}</p>` : ''}
        ${steps}
      </div>
      <aside class="col side">${changes}</aside>
    </div>`
  }

  /* Claim */
  function claimPage(s, h) {
    const k = s.claim
    const c = k.claim
    const open = k.openItems[0]
    const m = k.money
    const est = /estimate/.test(m.basis)
    const at = ['denied', 'rejected', 'pending'].includes(c.status)
    const mv = open && !s.canAct(open) ? { who: 'owner', label: 'Waiting on Dr. Morgan' } : k.queued ? { who: 'agents', label: 'With the agents' } : h.move(c)
    const dl = k.deadline
    const days = dl.due_on ? h.daysUntil(dl.due_on) : null
    const group = open && open.group_key ? s.queue.find((q) => q.key === open.group_key) : null
    const laneName = { agent: 'Agent', payer: 'Payer', system: 'System', you: 'You' }
    const rc = k.timeline.find((t) => t.kind === 'root_cause')
    const rcText = rc ? rc.title.replace(/^Root cause: ours\s*—\s*/, '') : ''
    return `<main class="claim">
      <div class="col left" data-scroll="claim-left">
        <button class="link" data-act="back">Back to ${s.from === 'denials' ? 'Denials' : 'the Inbox'}</button>
        <section data-part="claim.header">
          <h1>${h.esc(c.patient.display_name)}, claim #${c.number}</h1>
          <p class="meta"><span>${h.esc(k.coverage ? k.coverage.plan_name : c.payer.name)}</span><span title="${h.esc(c.procedures)}">${h.esc(proc(c.procedures))}</span><span>Visit ${h.dateYear(c.dos)}, ${h.esc(k.provider_name)}</span><span>Born ${h.dateYear(c.patient.dob)}</span></p>
          <p class="state"><span class="mv ${mv.who}">${h.esc(mv.label)}</span>${dl.due_on ? `<span>${h.esc(dl.kind === 'appeal' ? 'Appeal' : 'Deadline')} due <b>${h.dateYear(dl.due_on)}</b>, ${days} days from now</span>` : ''}</p>
        </section>
        ${k.queued ? `<section class="queued" data-part="claim.open-item"><p class="ag">${h.esc(k.queued)}</p></section>` : ''}
        ${open ? `<section class="openit" data-part="claim.open-item">
          <h2>${s.canAct(open) ? 'Your move' : 'Dr. Morgan’s move'}</h2>
          <p class="v">${glossed(h, open.copy.headline)}</p>
          <p>${h.esc(h.agentName(open.agent))} agent is asking to: ${h.esc(open.copy.action.toLowerCase())}${group && isGroup(group) ? `, one of ${group.count} ${h.esc(payerOf(open))} crowns` : ''}. ${open.record ? glossed(h, open.record) + '.' : ''}</p>
          ${s.canAct(open) ? `<button class="go" data-act="select:${open.id}">Review it in the Inbox</button>` : `<p class="signer">${h.esc(open.copy.signerNote)} <button class="link" data-act="user:usr_morgan">Switch to Dr. Morgan</button></p>`}
        </section>` : ''}
        ${k.denial ? `<section class="den" data-part="claim.denial">
          <h2>Why ${h.esc(c.payer.short_name)} denied it</h2>
          <p>${h.gloss(k.denial.carc)}${k.denial.rarc ? ', ' + h.gloss(k.denial.rarc) : ''}: ${h.esc(k.denial.decoded)}.</p>
          ${k.denial.root_cause === 'ours' ? `<p class="ours"><b>Root cause: ours.</b> ${h.esc(c.patient.display_name)} #${c.number}: ${glossed(h, rcText || 'our own claim was at fault')}.</p>` : `<p class="quiet">Root cause: the payer.</p>`}
        </section>` : ''}
        <section class="tl" data-part="claim.timeline">
          <h2>The whole story, newest first</h2>
          <ol>${[...k.timeline].reverse().map((t) => `<li class="${h.esc(t.lane)}"><time>${h.date(t.at)} ${h.time(t.at)}</time><div>
            <p class="tt">${t.lane === 'agent' ? `<span class="lane">${laneName.agent}</span> ` : t.lane === 'payer' ? `<span class="lane">${laneName.payer}</span> ` : ''}${t.kind === 'root_cause' ? `<b class="ours-tag first">Root cause: ours</b> ${glossed(h, rcText)}` : glossed(h, t.title)}</p>
            ${t.detail ? `<p class="dt">${h.esc(clean(t.detail))}</p>` : ''}</div></li>`).join('')}</ol>
        </section>
      </div>
      <aside class="col right" data-scroll="claim-right">
        <section class="money" data-part="claim.money">
          <h2>Money</h2>
          <dl>
            <div class="lead-row"><dt>${at ? 'At stake' : 'Billed'}</dt><dd class="${at ? 'risk' : ''}">${h.money(m.billed_cents)}</dd></div>
            <div><dt>Paid so far</dt><dd>${h.money(m.paid_cents === null ? 0 : m.paid_cents)}</dd></div>
            <div><dt>Allowed${est ? ', estimate' : ''}</dt><dd>${h.money(m.allowed_cents)}</dd></div>
            <div><dt>Patient${est ? ', estimate' : ''}</dt><dd>${h.money(m.patient_est_cents)}</dd></div>
          </dl>
          ${est ? `<p class="quiet">Estimates come from the contract, ${h.esc(k.coverage.plan_name)}. ${h.esc(c.payer.short_name)} has not agreed to any of them, so the lines below still show $0 for the patient.</p>` : `<p class="quiet">${h.esc(clean(m.basis))}.</p>`}
        </section>
        <section class="lines" data-part="claim.lines">
          <h2>Lines</h2>
          <table><thead><tr><th>Procedure</th><th>Tooth</th><th class="num">Billed</th><th class="num">Paid</th></tr></thead>
          <tbody>${k.lines.map((l) => `<tr><td>${h.esc(CDT[l.cdt] || l.cdt)}<span>${h.esc(l.cdt)}${l.adj.length ? ', ' + l.adj.map((a) => `${h.esc(a.group)}-${h.esc(a.code)}`).join(', ') : ''}</span></td><td>${h.esc(l.tooth || '')}</td><td class="num">${h.money(l.fee_cents)}</td><td class="num">${h.money(l.paid_cents)}</td></tr>`).join('')}</tbody></table>
        </section>
        <section data-part="claim.side">
          <h2>Attachments and receipts</h2>
          ${k.attachments.length ? k.attachments.map((a) => `<p><b>${a.kind === 'bwx' ? h.gloss('BWX') : h.esc(a.kind)}</b>, NEA# ${h.esc(a.nea_number)}${a.note ? `. <span class="ours-t">${h.esc(a.note[0].toUpperCase() + a.note.slice(1))}.</span>` : ''}</p>`).join('') : '<p class="quiet">Nothing attached.</p>'}
          ${k.acks.map((a) => `<p class="quiet">${h.date(a.at)} ${h.time(a.at)}. ${h.esc(clean(a.message))}</p>`).join('')}
          ${k.timely_filing_due ? `<p class="quiet">Timely filing runs out ${h.dateYear(k.timely_filing_due)}.</p>` : ''}
        </section>
      </aside>
    </main>`
  }

  /* Denials */
  function denialsPage(s, h) {
    const groups = s.denials.groups
    const rows = groups.flatMap((g) => g.rows)
    const billed = rows.reduce((a, r) => a + r.claim.billed_cents, 0)
    const ours = rows.filter((r) => r.root_cause === 'ours').length
    const signers = rows.filter((r) => r.signer).length
    const open = rows.filter((r) => r.item && !r.resolved && s.canAct(r.item))
    const first = open[0]
    const dated = rows.filter((r) => r.deadline && r.deadline.due_on).sort((a, b) => a.deadline.due_on.localeCompare(b.deadline.due_on))[0]
    const moved = rows.filter((r) => r.resolved).length
    const move = (r) => {
      if (r.resolved) return `<span class="mv agents">With the agents, then ${h.esc(r.claim.payer.short_name)}</span>`
      if (r.item && !s.canAct(r.item)) return `<span class="mv owner">Dr. Morgan signs</span>`
      return `<span class="mv you">Waiting on you</span>${r.item ? `<button class="link" data-act="select:${r.item.id}">Decide</button>` : ''}`
    }
    return `<main class="den-page" data-scroll="denials">
      <section class="dh" data-part="denials.summary">
        <div>
          <h1>${plural(s.denials.total, 'denied claim')}, ${h.money(billed)} billed. ${ours} ${ours === 1 ? 'is' : 'are'} our own mistake.</h1>
          <p>${groups.map((g) => `${plural(g.count, 'claim')} ${/^Recon/.test(g.label) ? 'can go back without a signature' : 'closes when Dr. Morgan signs'}`).join('. ')}.${moved ? ` ${moved} ${moved === 1 ? 'is' : 'are'} already moving, and ${moved === 1 ? 'it stays' : 'they stay'} denied until the payer reprocesses.` : ''}${dated ? ` The soonest deadline is ${h.dateYear(dated.deadline.due_on)}, on #${dated.claim.number}.` : ''}</p>
        </div>
        ${first ? `<button class="go" data-part="denials.action" data-act="select:${first.item.id}">Review ${h.esc(tag(first.item))} first</button>` : ''}
      </section>
      ${groups.map((g, gi) => {
        const [title, ...rest] = g.label.split(' · ')
        return `<section class="dg">
          <h2>${h.esc(title)}<span>${h.esc(rest.join(', '))}</span><span class="tally">${plural(g.count, 'claim')}, ${h.money(g.cents)}</span></h2>
          ${gi === 0 ? `<div class="dt-h"><span>Claim</span><span>What ${h.esc(g.rows[0].claim.payer.short_name)} said</span><span class="num">At stake</span><span>Deadline</span><span>If we lose</span><span>Whose move</span></div>` : ''}
          ${g.rows.map((r) => {
            const d = r.deadline || {}
            return `<div class="dr ${r.resolved ? 'moved' : ''}" data-part="denials.row">
              <div class="who"><button class="link plain" data-act="open-claim:${r.claim.id}"><b>${h.esc(r.claim.patient.display_name)}</b> #${r.claim.number}</button><span title="${h.esc(r.claim.procedures)}">${h.esc(proc(r.claim.procedures))}</span></div>
              <div class="said"><span>${h.esc(r.decoded)}</span><span class="code">${h.gloss(r.carc)}${r.rarc ? ', ' + h.gloss(r.rarc) : ''}${r.root_cause === 'ours' ? ' <b class="ours-tag">Root cause: ours</b>' : ''}</span></div>
              <div class="num risk"><b>${h.money(r.claim.billed_cents)}</b></div>
              <div data-part="denials.deadline">${d.due_on ? `<b>${h.dateYear(d.due_on)}</b><span>${h.daysUntil(d.due_on)} days, ${h.esc(d.kind)}</span>` : '<span>No deadline</span>'}</div>
              <div>${r.patient_billable_if_lost ? 'Patient can be billed' : 'Patient cannot be billed'}</div>
              <div class="mvc">${move(r)}</div>
            </div>`
          }).join('')}
        </section>`
      }).join('')}
      <p class="side-note" data-part="denials.side">Max-met denials are plan limits rather than payer errors, so they close through Payments.</p>
    </main>`
  }

  window.TorchProto.register({
    id: 'c',
    name: 'Shift brief',
    tagline: 'The agents hand over like a colleague, then you walk the decisions one at a time',
    premise: 'With nothing selected, the Inbox is a handover note in plain sentences: what the agents handled, what came to you, and a ledger of it that foots to 12. Starting walks one decision at a time, so a biller always knows what is in front of her and what is left.',
    proves: ['H1', 'H2'],
    serves: 'Demo steps 1, 2, 3, plus J/K and the grouped approve',
    autoOpen: false,
    fonts: 'https://fonts.googleapis.com/css2?family=Besley:wght@400;500;600;700&family=Libre+Franklin:wght@400;500;700&display=swap',
    css: `
.app{--paper:#EDF1E1;--sheet:#F8FAF2;--rail:#DFE7D2;--rule:#B9C6A9;--ink:#1E2A22;--ink2:#47544A;--act:#0E4F3C;--act-ink:#F4F8EC;--agent:#283C9C;--risk:#A5162B;
  --voice:'Besley',Georgia,serif;--data:'Libre Franklin',system-ui,sans-serif;
  position:relative;width:1440px;height:900px;overflow:hidden;background:var(--paper);color:var(--ink);font:400 15px/1.45 var(--data);font-variant-numeric:tabular-nums;display:grid;grid-template-rows:52px 60px minmax(0,1fr)}
*{box-sizing:border-box}
button{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;text-align:left}
h1,h2,h3,h4,p,ul,ol,dl,dd,blockquote{margin:0;padding:0}
ul,ol{list-style:none}
.app :focus-visible{outline:2px solid var(--act);outline-offset:2px;border-radius:2px}
.app kbd{font:500 12px/1 var(--data);padding:3px 6px;border:1px solid currentColor;border-radius:3px;margin-left:2px;white-space:nowrap}
.ag{color:var(--agent)}.risk{color:var(--risk)}
.quiet{color:var(--ink2);font-size:13px}
.link{color:var(--act);text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}
.link:hover{text-decoration-thickness:2px}
.link.quiet{color:var(--ink2);font-size:15px}
.go{display:inline-flex;align-items:center;gap:12px;background:var(--act);color:var(--act-ink);font-weight:700;font-size:17px;line-height:1.2;padding:14px 20px;border-radius:5px}
.go:hover{background:#0A3D2E}
.go kbd{border-color:#9DBFAF}
.mv{font-weight:700}.mv.you{color:var(--act)}.mv.agents{color:var(--agent)}.mv.payer,.mv.owner,.mv.nobody{color:var(--ink)}
.ours{font-size:15px;margin-top:14px}
.ours b{background:var(--ink);color:var(--paper);padding:3px 8px;border-radius:2px;margin-right:6px;font-weight:700}

/* shell */
.top{display:flex;align-items:center;gap:32px;padding:0 44px;background:var(--paper)}
.brand{font:700 22px/1 var(--voice);letter-spacing:-.01em}
.top nav{display:flex;align-items:center;gap:24px}
.top nav>button,.top summary{font-size:15px;color:var(--ink2);padding:6px 0;cursor:pointer;list-style:none}
.top summary::-webkit-details-marker{display:none}
.top nav>button[aria-current]{color:var(--ink);box-shadow:inset 0 -2px 0 var(--ink)}
.top nav>button b{color:var(--act)}
.pop{position:relative}
.pop[open]>summary{color:var(--ink)}
.pop summary::after{content:"";display:inline-block;width:6px;height:6px;margin-left:8px;border-right:1.5px solid;border-bottom:1.5px solid;transform:translateY(-3px) rotate(45deg)}
.menu{position:absolute;z-index:20;top:34px;left:-12px;min-width:210px;background:var(--sheet);border:1px solid var(--rule);border-radius:4px;padding:6px;box-shadow:0 8px 24px rgba(30,42,34,.16)}
.menu.right{left:auto;right:0;min-width:260px}
.menu button{display:flex;justify-content:space-between;gap:16px;width:100%;padding:8px 10px;border-radius:3px;font-size:15px}
.menu button:hover{background:var(--rail)}
.menu button span{color:var(--ink2);font-size:13px}
.menu button[aria-pressed=true]{font-weight:700}
.menu p{padding:8px 10px 4px;font-size:13px;color:var(--ink2)}
.outage{margin-left:auto;font-size:13px;color:var(--ink2)}
.outage::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;border:1.5px solid var(--ink2);margin-right:8px}
.who summary{color:var(--ink);font-size:14px;display:flex;align-items:center;gap:8px}
.who summary span{color:var(--ink2)}
.who summary b{font-weight:500}
.strip{display:flex;align-items:center;gap:32px;padding:0 44px;background:var(--rail)}
.strip .sum,.strip .rec{font-size:13px;line-height:1.35;color:var(--ink2);white-space:nowrap}
.strip .sum b{color:var(--ink);font-weight:500}
.strip .rec{margin-left:auto;text-align:right}
.strip .rec b{color:var(--act);font-weight:700}
.strip ul{display:flex;flex:1;justify-content:space-between;gap:16px}
.strip li{font-size:13px;line-height:1.3;color:var(--ink2);white-space:nowrap}
.strip li div{display:flex;align-items:baseline;gap:7px}
.strip li div b{font-weight:400;font-size:15px}
.strip li.hot div b{font-weight:700;color:var(--ink)}
.strip li i{font-style:normal;color:var(--act);font-size:13px}

/* brief */
.brief{padding:26px 44px 0;overflow:auto}
.hello{font:400 17px/1.4 var(--voice);color:var(--ink2)}
.lead{font:500 44px/1.2 var(--voice);letter-spacing:-.015em;margin-top:10px}
.begin{display:flex;align-items:center;gap:20px;margin-top:16px;color:var(--ink2)}
.desk{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:72px;margin-top:16px}
.ledger{--c:40px}
.line{display:grid;grid-template-columns:var(--c) minmax(0,1fr) auto;gap:0 12px;width:100%;align-items:start;padding:4px 0}
.line .n{font:500 20px/28px var(--voice);text-align:right;padding-right:6px}
.line .said{display:flex;flex-direction:column;min-width:0}
.line .t{font:500 20px/28px var(--voice)}
.line .d{font-size:14px;color:var(--ink2);line-height:1.4}
.line .c{font-weight:700;font-size:17px;line-height:28px;text-align:right;white-space:nowrap}
.line .c small{display:block;font-weight:400;font-size:13px;line-height:1.3;color:var(--ink2)}
button.line:hover .t{text-decoration:underline;text-decoration-thickness:1.5px;text-underline-offset:4px}
.ledger h2{font:500 14px/1.3 var(--data);margin:10px 0 2px calc(var(--c) + 12px)}
.line.held .t{font-weight:400;color:var(--ink2)}
.ops{display:flex;gap:18px;margin-top:2px;font-size:14px}
.foot{display:grid;grid-template-columns:var(--c) minmax(0,1fr) auto;gap:0 12px;align-items:baseline;margin-top:8px;padding-top:7px;border-top:4px double var(--ink)}
.foot .n{font:700 20px/28px var(--voice);text-align:right;padding-right:6px}
.foot .t{font:500 20px/28px var(--voice)}
.foot .c{font-weight:700;font-size:17px}
.aside h2{font:500 14px/1.3 var(--data);margin-top:20px}
.aside h2:first-child{margin-top:6px}
.aside p{margin-top:4px;font-size:15px}

/* walk */
.walk{display:grid;grid-template-columns:232px minmax(0,1fr);min-height:0;height:100%}
.rail{background:var(--rail);padding:16px 0 20px;overflow:auto}
.rail .home{display:block;margin:0 16px 12px 20px;font-size:14px}
.rail .pos{margin:0 16px 0 20px;font-size:14px;color:var(--ink2)}
.rail .pos b{color:var(--ink);font:500 17px/1.3 var(--voice)}
.rail h3{font:500 13px/1.3 var(--data);color:var(--ink2);margin:16px 16px 3px 20px}
.r,.gh{display:flex;justify-content:space-between;gap:10px;width:100%;padding:5px 16px 5px 20px;font-size:14px;line-height:1.35}
.r i,.gh i{font-style:normal;color:var(--ink2);font-size:13px}
.r em{font-style:normal;color:var(--ink2)}
.r:hover,.gh:hover{background:#D2DDC3}
.r.on{background:var(--paper);box-shadow:inset 3px 0 0 var(--ink);font-weight:500}
.r.on em{color:var(--ink)}
.r.m{padding-left:32px}
.r.wait{color:var(--ink2)}
.g.in .gh{font-weight:500;color:var(--ink)}
.rail [aria-disabled=true]{cursor:default;color:var(--ink2)}
.rail [aria-disabled=true]:hover{background:none}
.page{display:grid;grid-template-columns:minmax(0,1fr) 430px;gap:52px;padding:0 44px 0 44px;min-height:0;height:100%}
.page .col{padding:22px 0 24px;overflow:auto;min-height:0}
.head{display:flex;justify-content:space-between;align-items:center;gap:20px}
.head .mv{font-size:15px}
.main .meta{margin-top:4px}
.meta{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:14px;color:var(--ink2);min-width:0}
.meta b{font-weight:700}
.stepper{display:flex;gap:14px;flex:none}
.step{font-size:14px;color:var(--ink2);white-space:nowrap}
.step:hover{color:var(--ink)}
.main h1,.claim h1{font:500 32px/1.25 var(--voice);letter-spacing:-.01em;margin-top:14px;max-width:660px}
.why{font:400 17px/1.6 var(--voice);margin-top:12px;max-width:640px}
.members{margin-top:18px}
.mem{display:grid;grid-template-columns:170px minmax(0,1fr) 72px;gap:12px;width:100%;padding:7px 10px;font-size:15px;border-radius:3px}
.mem b{font-weight:500}
.mem .risk{text-align:right;font-weight:700}
.mem:hover{background:var(--rail)}
.mem.on{background:var(--sheet)}
.mem.on b{font-weight:500}
.memo{display:flex;gap:18px;padding:8px 10px 0;font-size:14px;color:var(--ink2)}
.note{background:var(--sheet);padding:14px 18px 16px;margin-top:16px;border-radius:3px}
.note h2,.side h2,.claim h2{font:500 14px/1.3 var(--data);color:var(--ink2)}
.sent{margin-top:9px}
.sent p{font:400 16px/1.45 var(--voice)}
.sent span{display:block;font-size:13px;color:var(--agent);margin-top:1px}
.bar{display:flex;align-items:center;gap:20px;margin-top:20px}
.minor{display:flex;gap:18px}
.touch{display:flex;flex-wrap:wrap;gap:3px 22px;margin-top:12px;font-size:14px;color:var(--ink2);max-width:640px}
.touch li.stop{color:var(--ink);font-weight:700}
.held-box{margin-top:20px;background:var(--sheet);padding:16px 18px;border-radius:3px;max-width:640px}
.signer{font-size:17px}
.signer b{font-weight:700}
.would{margin-top:6px;color:var(--ink2)}
.side section+section{margin-top:18px}
.side p{margin-top:3px}
.rec-line{color:var(--agent);font-weight:500}
.pol{background:var(--rail);padding:12px 14px;border-radius:3px}
.side .pol h2{color:var(--ink)}
.ev article{margin-top:11px}
.ev h4{font-size:14px;font-weight:500}
.ev blockquote{font-size:14px;line-height:1.4;margin-top:1px}
.ev p{font-size:13px;color:var(--ink2)}

/* run */
.stat{font-size:15px;color:var(--ink2)}
.stat.live{color:var(--agent)}
.stat.bad,.stat.ok{color:var(--ink)}
.steps{margin-top:24px;max-width:620px}
.steps li{display:grid;grid-template-columns:20px minmax(0,1fr);gap:14px;padding:9px 0;align-items:start}
.steps .st{display:block;font:400 17px/1.4 var(--voice)}
.steps .dt{display:block;font-size:14px;color:var(--agent)}
.steps .p{color:var(--ink2)}
.steps .a .st{font-weight:600;color:var(--agent)}
.steps .d .st{color:var(--ink)}
.steps .f .st{font-weight:600}
.steps .p .dt{color:var(--ink2)}
.steps .dt.fail{color:var(--ink);font-weight:700}
.mark{display:block;width:14px;height:14px;margin-top:5px;border-radius:50%;border:1.5px solid var(--ink2)}
.d .mark{position:relative;background:var(--agent);border-color:var(--agent)}
.d .mark::after{content:"";position:absolute;left:3.5px;top:1px;width:4px;height:7px;border:solid var(--sheet);border-width:0 1.5px 1.5px 0;transform:rotate(40deg)}
.a .mark{border-color:var(--agent);box-shadow:inset 0 0 0 3px var(--paper);background:var(--agent);animation:pulse 900ms ease-in-out infinite alternate}
.f .mark{border-radius:1px;background:var(--ink);border-color:var(--ink)}
@keyframes pulse{from{transform:scale(.7)}to{transform:scale(1.15)}}
.after{animation:rise 260ms ease-out both}
@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.chg{margin-top:14px}
.chg p{margin-top:3px}
.big{font:500 32px/1.2 var(--voice)}
.big span{font-size:20px;display:inline-block;min-width:88px}
.big b{font-weight:700}
.side .bar{margin-top:24px;flex-wrap:wrap}
.holdnote{margin-top:92px;color:var(--ink2)}

/* claim */
.claim{display:grid;grid-template-columns:minmax(0,1fr) 430px;gap:52px;padding:0 44px;min-height:0}
.claim .col{padding:20px 0 24px;overflow:auto;min-height:0}
.claim .meta{margin-top:6px}
.claim .right{padding-top:20px}
.claim section+section{margin-top:20px}
.claim h1{margin-top:12px;font-size:32px}
.state{display:flex;gap:20px;margin-top:8px;font-size:15px}
.state b{font-weight:700}
.openit{background:var(--sheet);padding:14px 18px 16px;border-radius:3px;margin-top:16px}
.openit .v{font:500 20px/1.35 var(--voice);margin-top:4px}
.openit p+p{margin-top:4px}
.openit .go{margin-top:12px}
.den p{margin-top:3px}
.den .ours{margin-top:8px}
.tl ol{margin-top:6px}
.tl li{display:grid;grid-template-columns:124px minmax(0,1fr);gap:14px;padding:6px 0}
.tl time{font-size:13px;color:var(--ink2);line-height:1.55}
.tt{font-size:15px}
.tl .dt{font-size:13px;color:var(--ink2)}
.lane{font-size:13px;color:var(--ink2)}
.tl li.agent .tt,.tl li.agent .lane{color:var(--agent)}
.money dl{margin-top:6px}
.money dl div{display:flex;justify-content:space-between;align-items:baseline;padding:3px 0}
.money dd{font-weight:500}
.lead-row dt{font:500 20px/1.3 var(--voice)}
.lead-row dd{font:700 32px/1.2 var(--data)}
.money .quiet{margin-top:6px}
.lines table{width:100%;border-collapse:collapse;margin-top:6px;font-size:14px}
.lines th{font-weight:400;color:var(--ink2);font-size:13px;text-align:left;padding:2px 8px 2px 0}
.lines td{padding:4px 8px 4px 0;vertical-align:top}
.lines td span{display:block;font-size:13px;color:var(--ink2)}
.lines .num,.dr .num,.dt-h .num{text-align:right}
.lines th.num,.lines td.num{padding-right:0;padding-left:10px}
.ours-t{font-weight:700}
.right section p{margin-top:3px}

/* denials */
.den-page{padding:24px 44px 28px;overflow:auto}
.dh{display:flex;justify-content:space-between;align-items:flex-end;gap:48px}
.dh h1{font:500 32px/1.25 var(--voice);letter-spacing:-.01em}
.dh p{font-size:15px;color:var(--ink2);margin-top:6px}
.dh .go{flex:none}
.dg{margin-top:24px}
.dg h2{font:500 20px/1.3 var(--voice);display:flex;gap:14px;align-items:baseline}
.dg h2 span{font:400 14px/1.3 var(--data);color:var(--ink2)}
.dg h2 .tally{margin-left:auto}
.dt-h,.dr{display:grid;grid-template-columns:186px minmax(0,1fr) 84px 140px 170px 196px;gap:18px}
.dt-h{font-size:13px;color:var(--ink2);margin-top:8px;padding:0 10px}
.dr{padding:9px 10px;align-items:start;font-size:14px;border-radius:3px}
.dr .who,.dr .said,.dr>[data-part="denials.deadline"]{display:flex;flex-direction:column;min-width:0}
.dr .who span,.dr>[data-part="denials.deadline"] span{color:var(--ink2);font-size:13px}
.link.plain{text-decoration:none;color:var(--ink);font-size:15px}
.link.plain:hover{text-decoration:underline}
.plain b{font-weight:700}
.code{font-size:13px;color:var(--ink2)}
.ours-tag{background:var(--ink);color:var(--paper);padding:1px 6px;border-radius:2px;margin-left:6px;font-weight:700}
.ours-tag.first{margin-left:0;margin-right:2px;font-size:13px}
.mvc{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}
.moved .said,.moved .num{color:var(--ink2)}
.side-note{margin-top:20px;max-width:820px;color:var(--ink2);font-size:14px}

.toast{position:absolute;left:50%;bottom:24px;transform:translateX(-50%);background:var(--ink);color:var(--paper);padding:10px 16px;border-radius:4px;font-size:15px;z-index:30}
@media (prefers-reduced-motion:reduce){.a .mark,.after{animation:none}}
`,
    render(s, h) {
      let body
      if (s.screen === 'claim') body = claimPage(s, h)
      else if (s.screen === 'denials') body = denialsPage(s, h)
      else if (s.run) body = `<div class="walk">${rail(s, h)}${runPage(s, h)}</div>`
      else if (s.selected) body = `<div class="walk">${rail(s, h)}${decision(s, h)}</div>`
      else body = brief(s, h)
      return `<div class="app">${shell(s, h)}${body}${s.toast ? `<div class="toast" role="status">${h.esc(s.toast)}</div>` : ''}</div>`
    },
  })
})()
