/* Today's app, as real screenshots, with hotspots and taggable regions. Coordinates are 1440×900. */
(function () {
  const r = (x1, y1, x2, y2) => `left:${x1}px;top:${y1}px;width:${x2 - x1}px;height:${y2 - y1}px`
  const spot = (rect, attrs) => `<div class="s" style="${r(...rect)}" ${attrs}></div>`
  const nav = spot([12, 55, 172, 82], 'data-act="nav:inbox"') + spot([12, 164, 172, 192], 'data-act="nav:denials"') + spot([12, 128, 172, 156], 'data-act="open-claim:clm_4821"')
  const chrome =
    spot([0, 50, 180, 380], 'data-part="shell.nav"') +
    spot([0, 735, 180, 900], 'data-part="shell.demo-controls"') +
    spot([183, 0, 1440, 28], 'data-part="shell.outage"') +
    spot([183, 30, 1440, 82], 'data-part="shell.header"')
  const inboxTop = spot([183, 84, 1440, 118], 'data-part="shell.agent-summary"') + spot([183, 120, 1440, 212], 'data-part="shell.pipeline"') + spot([183, 850, 612, 900], 'data-part="inbox.keyboard"')

  function render(s) {
    let shot = 'inbox'
    let parts = ''
    if (s.screen === 'claim') {
      shot = 'claim'
      parts = spot([183, 84, 1420, 118], 'data-part="claim.header"') + spot([220, 128, 1400, 195], 'data-part="claim.open-item"') + spot([220, 240, 1400, 295], 'data-part="claim.money"') + spot([220, 305, 1400, 340], 'data-part="claim.denial"') + spot([220, 355, 895, 545], 'data-part="claim.lines"') + spot([220, 560, 895, 900], 'data-part="claim.timeline"') + spot([905, 355, 1400, 600], 'data-part="claim.side"')
    } else if (s.screen === 'denials') {
      shot = 'denials'
      parts = spot([183, 85, 1138, 115], 'data-part="denials.summary"') + spot([183, 118, 1138, 690], 'data-part="denials.row"') + spot([1140, 90, 1440, 240], 'data-part="denials.side"')
    } else {
      const sel = s.selected
      if (sel && sel.id === 'itm_4733') {
        shot = 'inboxDraft'
        parts = inboxTop + spot([183, 215, 612, 850], 'data-part="inbox.queue"') + spot([632, 225, 1420, 330], 'data-part="inbox.decision"') + spot([632, 340, 1420, 440], 'data-part="inbox.recommendation"') + spot([632, 450, 1420, 586], 'data-part="inbox.draft"') + spot([632, 595, 1420, 712], 'data-part="inbox.evidence"') + spot([632, 850, 1200, 890], 'data-part="inbox.action-bar"')
      } else if (sel && sel.group_key) {
        shot = 'inboxGroup'
        parts = inboxTop + spot([183, 215, 612, 850], 'data-part="inbox.queue"') + spot([632, 225, 1420, 330], 'data-part="inbox.decision"') + spot([632, 340, 1420, 516], 'data-part="inbox.recommendation"') + spot([632, 554, 1420, 688], 'data-part="inbox.evidence"') + spot([632, 850, 1420, 890], 'data-part="inbox.action-bar"')
      } else {
        parts = inboxTop + spot([183, 215, 612, 850], 'data-part="inbox.queue"') + spot([632, 215, 1420, 400], 'data-part="inbox.decision"')
      }
      parts += spot([190, 400, 610, 460], 'data-act="group:delta_ny:denied:CO-16:N29:pa_missing"') + spot([190, 310, 610, 396], 'data-act="select:itm_4733"')
    }
    return `<div class="o"><img alt="Screenshot of the current TorchRCM ${esc(s.screen)} screen" src="${window.TORCH_SHOTS[shot]}">${parts}${nav}${chrome}</div>`
  }
  const esc = (v) => String(v)

  window.TorchProto.register({
    id: 'original', name: 'Original', tagline: 'Today\u2019s app, with the fixes and the new name', autoOpen: false,
    premise: 'Keep what is there. Use this as the baseline, and tag anything you want carried forward.',
    css: `.o{position:relative;width:1440px;height:900px;background:#fff;overflow:hidden}.o img{display:block;width:1440px;height:900px;max-width:none}.s{position:absolute}[data-act]{cursor:pointer}`,
    render,
  })
})()
