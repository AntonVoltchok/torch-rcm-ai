/* The comparison page: pick a variation, drive it, tag its parts. Feedback goes to the artifact db so Claude can read it. */
(function () {
  const P = window.TorchProto
  const defs = P.defs()
  const SCREENS = [['inbox', 'Inbox'], ['claim', 'Claim'], ['denials', 'Denials']]
  const PART_LABEL = {
    'shell.nav': 'Navigation', 'shell.header': 'Page header', 'shell.agent-summary': 'Agent summary', 'shell.pipeline': 'Pipeline strip', 'shell.outage': 'Outage notice', 'shell.demo-controls': 'Persona and clock',
    'inbox.queue': 'Queue', 'inbox.queue-row': 'Queue row', 'inbox.group': 'Group row', 'inbox.decision': 'Decision header', 'inbox.why-stopped': 'Why it stopped', 'inbox.recommendation': 'Recommendation', 'inbox.draft': 'Draft text', 'inbox.evidence': 'Evidence', 'inbox.action-bar': 'Action bar', 'inbox.policy': 'Always-run control', 'inbox.run': 'Run progress', 'inbox.after-state': 'What changed', 'inbox.empty': 'Empty state', 'inbox.keyboard': 'Keyboard hints',
    'claim.header': 'Claim header', 'claim.open-item': 'Open item', 'claim.money': 'Money', 'claim.denial': 'Denial', 'claim.timeline': 'Timeline', 'claim.lines': 'Line items', 'claim.side': 'Side panels',
    'denials.summary': 'Denials summary', 'denials.row': 'Denial row', 'denials.deadline': 'Deadline', 'denials.action': 'Denial action', 'denials.side': 'Side panel',
  }
  const label = (id) => (id === 'original' ? 'Original' : id.toUpperCase())
  const state = { view: 'overview', screen: 'inbox', tagging: false, drawer: false, apps: [], feedback: {}, notes: '', pop: null, db: null, status: 'Saved in this browser' }

  /* storage */
  const LS = 'torch-variations-feedback-r2'
  try { const r = JSON.parse(localStorage.getItem(LS) || '{}'); state.feedback = r } catch (e) { /* private window */ }
  const persistLocal = () => { try { localStorage.setItem(LS, JSON.stringify(state.feedback)) } catch (e) { /* ignore */ } }
  async function put(id, doc) {
    if (doc) state.feedback[id] = doc; else delete state.feedback[id]
    persistLocal()
    if (!state.db) return
    try {
      const ref = state.db.collection('feedback').doc(id)
      if (doc) await ref.set(doc); else await ref.delete()
      state.status = 'Saved where Claude can read it'
    } catch (e) { state.status = 'Saved in this browser only. Use Copy to send it.' }
    renderBar()
  }
  ;(async () => {
    for (let i = 0; i < 20 && !(window.claude && window.claude.use); i++) await new Promise((r) => setTimeout(r, 150))
    if (!window.claude || !window.claude.use) return
    const db = await window.claude.use('db')
    if (!db) return
    state.db = db
    state.status = 'Saved where Claude can read it'
    db.collection('feedback').onSnapshot((snap) => {
      const next = {}
      snap.docs.forEach((d) => { next[d.id] = d.data() })
      state.feedback = next
      persistLocal()
      renderBar()
      renderDrawer()
    })
    renderBar()
  })()

  /* shell DOM */
  const root = document.getElementById('app')
  root.innerHTML = `<header class="bar" id="bar"></header><div id="info"></div><div id="hint"></div><main class="stagewrap" id="stage"></main><div id="drawer"></div><div id="pop"></div>`
  const $ = (id) => document.getElementById(id)
  const esc = P.helpers.esc

  function fit(frame, host) {
    const w = frame.clientWidth
    const s = w / 1440
    host.style.transform = `scale(${s})`
    frame.style.height = 900 * s + 'px'
  }

  function mount(def, frame, opts) {
    const host = document.createElement('div')
    host.className = 'host'
    frame.appendChild(host)
    const sr = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = ':host{all:initial;display:block;width:1440px;height:900px}*{box-sizing:border-box}' + (def.css || '')
    const tagStyle = document.createElement('style')
    tagStyle.textContent = `.tag [data-part]{outline:1.5px dashed rgba(31,93,76,.55);outline-offset:-1px;cursor:copy}.tag [data-part]:hover{outline:2.5px solid #1f5d4c;background-color:rgba(31,93,76,.08)}`
    const mountEl = document.createElement('div')
    mountEl.style.cssText = 'width:1440px;height:900px;overflow:hidden'
    sr.append(style, tagStyle, mountEl)
    if (def.fonts && !document.querySelector(`link[href="${def.fonts}"]`)) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = def.fonts; document.head.appendChild(l)
    }
    const app = P.createApp(def, mountEl, { screen: opts.screen })
    fit(frame, host)
    if (opts.interactive) {
      mountEl.classList.toggle('tag', state.tagging)
      mountEl.addEventListener('click', (e) => {
        if (!state.tagging) return
        const path = e.composedPath()
        const part = path.find((n) => n.dataset && n.dataset.part)
        e.stopImmediatePropagation(); e.preventDefault()
        if (part) openPop(def.id, part.dataset.part, e.clientX, e.clientY)
      }, true)
    }
    return { app, host, frame, def, mountEl }
  }

  function clearApps() { state.apps.forEach((a) => a.app.destroy()); state.apps = [] }

  function renderStage() {
    clearApps()
    const stage = $('stage')
    stage.innerHTML = ''
    document.body.classList.toggle('tagging', state.tagging && state.view !== 'overview')
    if (state.view === 'overview') {
      const g = document.createElement('div'); g.className = 'grid'
      defs.forEach((def) => {
        const b = document.createElement('button'); b.className = 'card'; b.type = 'button'
        b.setAttribute('aria-label', `Open ${label(def.id)}: ${def.name}`)
        const f = document.createElement('div'); f.className = 'frame'
        b.appendChild(f)
        const liked = state.feedback[`rating_${def.id}_${state.screen}`]
        b.insertAdjacentHTML('beforeend', `<h2>${esc(label(def.id))}${def.id === 'original' ? '' : '. ' + esc(def.name)}${liked && liked.value === 'like' ? ' · liked' : ''}</h2><p>${esc(def.tagline)}</p>`)
        b.onclick = () => { state.view = def.id; renderAll() }
        g.appendChild(b)
        requestAnimationFrame(() => {})
        state.pending = state.pending || []
        state.pending.push([def, f])
      })
      stage.appendChild(g)
      ;(state.pending || []).forEach(([def, f]) => state.apps.push(mount(def, f, { screen: state.screen, interactive: false })))
      state.pending = []
    } else {
      const def = P.get(state.view)
      const f = document.createElement('div'); f.className = 'frame'
      stage.appendChild(f)
      state.apps.push(mount(def, f, { screen: state.screen, interactive: true }))
    }
  }

  function renderBar() {
    const seg = (items, cur, attr) => `<div class="seg" role="group">${items.map(([k, l, dot]) => `<button type="button" aria-pressed="${k === cur}" ${attr}="${k}">${esc(l)}${dot ? '<span class="dot" aria-label="liked"></span>' : ''}</button>`).join('')}</div>`
    const liked = (id) => Object.values(state.feedback).some((f) => f.type === 'rating' && f.variant === id && f.value === 'like')
    const n = Object.values(state.feedback).filter((f) => f.type === 'tag' || f.type === 'rating').length
    $('bar').innerHTML = `<span class="name">TorchRCM redesign, round 2</span>
      ${seg([['overview', 'All four'], ...defs.map((d) => [d.id, label(d.id), liked(d.id)])], state.view, 'data-view')}
      ${seg(SCREENS, state.screen, 'data-screen')}
      <span class="spacer"></span>
      <button type="button" class="btn" id="tagbtn" aria-pressed="${state.tagging}" ${state.view === 'overview' ? 'disabled' : ''}>Tag parts</button>
      <button type="button" class="btn" id="fb">Your feedback${n ? ' (' + n + ')' : ''}</button>`
    $('bar').querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => { state.view = b.dataset.view; if (state.view === 'overview') state.tagging = false; renderAll() } })
    $('bar').querySelectorAll('[data-screen]').forEach((b) => { b.onclick = () => { state.screen = b.dataset.screen; renderAll() } })
    $('tagbtn').onclick = () => { state.tagging = !state.tagging; renderAll() }
    $('fb').onclick = () => { state.drawer = !state.drawer; renderDrawer() }
  }

  function renderInfo() {
    if (state.view === 'overview') {
      $('info').innerHTML = `<div class="info"><div><h1>Variation D, in two new styles</h1><p>Today\u2019s app and the D you liked sit beside the two restyles, all on the same seed data. Pick one to click through it. Try approving the Delta group, and try #4851, which fails on purpose.</p></div></div>`
      $('hint').innerHTML = ''
      return
    }
    const def = P.get(state.view)
    const r = state.feedback[`rating_${def.id}_${state.screen}`]
    const v = r && r.value
    $('info').innerHTML = `<div class="info"><div style="flex:1 1 320px;min-width:0"><h1>${esc(label(def.id))}${def.id === 'original' ? '' : '. ' + esc(def.name)}</h1><p>${esc(def.premise || def.tagline)}</p>${def.serves ? `<div class="meta">${esc(def.serves)}${def.proves ? '. Must fix ' + esc(def.proves.join(', ')) : ''}</div>` : ''}</div>
      <div class="rate"><span>This ${esc(SCREENS.find((s) => s[0] === state.screen)[1])} screen:</span>
        <button type="button" class="btn" data-rate="like" aria-pressed="${v === 'like'}">Like it</button>
        <button type="button" class="btn" data-rate="no" aria-pressed="${v === 'no'}">Not for me</button></div></div>`
    $('info').querySelectorAll('[data-rate]').forEach((b) => {
      b.onclick = () => {
        const id = `rating_${def.id}_${state.screen}`
        const val = b.dataset.rate
        put(id, v === val ? null : { type: 'rating', variant: def.id, screen: state.screen, value: val })
        renderInfo(); renderBar()
      }
    })
    $('hint').innerHTML = state.tagging ? `<div class="hint">Tagging is on. Click any outlined part to keep it, drop it, or leave a note. Turn it off to click through the design again.</div>` : ''
  }

  function openPop(variant, part, x, y) {
    const name = PART_LABEL[part] || part
    const px = Math.min(x + 8, innerWidth - 306); const py = Math.min(y + 8, innerHeight - 160)
    $('pop').innerHTML = `<div class="pop" style="left:${Math.max(8, px)}px;top:${Math.max(8, py)}px"><b>${esc(label(variant))}: ${esc(name)}</b>
      <label for="tagnote" class="status">A note, if you have one</label><input id="tagnote" placeholder="Why, or what you would change">
      <div class="row"><button type="button" class="btn" data-v="keep">Keep this</button><button type="button" class="btn" data-v="drop">Drop this</button><button type="button" class="btn" data-v="cancel">Cancel</button></div></div>`
    $('tagnote').focus()
    $('pop').querySelectorAll('[data-v]').forEach((b) => {
      b.onclick = () => {
        if (b.dataset.v !== 'cancel') {
          const id = 'tag_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
          put(id, { type: 'tag', variant, screen: state.screen, part, verdict: b.dataset.v, note: $('tagnote').value.trim(), at: Date.now() })
        }
        $('pop').innerHTML = ''
        renderBar(); renderDrawer()
      }
    })
  }

  function feedbackText() {
    const fb = Object.values(state.feedback)
    const rate = fb.filter((f) => f.type === 'rating').map((f) => `${label(f.variant)} ${f.screen}: ${f.value === 'like' ? 'like' : 'not for me'}`)
    const tags = fb.filter((f) => f.type === 'tag').map((f) => `${label(f.variant)} ${f.screen} ${PART_LABEL[f.part] || f.part}: ${f.verdict}${f.note ? ' (' + f.note + ')' : ''}`)
    const note = state.feedback.note_general ? state.feedback.note_general.text : ''
    return ['Ratings', ...rate, '', 'Tagged parts', ...tags, '', 'Notes', note].join('\n')
  }

  function renderDrawer() {
    if (!state.drawer) { $('drawer').innerHTML = ''; return }
    const fb = Object.entries(state.feedback)
    const rates = fb.filter(([, f]) => f.type === 'rating')
    const tags = fb.filter(([, f]) => f.type === 'tag').sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
    const noteVal = (state.feedback.note_general && state.feedback.note_general.text) || ''
    $('drawer').innerHTML = `<aside class="drawer" aria-label="Your feedback">
      <div class="row"><h2>Your feedback</h2><button type="button" class="btn" id="closefb">Close</button></div>
      <div class="status">${esc(state.status)}</div>
      <div><h3>Liked</h3>${rates.length ? rates.map(([id, f]) => `<div class="tagrow"><span><b>${esc(label(f.variant))}</b> ${esc(f.screen)}: <span class="${f.value === 'like' ? 'keep' : 'drop'}">${f.value === 'like' ? 'like' : 'not for me'}</span></span><button type="button" class="x" data-del="${id}" aria-label="Remove">×</button></div>`).join('') : '<div class="status">Nothing yet. Use Like it above the design.</div>'}</div>
      <div><h3>Tagged parts</h3>${tags.length ? tags.map(([id, f]) => `<div class="tagrow"><span><span class="${f.verdict}">${f.verdict === 'keep' ? 'Keep' : 'Drop'}</span> <b>${esc(label(f.variant))}</b> ${esc(PART_LABEL[f.part] || f.part)}${f.note ? `<br>${esc(f.note)}` : ''}</span><button type="button" class="x" data-del="${id}" aria-label="Remove">×</button></div>`).join('') : '<div class="status">Nothing yet. Turn on Tag parts and click any outlined region.</div>'}</div>
      <div><h3><label for="gennote">Anything else for the next round</label></h3><textarea id="gennote">${esc(noteVal)}</textarea></div>
      <button type="button" class="btn" id="copyfb">Copy feedback as text</button></aside>`
    $('closefb').onclick = () => { state.drawer = false; renderDrawer() }
    $('drawer').querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => { put(b.dataset.del, null); renderDrawer(); renderBar() } })
    $('gennote').onchange = (e) => put('note_general', { type: 'note', text: e.target.value })
    $('copyfb').onclick = (e) => {
      navigator.clipboard.writeText(feedbackText()).then(() => { e.target.textContent = 'Copied' }).catch(() => { e.target.textContent = 'Copy is blocked here' })
    }
  }

  function renderAll() { renderBar(); renderInfo(); renderStage(); renderDrawer() }

  addEventListener('resize', () => state.apps.forEach((a) => fit(a.frame, a.host)))
  addEventListener('keydown', (e) => {
    if (state.tagging || state.view === 'overview' || !state.apps[0]) return
    state.apps[0].app.key(e)
  })
  window.TorchHarness = { state, renderAll }
  renderAll()
})()
