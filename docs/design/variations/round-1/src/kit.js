/* Prototype kit: real seed data + simulated approvals. Each variation only supplies css and render(s, h). */
(function () {
  const D = window.TORCH_DATA
  const registry = {}
  const order = []

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const money = (c) => {
    if (c === null || c === undefined) return '—'
    const abs = Math.abs(c)
    const s = '$' + Math.floor(abs / 100).toLocaleString('en-US') + (abs % 100 ? '.' + String(abs % 100).padStart(2, '0') : '')
    return c < 0 ? '−' + s : s
  }
  const d = (iso) => new Date(iso.length === 10 ? iso + 'T12:00:00-04:00' : iso)
  const date = (iso) => { if (!iso) return '—'; const x = d(iso); return String(x.getMonth() + 1).padStart(2, '0') + '/' + String(x.getDate()).padStart(2, '0') }
  const dateYear = (iso) => { if (!iso) return '—'; const x = d(iso); return date(iso) + '/' + x.getFullYear() }
  const time = (iso) => d(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
  const daysUntil = (iso) => Math.round((d(iso) - d(D.clock.now)) / 86400000)
  const gloss = (code) => {
    const g = D.copy.gloss[code]
    return g ? `<abbr title="${esc(g)}" style="text-decoration:underline dotted;text-underline-offset:2px;cursor:help">${esc(code)}</abbr>` : esc(code)
  }
  // In production this is a server-derived field. Here it is derived from status for the prototype.
  const moveOf = (claim) => {
    if (!claim) return { who: 'you', label: 'Waiting on you' }
    const s = claim.status
    if (claim.needs_action) return { who: 'you', label: 'Waiting on you' }
    if (s === 'ready' || s === 'sent') return { who: 'agents', label: 'With the agents' }
    if (s === 'paid') return { who: 'nobody', label: 'Finished' }
    return { who: 'payer', label: 'Waiting on ' + (claim.payer ? claim.payer.short_name : 'the payer') }
  }
  const policyOf = (it) => (it.group_key ? D.copy.policy.pa : D.copy.policy[it.id]) || null
  const helpers = { esc, money, date, dateYear, time, daysUntil, gloss, move: moveOf, policy: policyOf, agentName: (k) => D.copy.agentNames[k] || 'Agent' }

  const cleanRef = (r) => (r && !/^(img|rem|ev|pat|usr)_/.test(r) ? r : null)
  const decorate = (it) => {
    const evidence = (it.evidence || []).map((e) => ({ ...e, ref: cleanRef(e.reference) }))
    const segs = it.payload && it.payload.draft ? it.payload.draft.segments : null
    const draft = segs ? segs.map((g) => ({ text: g.text, cites: g.evidence_ids.map((id) => (evidence.find((e) => e.id === id) || {}).title).filter(Boolean) })) : null
    const c = it.confidence || {}
    return { ...it, evidence, draft, copy: D.copy.items[it.id] || {}, record: c.pct !== null && c.pct !== undefined ? c.basis : null, noRecord: c.pct === null || c.pct === undefined ? c.basis : null }
  }

  function groupActivity(rows) {
    const out = []
    for (const r of rows) {
      const key = r.action.replace(/NEA# [\d-]+/, 'NEA#')
      const last = out[out.length - 1]
      if (last && last.key === key && last.agent === r.agent) { last.count += 1; last.subjects.push(r.subject) } else out.push({ key, count: 1, subjects: [r.subject], ...r })
    }
    return out
  }

  function createApp(def, mountEl, opts) {
    const o = opts || {}
    const st = {
      screen: o.screen || 'inbox',
      selectedId: null,
      openGroup: null,
      filter: 'all',
      claimId: 'clm_4821',
      from: null,
      resolved: {},
      run: null,
      userId: 'usr_dana',
      toast: null,
      extras: {},
    }
    let timers = []
    const after = (ms, fn) => timers.push(setTimeout(fn, ms))
    const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches

    const allItems = () => D.items.map(decorate)
    const openItems = () => allItems().filter((i) => !st.resolved[i.id])
    const user = () => D.copy.users.find((u) => u.id === st.userId)
    const canAct = (i) => !(i.tier === 3 && user().role !== 'owner')

    function queue(items) {
      const seen = new Set()
      const out = []
      for (const it of items) {
        if (it.group_key) {
          if (seen.has(it.group_key)) continue
          seen.add(it.group_key)
          const members = items.filter((x) => x.group_key === it.group_key)
          const meta = D.groups.find((g) => g.group_key === it.group_key)
          out.push({
            type: 'group', key: it.group_key, items: members, count: members.length,
            cents: members.reduce((a, m) => a + m.cents, 0), title: meta ? meta.title : it.group_title,
            copy: D.copy.groups[it.group_key] || {}, open: st.openGroup === it.group_key, top: members[0],
          })
        } else out.push({ type: 'item', item: it, key: it.id })
      }
      return out
    }

    function view() {
      const items = openItems()
      const filtered = st.filter === 'all' ? items : items.filter((i) => i.kind === st.filter)
      const selected = items.find((i) => i.id === st.selectedId) || null
      const mine = items.filter(canAct)
      const waitingOnOwner = items.filter((i) => !canAct(i))
      const resolvedCents = allItems().filter((i) => st.resolved[i.id]).reduce((a, i) => a + i.cents, 0)
      const inboxOpen = D.strip.inbox_open - Object.keys(st.resolved).length
      const tabs = [
        { key: 'all', label: 'All', count: items.length },
        { key: 'approve_action', label: 'Approvals', count: items.filter((i) => i.kind === 'approve_action').length },
        { key: 'review_draft', label: 'Drafts', count: items.filter((i) => i.kind === 'review_draft').length },
        { key: 'variance', label: 'Variances', count: items.filter((i) => i.kind === 'variance').length },
        { key: 'eligibility_flag', label: 'Eligibility', count: items.filter((i) => i.kind === 'eligibility_flag').length },
      ]
      const flagged = {}
      allItems().filter((i) => st.resolved[i.id] && i.claim).forEach((i) => { flagged[i.claim.status] = (flagged[i.claim.status] || 0) + 1 })
      const tiles = D.strip.tiles.map((t) => ({ ...t, flagged: Math.max(0, t.flagged - (flagged[t.status] || 0)) }))
      const claimDetail = D.claims[st.claimId]
      let claim = null
      if (claimDetail) {
        const openFor = (claimDetail.open_inbox_items || []).filter((i) => !st.resolved[i.id]).map((i) => decorate(D.items.find((x) => x.id === i.id) || i))
        const res = (claimDetail.open_inbox_items || []).map((i) => st.resolved[i.id]).find(Boolean)
        const extra = st.extras[st.claimId] || []
        claim = { ...claimDetail, openItems: openFor, queued: res ? res.doneLine : null, timeline: [...claimDetail.timeline, ...extra] }
      }
      const denials = {
        ...D.denials,
        groups: D.denials.groups.map((g) => ({ ...g, rows: g.rows.map((r) => ({ ...r, item: r.inbox_item_id ? decorate(D.items.find((x) => x.id === r.inbox_item_id)) : null, resolved: !!st.resolved[r.inbox_item_id] })) })),
      }
      return {
        screen: st.screen, items, filtered, mine, waitingOnOwner, selected, queue: queue(filtered), tabs, filter: st.filter,
        nextItem: mine.find((i) => i.id !== st.selectedId) || null,
        group: selected && selected.group_key ? queue(items).find((q) => q.key === selected.group_key) || null : null,
        claim, denials, run: st.run, toast: st.toast, user: user(), users: D.copy.users,
        strip: { ...D.strip, tiles, flagged_count: tiles.reduce((a, t) => a + t.flagged, 0), inbox_open: inboxOpen, inbox_open_cents: D.strip.inbox_open_cents - resolvedCents },
        reconcile: { claims: items.filter((i) => i.claim).length, visits: items.filter((i) => !i.claim).length },
        activityGrouped: groupActivity(D.activity),
        week: D.copy.week, agents: D.agents, clock: D.clock, outage: D.copy.outage,
        activity: D.activity, claimsList: D.claimsList, from: st.from,
        canAct, resolvedCount: Object.keys(st.resolved).length,
      }
    }

    const scrollKeys = () => [...mountEl.querySelectorAll('[data-scroll]')].map((e) => [e.dataset.scroll, e.scrollTop])
    function render() {
      const keep = scrollKeys()
      mountEl.innerHTML = def.render(view(), helpers)
      keep.forEach(([k, v]) => { const e = mountEl.querySelector(`[data-scroll="${k}"]`); if (e) e.scrollTop = v })
      if (o.onRender) o.onRender()
    }

    function toast(t) {
      st.toast = t
      render()
      after(2600, () => { st.toast = null; render() })
    }

    function startRun(title, stepsDef, ids, doneLine, claimIds, changes) {
      const steps = (stepsDef || []).map((x) => ({ text: x.text, detail: x.detail || null, fails: x.fails || null, state: 'pending' }))
      st.run = { title, steps, done: false, failed: false, failedText: null, doneLine, ids, changes: changes || [] }
      st.selectedId = null
      ids.forEach((id) => { st.resolved[id] = { doneLine } })
      const step = reduced ? 0 : 620
      let i = 0
      const tick = () => {
        if (!st.run) return
        if (i > 0 && st.run.steps[i - 1].fails) {
          st.run.steps[i - 1].state = 'failed'
          st.run.failed = true
          st.run.failedText = st.run.steps[i - 1].fails
          st.run.done = true
          ids.forEach((id) => { delete st.resolved[id] })
          st.run.changes = [{ label: 'Inbox', from: view().strip.inbox_open, to: view().strip.inbox_open, note: 'Nothing changed. The item came back to you.' }]
          render()
          return
        }
        if (i > 0) st.run.steps[i - 1].state = 'done'
        if (i < st.run.steps.length) {
          st.run.steps[i].state = 'active'
          i += 1
          render()
          after(step, tick)
        } else {
          st.run.done = true
          ;(claimIds || []).forEach((cid) => {
            st.extras[cid] = (st.extras[cid] || []).concat([
              { id: 'x_' + cid, at: D.clock.now, lane: 'agent', kind: 'run', title: st.run.title, detail: doneLine, actor: null, run_id: null, evidence_ids: [], root_cause: null },
            ])
          })
          if (def.autoAdvance) {
            const n = view().mine[0]
            st.selectedId = n ? n.id : null
          }
          render()
        }
      }
      tick()
    }

    function selectDefault() {
      if (def.autoOpen === false) return
      const v = view()
      const first = v.mine[0]
      if (first) { st.selectedId = first.id; if (first.group_key) st.openGroup = first.group_key }
    }

    const acts = {
      select(id) {
        st.selectedId = id; st.run = st.run && st.run.done ? null : st.run
        const it = D.items.find((x) => x.id === id)
        st.openGroup = it && it.group_key ? it.group_key : st.openGroup
        st.screen = 'inbox'
      },
      group(key) {
        const open = st.openGroup === key
        st.openGroup = open ? null : key
        const m = openItems().find((i) => i.group_key === key)
        if (!open && m) st.selectedId = m.id
      },
      approve(id) {
        if (st.run && !st.run.done) return toast('Wait for this run to finish.')
        const it = decorate(D.items.find((x) => x.id === id))
        if (!canAct(it)) return toast('Only Dr. Morgan can sign this.')
        const before = view().strip.inbox_open
        startRun(it.copy.action, it.copy.runSteps, [id], it.copy.doneLine, it.claim ? [it.claim.id] : [], [{ label: 'Inbox', from: before, to: before - 1 }])
        return true
      },
      'approve-group'(key) {
        if (st.run && !st.run.done) return toast('Wait for this run to finish.')
        const g = queue(openItems()).find((q) => q.key === key)
        if (!g) return
        const v = view()
        const denied = v.strip.tiles.find((t) => t.status === 'denied')
        startRun(g.copy.action, g.copy.runSteps, g.items.map((i) => i.id), g.copy.doneLine, g.items.map((i) => i.claim.id), [
          { label: 'Inbox', from: v.strip.inbox_open, to: v.strip.inbox_open - g.count },
          { label: 'Denied', from: denied.count, to: denied.count, note: 'They stay denied until Delta reprocesses. Whose move changes: these 3 are now with the agents, then Delta.' },
        ])
        return true
      },
      reject(id) { st.resolved[id] = { doneLine: 'Rejected. Nothing was sent.' }; st.selectedId = null; toast('Rejected. Nothing was sent.'); return true },
      snooze(id) { st.resolved[id] = { doneLine: 'Snoozed until tomorrow.' }; st.selectedId = null; toast('Snoozed until tomorrow.'); return true },
      next() { const n = view().mine[0]; st.selectedId = n ? n.id : null; st.run = null; if (n && n.group_key) st.openGroup = n.group_key },
      dismiss() { st.run = null },
      filter(k) { st.filter = k },
      nav(screen) {
        if (['inbox', 'claim', 'denials'].includes(screen)) { st.screen = screen; return }
        toast(screen + ' is not part of this round.')
        return true
      },
      'open-claim'(cid) {
        if (D.claims[cid]) { st.from = st.screen; st.claimId = cid; st.screen = 'claim' } else toast('That claim is not in this prototype.')
      },
      back() { st.screen = st.from && st.from !== 'claim' ? st.from : 'inbox' },
      user(id) { st.userId = id },
    }

    function perform(actStr) {
      const i = actStr.indexOf(':')
      const name = i < 0 ? actStr : actStr.slice(0, i)
      const arg = i < 0 ? undefined : actStr.slice(i + 1)
      if (!acts[name]) return
      const skip = acts[name](arg)
      if (!skip) render()
    }

    function onClick(e) {
      const t = e.target.closest && e.target.closest('[data-act]')
      if (!t) return
      e.preventDefault()
      perform(t.dataset.act)
    }
    mountEl.addEventListener('click', onClick)

    function onKey(e) {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return
      const v = view()
      const k = e.key
      if (v.screen !== 'inbox') return
      if (st.run && !st.run.done) return // nothing is armed under a running job (audit R2)
      if (k === 'j' || k === 'k') {
        const list = v.items
        if (!list.length) return
        const i = list.findIndex((x) => x.id === st.selectedId)
        const n = k === 'j' ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1)
        perform('select:' + list[n].id)
      } else if (k === 'a' && v.selected) perform(def.keyApprove ? def.keyApprove(v) : 'approve:' + v.selected.id)
      else if (k === 'A' && v.group) perform('approve-group:' + v.group.key)
    }

    selectDefault()
    render()
    return {
      go(screen) { st.screen = screen; if (screen === 'claim' && !D.claims[st.claimId]) st.claimId = 'clm_4821'; render() },
      key: onKey,
      perform,
      get state() { return st },
      destroy() { timers.forEach(clearTimeout); mountEl.removeEventListener('click', onClick); mountEl.innerHTML = '' },
    }
  }

  window.TorchProto = {
    register(def) { registry[def.id] = def; if (!order.includes(def.id)) order.push(def.id) },
    defs: () => ['original', 'a', 'b', 'c', 'd', 'e'].map((k) => registry[k]).filter(Boolean),
    get: (id) => registry[id],
    createApp,
    helpers,
  }
})()
