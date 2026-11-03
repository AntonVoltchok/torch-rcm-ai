/* Variation A: Biller's view.

DESIGN PLAN

Idea. Nothing is removed. Today everything is equally loud, so loudness is rationed. A ledger is the model:
aligned columns of names and money, sentences under them, almost no rules. Dana already reads a ledger all day.

Palette (each hue has one job)
  ink      #1d1f23  names, numbers, sentences (today's ink)
  ink2     #4a4f57  supporting sentences                       8.2:1 on white
  ink3     #5b6068  labels and audit text (replaces #8b9098)   6.3:1 on white, 5.9:1 on well
  line     #e6e8eb  the few hairlines that remain
  well     #f5f6f7  sidebar, selected row, draft paper
  action   #2f5bd8  today's blue. Means "you can press this", nothing else.   5.8:1
  agent    #0b6e69  teal. Means "an agent did or said this", nothing else.    6.1:1
  risk     #b3321f  rust. Means "money is exposed": flags, root cause ours, at-stake figure.  6.2:1, 5.6:1 on its tint
  outage   #9a6200  a single dot, once, in the sidebar.

Type. Inter throughout, tabular figures for all money, ids and dates.
  12 audit     labels, timestamps, provenance
  14 work      rows, sentences, buttons
  18 strip     strip counts, money figures
  24 decide    the decision headline, the claim name, page titles
  32 figure    the amount at stake on a claim
  Weights: 400 for words. 500 for controls and group names. 600 is a promise: it only ever sits on a person or a
  number (plus "Root cause: ours", which is meant to be uncomfortable). Selection never uses blue.

Layout (1440x900, same two panes as today)
  +--------+---------------------------------------------------------------+
  | Torch  | Inbox  12 items: 9 claims, 3 visits      agents ran 41...  [ ] |
  | Inbox  | Open 107   Ready 6  Sent 5  Rejected 2 ...  Denied 5  Paid 118 |  one tight row, dollars secondary
  | Claims +-----------------------------+---------------------------------+
  | Denials| * F. Diaz  #4840 Crown  $1,310 | F. Diaz #4840 ...      Open claim
  | ...    |   Delta needs the PA x-ray     | Headline, 24px          $1,310
  |        | * K. Owens #4821 ...           | why / recommends / track record
  | outage |                                | stopped at you / this will
  | agents |  Dr. Morgan signs this         | [Filled action, named]  Reject  Snooze
  | Dana   | o R. Diaz  #4611 ...           | Evidence rows, real excerpts
  +--------+-----------------------------+---------------------------------+

The one memorable thing. Cover everything but the semibold and the queue still works: a two-column ledger of who
and how much, in columns that line up across Inbox, Group and Denials. Numbers and names do the work borders did.
Specific to billing: it reads like an aged-receivables report that happens to have sentences in it.
*/
(function () {
  const css = `
  .app{--ink:#1d1f23;--ink2:#4a4f57;--ink3:#5b6068;--line:#e6e8eb;--line2:#cfd3d8;--well:#f5f6f7;--well2:#ebedef;--paper:#fff;
    --action:#2f5bd8;--action2:#1a43b3;--agent:#0b6e69;--agentbg:#e7f3f2;--risk:#b3321f;--riskbg:#fdf0ed;--amber:#9a6200;
    width:1440px;height:900px;overflow:hidden;background:var(--paper);color:var(--ink);display:grid;grid-template-columns:176px 1264px;
    font:400 14px/20px Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;letter-spacing:-.003em}
  button{font:inherit;color:inherit;letter-spacing:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;text-align:left}
  :focus-visible{outline:2px solid var(--action);outline-offset:1px}
  abbr{text-decoration:underline dotted var(--line2);text-underline-offset:3px;cursor:help}
  .num,.am,.no{font-variant-numeric:tabular-nums}
  .a12{font-size:12px;line-height:16px;color:var(--ink3)}
  .ag{color:var(--agent)}
  .rk{color:var(--risk)}
  b,.b{font-weight:600}
  .lnk{color:var(--action);font-weight:500}
  .lnk:hover{color:var(--action2);text-decoration:underline;text-underline-offset:2px}

  /* marks: whose move */
  .mk{display:inline-block;width:6px;height:6px;border-radius:50%;flex:none;vertical-align:2px}
  .mk-you{background:var(--ink2)}
  .mk-agents{background:var(--agent)}
  .mk-payer,.mk-signer{width:8px;height:8px;box-shadow:inset 0 0 0 1.5px var(--ink)}
  .mk-nobody{box-shadow:inset 0 0 0 1.5px var(--line2)}

  /* sidebar */
  .side{background:var(--well);display:flex;flex-direction:column;padding:16px 8px 14px;min-height:0}
  .logo{display:flex;align-items:center;gap:8px;font-size:18px;line-height:24px;font-weight:600;padding:0 8px 14px}
  .logo i{width:14px;height:14px;border-radius:4px 4px 7px 7px;background:var(--ink)}
  .nav{display:flex;flex-direction:column;gap:1px}
  .nav button{display:flex;justify-content:space-between;align-items:center;height:32px;padding:0 8px;border-radius:6px;color:var(--ink2)}
  .nav button:hover{background:var(--well2)}
  .nav button.on{background:var(--well2);color:var(--ink);font-weight:500}
  .nav .c{font-variant-numeric:tabular-nums;color:var(--ink2)}
  .nav .c.work{font-weight:600;color:var(--ink)}
  .nav .c.done{color:var(--agent)}
  .foot{margin-top:auto;padding:0 8px;display:flex;flex-direction:column;gap:12px}
  .outage{display:grid;grid-template-columns:8px 1fr;column-gap:7px;font-size:12px;line-height:16px;color:var(--ink3)}
  .outage i{width:7px;height:7px;border-radius:50%;background:var(--amber);margin-top:4px}
  .demo{display:flex;flex-direction:column;gap:2px;font-size:12px;line-height:16px;color:var(--ink3)}
  .demo .who{font-size:14px;line-height:20px;color:var(--ink);font-weight:600}
  .demo .lnk{font-size:12px;line-height:16px;margin-top:2px}

  .main{display:flex;flex-direction:column;min-width:0;min-height:0}
  .top{flex:none;height:56px;display:flex;align-items:center;padding:0 24px;gap:12px}
  .top h1{margin:0;font-size:24px;line-height:30px;font-weight:500;letter-spacing:-.012em}
  .top .sub{color:var(--ink2)}
  .top .sum{margin-left:auto;color:var(--ink2)}
  .top .sum .lnk{margin-left:8px}
  .search{width:216px;height:32px;padding:0 10px;border-radius:6px;background:var(--well);color:var(--ink3)}
  .search:hover{background:var(--well2)}
  .top .search{margin-left:16px}
  .top .sub + .search{margin-left:auto}

  /* strip: one tight row */
  .strip{flex:none;display:grid;grid-template-columns:150px repeat(9,1fr);padding:0 24px 8px 16px;border-bottom:1px solid var(--line)}
  .cell{display:block;padding:2px 8px 2px;border-radius:6px;min-width:0}
  button.cell:hover{background:var(--well)}
  .cell .hd{display:flex;gap:7px;font-size:12px;line-height:16px;color:var(--ink3);white-space:nowrap}
  .cell .hd .rk{display:inline-flex;align-items:center;gap:3px}
  .fl{flex:none}
  .cell .ln{display:flex;align-items:baseline;gap:6px;white-space:nowrap}
  .cell .ct{font-size:18px;line-height:24px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
  .cell .dol{font-size:12px;line-height:16px;color:var(--ink3);font-variant-numeric:tabular-nums}
  .cell.here{box-shadow:inset 0 -2px 0 var(--ink);border-radius:6px 6px 0 0}
  .cell.flash{animation:flash 1.6s ease-out 1}
  @keyframes flash{0%{background:var(--riskbg)}100%{background:transparent}}

  /* panes */
  .panes{flex:1;min-height:0;display:grid;grid-template-columns:520px 744px}
  .queue{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--line)}
  .tabs{flex:none;display:flex;align-items:center;gap:14px;height:40px;padding:0 16px 0 30px;white-space:nowrap}
  .tabs button{height:40px;color:var(--ink3);display:inline-flex;gap:5px;align-items:center;box-shadow:inset 0 -2px 0 transparent}
  .tabs button:hover{color:var(--ink)}
  .tabs button.on{color:var(--ink);font-weight:500;box-shadow:inset 0 -2px 0 var(--ink)}
  .tabs .n{font-variant-numeric:tabular-nums}
  .tabs .keys{margin-left:auto;font-size:12px;color:var(--ink3);display:flex;gap:3px;align-items:center}
  kbd{font:inherit;font-size:12px;line-height:16px;padding:0 4px;border-radius:4px;background:var(--well2);color:var(--ink2)}
  .qscroll{flex:1;min-height:0;overflow-y:auto;padding-bottom:12px}
  .sec{display:flex;align-items:center;gap:6px;padding:10px 16px 3px 30px;font-size:12px;line-height:16px;color:var(--ink3)}
  .sec .num{margin-left:auto}
  .sec.blocked{padding-top:14px;color:var(--ink);font-weight:500;font-size:14px;line-height:20px}
  .sec.blocked .num{font-weight:400;color:var(--ink3);font-size:12px}

  .row{display:block;width:100%;position:relative;padding:6px 16px 6px 14px}
  .row:hover{background:var(--well)}
  .row.sel,.grp.on{background:var(--well)}
  .row.sel::before,.grp.on::before{content:'';position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--ink)}
  .grp{position:relative}
  .l1{display:grid;grid-template-columns:16px 76px 54px minmax(0,1fr) 66px 58px;align-items:baseline}
  .l1 .mk{align-self:center;margin-top:-1px}
  .l1 .nm{font-weight:600;white-space:nowrap}
  .l1 .no{color:var(--ink3);white-space:nowrap}
  .l1 .tr{color:var(--ink3);white-space:nowrap}
  .l1 .py{color:var(--ink3);text-align:right;white-space:nowrap}
  .l1 .am{font-weight:600;text-align:right;white-space:nowrap}
  .l2{padding-left:16px;white-space:nowrap}
  .wide{grid-column:2 / 5}
  .sub-row{padding:3px 16px 3px 14px}
  .sub-row .nm{font-weight:400}
  .sub-row .am{font-weight:400}
  .sub-row.sel{background:var(--well2)}
  .sub-row.sel .nm,.sub-row.sel .am{font-weight:600}
  .sub-row.sel::before{display:none}
  .sub-row:hover{background:var(--well2)}
  .grp .row:hover{background:var(--well2)}
  .caret{color:var(--ink3)}
  .runrow{padding:7px 16px 7px 14px;background:var(--well);position:relative}
  .runrow::before{content:'';position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--agent)}
  .runrow.bad::before{background:var(--risk)}
  .runrow .wide{white-space:nowrap}

  /* detail */
  .detail{min-height:0;overflow-y:auto;padding:16px 28px 28px}
  .ident{display:flex;align-items:baseline;gap:8px;color:var(--ink3)}
  .ident .rt{margin-left:auto;display:flex;gap:14px;align-items:baseline}
  .ident .nm{color:var(--ink);font-weight:600}
  .ident .no{font-variant-numeric:tabular-nums}
  .hl{display:flex;align-items:baseline;gap:20px;margin-top:2px}
  .hl h2{margin:0;flex:1;font-size:24px;line-height:30px;font-weight:400;letter-spacing:-.014em}
  .hl .amt{font-size:24px;line-height:30px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.014em}
  .why{margin:6px 0 0;color:var(--ink2);max-width:640px}
  .facts{margin:14px 0 0;display:grid;grid-template-columns:156px 1fr;row-gap:7px;column-gap:12px}
  .facts dt{font-size:12px;line-height:20px;color:var(--ink3)}
  .facts dt.ag{color:var(--agent)}
  .facts dd{margin:0}
  .facts .also{color:var(--ink3)}
  .facts .touch{list-style:none;margin:0;padding:0}
  .cause{margin:12px -10px 0;padding:6px 10px;border-radius:6px;background:var(--riskbg);display:grid;grid-template-columns:156px 1fr;column-gap:12px;align-items:baseline}
  .cause .t{color:var(--risk);font-weight:600;white-space:nowrap}
  .acts{display:flex;align-items:center;gap:8px;margin-top:16px}
  .btn{display:inline-flex;align-items:center;gap:10px;height:36px;padding:0 14px;border-radius:6px;background:var(--action);color:#fff;font-weight:500;white-space:nowrap}
  .btn:hover{background:var(--action2)}
  .btn kbd{background:rgba(255,255,255,.2);color:#fff}
  .btn2{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 12px;border-radius:6px;box-shadow:inset 0 0 0 1px var(--line2);font-weight:500;color:var(--ink);white-space:nowrap}
  .btn2:hover{background:var(--well)}
  .btn3{height:36px;padding:0 8px;border-radius:6px;font-weight:500;color:var(--ink2);white-space:nowrap}
  .btn3:hover{background:var(--well);color:var(--ink)}
  .push{margin-left:auto}
  .pol{margin:8px 0 0;color:var(--ink3);font-size:12px;line-height:16px}
  .pol b{font-weight:500;color:var(--ink2)}
  .signer{margin-top:14px;display:grid;grid-template-columns:156px 1fr;column-gap:12px;align-items:baseline}
  .signer .big{font-weight:600}

  .draft{margin:14px 0 0;background:var(--well);border-radius:6px;padding:10px 14px 12px}
  .draft h3{margin:0 0 6px;font-size:12px;line-height:16px;font-weight:400;color:var(--ink3)}
  .seg{display:grid;grid-template-columns:1fr 150px;column-gap:16px;padding:3px 0}
  .seg .cite{font-size:12px;line-height:16px;padding-top:2px;color:var(--ink3)}

  .ev{margin-top:22px}
  .ev h3{margin:0 0 4px;font-size:14px;line-height:20px;font-weight:500;display:flex;gap:6px;align-items:baseline}
  .ev h3 .a12{font-weight:400}
  .ev .lnk{margin-left:auto;font-size:14px}
  .evr{display:grid;grid-template-columns:212px 1fr;column-gap:16px;padding:6px 0}
  .evr .tt{color:var(--ink)}
  .evr .ex{color:var(--ink2)}
  .none{color:var(--ink3)}

  /* run */
  .runlab{display:flex;align-items:baseline;gap:8px;color:var(--agent)}
  .runlab.bad{color:var(--risk)}
  .runlab .rt{margin-left:auto;color:var(--ink);font-weight:600;font-variant-numeric:tabular-nums}
  .runwho{margin-top:4px;color:var(--ink3)}
  .runwho .nm{color:var(--ink);font-weight:600}
  .steps{list-style:none;margin:16px 0 0;padding:0}
  .steps li{display:grid;grid-template-columns:20px 1fr minmax(0,auto);column-gap:6px;padding:5px 0;align-items:baseline;color:var(--ink3)}
  .steps li.done{color:var(--ink)}
  .steps li.active{color:var(--ink)}
  .steps li.failed{color:var(--risk)}
  .steps .d{font-size:12px;line-height:20px;color:var(--ink3);text-align:right;font-variant-numeric:tabular-nums}
  .tick{width:12px;height:12px;border-radius:50%;align-self:center;box-shadow:inset 0 0 0 1.5px var(--line2)}
  .done .tick,.failed .tick{box-shadow:none;border-radius:0;width:auto;height:auto;font-style:normal;font-weight:600;align-self:baseline;line-height:20px}
  .done .tick{color:var(--agent)}
  .failed .tick{color:var(--risk)}
  .active .tick{box-shadow:inset 0 0 0 2px var(--agent);animation:pulse 1s ease-in-out infinite}
  @keyframes pulse{50%{box-shadow:inset 0 0 0 5px var(--agent)}}
  .after{margin-top:20px;padding-top:14px;border-top:1px solid var(--line);animation:rise .24s ease-out 1}
  @keyframes rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
  .after h3{margin:0;font-size:12px;line-height:16px;font-weight:400;color:var(--ink3)}
  .chg{display:grid;grid-template-columns:156px 120px 1fr;column-gap:12px;padding:6px 0;align-items:baseline}
  .chg .v{font-size:18px;line-height:24px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
  .chg .v.same{font-weight:600}
  .chg .sm{font-size:14px;font-weight:400;color:var(--ink3)}
  .chg .note{color:var(--ink2)}
  .line-done{margin:10px 0 0}
  .failmsg{margin:8px 0 0;max-width:640px;color:var(--ink)}
  .emptyp{padding-top:120px;max-width:460px}
  .emptyp h2{margin:0 0 6px;font-size:24px;line-height:30px;font-weight:400;letter-spacing:-.014em}
  .emptyp p{margin:0 0 16px;color:var(--ink2)}

  /* claim */
  .page{flex:1;min-height:0;overflow-y:auto;padding:12px 24px 28px}
  .chead{display:grid;grid-template-columns:1fr auto;column-gap:40px;align-items:start}
  .chead h2{margin:0;font-size:24px;line-height:30px;font-weight:600;letter-spacing:-.014em}
  .chead h2 .no{font-weight:400;color:var(--ink3)}
  .chead .meta{margin-top:2px;color:var(--ink2)}
  .chead .whose{display:flex;align-items:center;gap:7px;margin-top:6px}
  .fig{text-align:right}
  .fig .big{font-size:32px;line-height:36px;font-weight:600;letter-spacing:-.018em;font-variant-numeric:tabular-nums}
  .fig .due{margin-top:2px}
  .denial{margin:12px 0 0;display:flex;gap:16px;align-items:baseline;padding:7px 10px;background:var(--riskbg);border-radius:6px}
  .denial.plain{background:var(--well)}
  .denial .t{color:var(--risk);font-weight:600;margin-left:auto;white-space:nowrap}
  .open{margin-top:14px;display:grid;grid-template-columns:1fr auto;column-gap:32px;align-items:center}
  .open .lab{color:var(--ink3);font-size:12px;line-height:16px}
  .open .lab.ag{color:var(--agent)}
  .open .lab.rk{color:var(--risk)}
  .open .acts{margin-top:0}
  .money{display:grid;grid-template-columns:repeat(6,auto) 1fr;column-gap:40px;margin-top:16px;align-items:end}
  .money .ct{font-size:18px;line-height:24px;font-weight:600;font-variant-numeric:tabular-nums}
  .money .basis{justify-self:end;text-align:right;max-width:340px;font-size:12px;line-height:16px;color:var(--ink3)}
  .cols{display:grid;grid-template-columns:480px 1fr;column-gap:40px;margin-top:18px;padding-top:14px;border-top:1px solid var(--line)}
  .cols h3{margin:0 0 6px;font-size:14px;line-height:20px;font-weight:500}
  .cols .note{font-weight:400;color:var(--ink3);font-size:12px}
  .tl{list-style:none;margin:0;padding:0}
  .tl li{display:grid;grid-template-columns:74px 62px 14px 1fr;padding:4px 0;align-items:baseline}
  .tl .d,.tl .h{font-size:12px;line-height:20px;color:var(--ink3);font-variant-numeric:tabular-nums}
  .tl .dot,.lg i{width:8px;height:8px;border-radius:50%;display:inline-block}
  .tl .dot{align-self:start;margin-top:6px}
  .lg{float:right;display:flex;gap:12px;align-items:center;font-size:12px;line-height:20px;font-weight:400;color:var(--ink3)}
  .lg span{display:inline-flex;gap:5px;align-items:center}
  .lane-agent{background:var(--agent)}
  .lane-payer{box-shadow:inset 0 0 0 1.5px var(--ink)}
  .lane-system{box-shadow:inset 0 0 0 1.5px var(--line2)}
  .lane-you{background:var(--ink)}
  .tl .ttl{min-width:0}
  .tl .det{display:block;font-size:12px;line-height:16px;color:var(--ink3)}
  .tl .ours{color:var(--risk);font-weight:600}
  table{border-collapse:collapse;width:100%;font-size:14px;line-height:20px;color:var(--ink)}
  th{font-size:12px;line-height:16px;font-weight:400;color:var(--ink3);text-align:left;padding:0 10px 4px 0;white-space:nowrap}
  td{padding:4px 10px 4px 0;vertical-align:baseline}
  td.r,th.r{text-align:right}
  th:last-child,td:last-child{padding-right:0}
  tfoot td{font-weight:600;font-variant-numeric:tabular-nums;border-top:1px solid var(--line)}
  tbody td{font-variant-numeric:tabular-nums}
  td .c2{color:var(--ink3)}
  .pan{margin-top:16px}
  .pan .r{display:grid;grid-template-columns:1fr auto;column-gap:16px;padding:2px 0}
  .pan .m{color:var(--ink3);font-size:12px;line-height:20px;font-variant-numeric:tabular-nums}

  /* denials */
  .dbar{display:flex;align-items:center;gap:18px;margin-top:0;padding-bottom:10px}
  .dbar .n{color:var(--ink2)}
  .dbar .acts{margin:0 0 0 auto}
  .dwrap{display:grid;grid-template-columns:1fr 196px;column-gap:28px}
  .dgrid{display:grid;grid-template-columns:170px 226px 150px 214px 1fr}
  .dh{display:contents}
  .dh span{font-size:12px;line-height:16px;color:var(--ink3);padding:0 12px 6px 0}
  .dh .r,.drow .r{text-align:right;padding-right:16px}
  .dg{grid-column:1 / -1;display:flex;gap:8px;align-items:baseline;padding:10px 0 4px;border-top:1px solid var(--line)}
  .dg .nm{font-weight:500}
  .dg .tt{color:var(--ink3)}
  .dg .rt{margin-left:auto;color:var(--ink3);font-variant-numeric:tabular-nums;padding-right:0}
  .dg .rt b{color:var(--ink)}
  .drow{display:contents}
  .drow > div{padding:7px 12px 7px 0}
  .drow .who{display:flex;gap:6px;align-items:baseline}
  .drow .who:hover{text-decoration:underline;text-underline-offset:2px}
  .drow .who .nm{font-weight:600;min-width:62px}
  .drow .who .no{color:var(--ink3)}
  .drow .code{font-variant-numeric:tabular-nums}
  .drow .stake{font-weight:600;font-variant-numeric:tabular-nums}
  .drow .mv{display:flex;align-items:center;gap:7px}
  .drow .mv .lnk{margin-left:auto;white-space:nowrap}
  .drow .mv span{white-space:nowrap}
  .drow.off > div{color:var(--ink3)}
  .dside h3{margin:0 0 6px;font-size:14px;line-height:20px;font-weight:500}
  .dside .r{display:flex;justify-content:space-between;padding:2px 0}
  .dside .r .num{font-weight:600}
  .dside .t{margin:10px 0 0}
  .dside p{margin:10px 0 0;font-size:12px;line-height:16px;color:var(--ink3)}

  .toast{position:absolute;left:50%;bottom:20px;transform:translateX(-50%);background:var(--ink);color:#fff;padding:8px 14px;border-radius:6px;white-space:nowrap;animation:rise .2s ease-out 1}
  @media (prefers-reduced-motion:reduce){.active .tick,.after,.toast,.cell.flash{animation:none}}
  `

  const D = () => window.TORCH_DATA
  const dots = (t, sep) => String(t || '').replace(/ · /g, sep === undefined ? ', ' : sep)
  const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t)
  const dash = (t) => String(t || '').replace(/ — (\w)/g, (m, c) => '. ' + c.toUpperCase())

  // Glosses Torch's codes where they appear in a sentence. Each code once per sentence.
  let codeRe = null
  function gl(h, text) {
    const g = D().copy.gloss
    if (!codeRe) {
      const keys = Object.keys(g).filter((k) => !/^T\d$/.test(k) && k !== 'PMS').sort((a, b) => b.length - a.length)
      codeRe = new RegExp('(?<![\\w-])(' + keys.join('|') + ')(?![\\w-])', 'g')
    }
    const seen = new Set()
    return h.esc(text).replace(codeRe, (m) => {
      if (seen.has(m)) return m
      seen.add(m)
      return `<abbr title="${h.esc(g[m])}">${m}</abbr>`
    })
  }
  const tier = (h, n) => (n ? `<abbr class="a12" title="${h.esc(D().copy.gloss['T' + n])}">Tier ${n}</abbr>` : '')
  const payerOf = (it) => {
    if (it.claim) return it.claim.payer.short_name
    if (it.evidence && it.evidence[0]) return it.evidence[0].title.split(' ')[0]
    const m = (it.copy.headline || '').match(/Delta|MetLife|Cigna|Aetna|Guardian/)
    return m ? m[0] : ''
  }
  const idOf = (it) => (it.claim ? '#' + it.claim.number : 'Visit')
  const label = (it) => `${it.patient.display_name} ${idOf(it)}`
  const treatOf = (it) => (it.claim ? it.copy.treatment : (it.copy.treatment || '').replace(/^Visit\s+/, ''))
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
  // Group copy is written for the full group. If one member was handled alone, the numbers must follow the live count.
  const groupCopy = (g) => {
    const full = (D().groups.find((x) => x.group_key === g.key) || {}).count
    if (!full || full === g.count) return g.copy
    const swap = (t) => t.replace(/^\d+/, g.count).replace(new RegExp('\\b' + full + '\\b'), g.count)
    return { ...g.copy, headline: swap(g.copy.headline), action: swap(g.copy.action), touches: (g.copy.touches || []).map(swap) }
  }
  const HELD = /^(Rejected|Snoozed)/
  const CHEV = (open) => `<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" style="transform:rotate(${open ? 90 : 0}deg)"><path d="M3.5 1.5 7 5 3.5 8.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`
  const ran = new Set()
  const signer = (s) => (s.users.find((u) => u.role === 'owner') || {}).name || 'The owner'

  const KIND = { portal_screenshot: 'Payer portal', pms_record: 'PMS record', era_line: '835 line', prior_eob: 'Prior EOB', ivr_transcript: 'IVR transcript', rep_call: 'Rep call', policy_clause: 'Rule text' }
  const CDT = {
    D0140: 'Limited oral evaluation', D0150: 'Comprehensive oral evaluation', D0210: 'Intraoral complete series', D0220: 'Intraoral periapical, first film',
    D1110: 'Prophylaxis, adult', D2392: 'Resin composite, two surfaces', D2740: 'Crown, porcelain/ceramic', D2750: 'Crown, porcelain fused to metal',
    D2950: 'Core buildup', D3330: 'Root canal, molar',
  }

  const FLAG = '<svg class="fl" viewBox="0 0 9 11" width="8" height="10" aria-hidden="true"><path d="M1 .5v10" stroke="currentColor" stroke-width="1.4"/><path d="M1 1h7L6.2 3.5 8 6H1z" fill="currentColor"/></svg>'

  /* shell */
  function nav(s) {
    const b = s.strip.nav_badges
    const items = [
      ['Inbox', 'nav:inbox', s.screen === 'inbox', s.strip.inbox_open, 'work'],
      ['Today’s claims', 'nav:Today’s claims'],
      ['Claims', 'open-claim:clm_4821', s.screen === 'claim'],
      ['Denials', 'nav:denials', s.screen === 'denials'],
      ['Payments', 'nav:Payments', false, b.payments, ''],
      ['Patients', 'nav:Patients'],
      ['Eligibility', 'nav:Eligibility', false, b.eligibility, ''],
      ['Activity', 'nav:Activity', false, b.activity, 'done'],
      ['Settings', 'nav:Settings'],
    ]
    return `<nav class="nav" data-part="shell.nav" aria-label="Main">${items.map(([t, a, on, c, k]) => `<button type="button" class="${on ? 'on' : ''}" data-act="${a}" ${on ? 'aria-current="page"' : ''}><span>${t}</span>${c !== undefined ? `<span class="c ${k}" ${k === 'done' ? 'title="Agents ran these without you this week"' : ''}>${c}</span>` : ''}</button>`).join('')}</nav>`
  }

  function side(s, h) {
    const running = s.agents.running + (s.run && !s.run.done ? 1 : 0)
    const other = s.users.find((u) => u.id !== s.user.id)
    const day = new Date(s.clock.now).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' }).replace(',', '')
    return `<aside class="side">
      <div class="logo"><i></i>Torch</div>
      ${nav(s)}
      <div class="foot">
        <div class="outage" data-part="shell.outage"><i></i><span>${h.esc(s.outage)}</span></div>
        <div class="a12 ag">${s.agents.agents} agents, ${running} running</div>
        <div class="demo" data-part="shell.demo-controls">
          <span class="who">${h.esc(s.user.name)}</span>
          <span>${h.esc(s.user.title)}, Harbor Dental</span>
          <span class="num">${h.esc(day)}, ${h.time(s.clock.now)}</span>
          <button type="button" class="lnk" data-act="user:${other.id}">Switch to ${h.esc(other.name)}</button>
        </div>
      </div>
    </aside>`
  }

  function strip(s, h, here) {
    const flash = s.run && s.run.done && !s.run.failed
    return `<div class="strip" data-part="shell.pipeline">
      <div class="cell"><div class="hd"><span>Open</span>${s.strip.flagged_count ? `<span class="rk">${FLAG}${s.strip.flagged_count} flagged</span>` : ''}</div><div class="ln"><span class="ct">${s.strip.open_count}</span><span class="dol">${h.money(s.strip.ar_cents)} A/R</span></div></div>
      ${s.strip.tiles.map((t) => `<button type="button" class="cell ${t.status === here ? 'here' : ''} ${flash && t.status === 'denied' ? 'flash' : ''}" data-act="${t.status === 'denied' ? 'nav:denials' : 'nav:' + h.esc(dots(t.label))}">
        <div class="hd"><span>${h.esc(dots(t.label))}</span>${t.flagged ? `<span class="rk" title="${t.flagged} flagged, needs action">${FLAG}${t.flagged}</span>` : ''}</div>
        <div class="ln"><span class="ct">${t.count}</span><span class="dol">${h.money(t.cents)}</span></div></button>`).join('')}
    </div>`
  }

  const search = () => `<button type="button" class="search" data-act="nav:Search">Search claims, patients</button>`

  /* queue */
  function row(s, h, it) {
    const sel = !s.run && s.selected && s.selected.id === it.id
    const waiting = !s.canAct(it)
    return `<button type="button" class="row ${sel ? 'sel' : ''}" data-part="inbox.queue-row" data-act="select:${it.id}" ${sel ? 'aria-current="true"' : ''}>
      <span class="l1"><i class="mk ${waiting ? 'mk-signer' : 'mk-you'}" aria-label="${waiting ? h.esc(signer(s)) + ' signs this' : 'Your move'}"></i><span class="nm">${h.esc(it.patient.display_name)}</span><span class="no">${h.esc(idOf(it))}</span><span class="tr">${h.esc(treatOf(it))}</span><span class="py">${h.esc(payerOf(it))}</span><span class="am">${h.money(it.cents)}</span></span>
      <span class="l2" style="display:block">${h.esc(it.copy.headline)}</span>
    </button>`
  }

  function groupRow(s, h, g) {
    const on = !s.run && s.selected && s.selected.group_key === g.key
    const what = cap((g.title.split(' · ')[1] || g.title).replace(/\s*\(\d+\)$/, ''))
    return `<div class="grp ${on ? 'on' : ''}" data-part="inbox.group">
      <button type="button" class="row" data-act="group:${h.esc(g.key)}" aria-expanded="${g.open}">
        <span class="l1"><i class="mk mk-you" aria-label="Your move"></i><span class="nm">${plural(g.count, 'claim')}</span><span class="caret">${CHEV(g.open)}</span><span class="tr">${gl(h, what)}</span><span class="py">${h.esc(payerOf(g.top))}</span><span class="am">${h.money(g.cents)}</span></span>
        <span class="l2" style="display:block">${h.esc(groupCopy(g).headline)}</span>
      </button>
      ${g.open ? g.items.map((it) => {
        const sel = !s.run && s.selected && s.selected.id === it.id
        return `<button type="button" class="row sub-row ${sel ? 'sel' : ''}" data-part="inbox.queue-row" data-act="select:${it.id}"><span class="l1"><span></span><span class="nm">${h.esc(it.patient.display_name)}</span><span class="no">${h.esc(idOf(it))}</span><span class="tr">${h.esc(it.copy.treatment)}</span><span class="py"></span><span class="am">${h.money(it.cents)}</span></span></button>`
      }).join('') : ''}
    </div>`
  }

  function runIds(s) {
    return s.run.ids.map((id) => D().items.find((x) => x.id === id)).filter(Boolean)
  }

  function runRow(s, h) {
    const r = s.run
    const its = runIds(s)
    const cents = its.reduce((a, i) => a + i.cents, 0)
    const state = r.failed ? 'Stopped' : r.done ? 'Done' : 'Running'
    return `<div class="runrow ${r.failed ? 'bad' : ''}"><span class="l1"><i class="mk ${r.failed ? 'mk-signer' : 'mk-agents'}"></i><span class="wide ${r.failed ? 'rk' : 'ag'}">${state}: ${h.esc(h.agentName(its[0] && its[0].agent))} agent</span><span class="py"></span><span class="am">${h.money(cents)}</span></span><span class="l2" style="display:block">${h.esc(r.title)}</span></div>`
  }

  function queue(s, h) {
    const blocked = (q) => q.type === 'item' && !s.canAct(q.item)
    const mine = s.queue.filter((q) => !blocked(q))
    const wait = s.queue.filter(blocked)
    const count = s.filtered.filter(s.canAct).length
    const draw = (q) => (q.type === 'group' ? groupRow(s, h, q) : row(s, h, q.item))
    return `<section class="queue" data-part="inbox.queue" aria-label="Queue">
      <div class="tabs" role="tablist">
        ${s.tabs.map((t) => `<button type="button" role="tab" aria-selected="${s.filter === t.key}" class="${s.filter === t.key ? 'on' : ''}" data-act="filter:${t.key}">${t.label} <span class="n">${t.count}</span></button>`).join('')}
        <span class="keys" data-part="inbox.keyboard"><kbd>J</kbd><kbd>K</kbd> move</span>
      </div>
      <div class="qscroll" data-scroll="queue">
        ${s.run ? runRow(s, h) : ''}
        ${mine.length ? `<div class="sec"><i class="mk mk-you"></i>Your move<span class="num">${count}</span></div>${mine.map(draw).join('')}` : ''}
        ${wait.length ? `<div class="sec blocked"><i class="mk mk-signer"></i>${h.esc(signer(s))} signs this<span class="num">${wait.length}</span></div>${wait.map(draw).join('')}` : ''}
        ${!mine.length && !wait.length ? `<div class="sec">Nothing here.</div>` : ''}
      </div>
    </section>`
  }

  /* decision */
  function recordLine(h, it) {
    if (it.record) {
      const m = it.record.match(/^(\d+ of \d+)(.*)$/)
      return m ? `<b>${h.esc(m[1])}</b>${gl(h, dots(m[2], ' '))}` : gl(h, dots(it.record))
    }
    const b = it.noRecord || ''
    const n = b.match(/n = (\d+)/)
    if (n) return `None yet. ${n[1]} past cases is too few to quote.`
    return `None. ${h.esc(cap(dots(b)))}.`
  }

  function policy(s, h, it) {
    const p = h.policy(it)
    if (!p) return ''
    if (!p.canLearn) return `<p class="pol" data-part="inbox.policy"><b>Always auto-run is not on offer here.</b> ${h.esc(p.reason)}</p>`
    return `<p class="pol" data-part="inbox.policy"><button type="button" class="lnk" style="font-size:12px" data-act="nav:Always auto-run">Always auto-run ${h.esc(p.rule)}</button> ${h.esc(p.reason)}</p>`
  }

  function evidence(s, h, it) {
    return `<div class="ev" data-part="inbox.evidence"><h3>Evidence ${s.group ? `<span class="a12">for ${h.esc(label(it))}</span>` : ''}${s.group && it.claim ? `<button type="button" class="lnk" data-act="open-claim:${it.claim.id}">Open claim</button>` : ''}</h3>
      ${it.evidence.length ? it.evidence.map((e) => `<div class="evr"><div><div class="tt">${gl(h, dots(e.title))}</div><div class="a12 num">${h.esc(KIND[e.kind] || 'Record')}, ${h.date(e.captured_at)} ${h.time(e.captured_at)}${e.ref ? `<br>${h.esc(e.ref)}` : ''}</div></div><div class="ex">${h.esc(dash(dots(e.excerpt)))}</div></div>`).join('') : `<p class="none" style="margin:0">Nothing captured. The portal and phone line are down, so there is no evidence to show.</p>`}
    </div>`
  }

  function decision(s, h) {
    const it = s.selected
    const g = s.group
    const c = g ? groupCopy(g) : it.copy
    const canAct = s.canAct(it)
    const name = h.agentName(it.agent)
    const others = g ? g.items.filter((x) => x.id !== it.id) : []
    const touches = c.touches || []
    const denialCode = it.claim ? dots(it.claim.reason, ' ') : ''
    const auditTail = it.audit_note ? cap(it.audit_note.replace(/^root cause: ours\s*—\s*/i, '')) : ''
    const ident = g
      ? `<span class="nm">${plural(g.count, 'claim')}</span><span>${h.esc(g.items[0].claim.payer.short_name)}, denied ${gl(h, denialCode)}</span>`
      : `<span class="nm">${h.esc(it.patient.display_name)}</span><span class="no">${h.esc(idOf(it))}</span><span>${h.esc(treatOf(it))}</span><span>${h.esc(payerOf(it))}${it.claim ? `, DOS ${h.dateYear(it.claim.dos)}` : ''}</span>`
    const primary = canAct
      ? g
        ? `<button type="button" class="btn" data-act="approve-group:${h.esc(g.key)}">${h.esc(c.action)} <kbd>⇧A</kbd></button>
           <button type="button" class="btn2" data-act="approve:${it.id}">Only ${h.esc(idOf(it))} <kbd>A</kbd></button>`
        : `<button type="button" class="btn" data-act="approve:${it.id}">${h.esc(c.action)} <kbd>A</kbd></button>`
      : ''
    return `<div data-part="inbox.decision">
      <div class="ident">${ident}<span class="rt">${tier(h, it.tier)}${!g && it.claim ? `<button type="button" class="lnk" data-act="open-claim:${it.claim.id}">Open claim</button>` : ''}</span></div>
      <div class="hl"><h2>${h.esc(c.headline)}</h2><span class="amt">${h.money(g ? g.cents : it.cents)}</span></div>
      <p class="why">${gl(h, c.why)}</p>
      <dl class="facts">
        <dt class="ag">${h.esc(name)} agent recommends</dt>
        <dd data-part="inbox.recommendation">${gl(h, dots(it.recommendation))}${others.length ? ` <span class="also">Same plan for ${others.map((o) => h.esc(label(o))).join(' and ')}.</span>` : ''}</dd>
        <dt>Track record</dt><dd>${recordLine(h, it)}</dd>
        <dt>${canAct ? 'Stopped at you' : 'Why it stopped'}</dt><dd data-part="inbox.why-stopped">${gl(h, c.stoppedBy)}</dd>
        ${it.deadline_on ? `<dt>Deadline</dt><dd class="num">Appeal due ${h.dateYear(it.deadline_on)}, ${h.daysUntil(it.deadline_on)} days left</dd>` : ''}
      </dl>
      ${it.root_cause === 'ours' ? `<div class="cause"><span class="t">Root cause: ours</span><span>${gl(h, auditTail)}</span></div>` : ''}
      ${it.draft ? `<div class="draft" data-part="inbox.draft"><h3>What goes to ${h.esc(payerOf(it))}, word for word</h3>${it.draft.map((d) => `<div class="seg"><span>${h.esc(d.text)}</span><span class="cite">${d.cites.length ? d.cites.map((t) => h.esc(dots(t))).join('<br>') : 'A request, nothing to cite'}</span></div>`).join('')}</div>` : ''}
      <dl class="facts"><dt>${canAct ? 'This will' : 'Signing will'}</dt><dd><ul class="touch">${touches.map((t) => `<li>${gl(h, t)}</li>`).join('')}</ul></dd></dl>
      ${canAct
        ? `<div class="acts" data-part="inbox.action-bar">${primary}<button type="button" class="btn3 push" data-act="nav:Edit plan">Edit plan</button><button type="button" class="btn3" data-act="reject:${it.id}">Reject</button><button type="button" class="btn3" data-act="snooze:${it.id}">Snooze</button></div>`
        : `<div class="signer" data-part="inbox.action-bar"><span class="big">${h.esc(signer(s))} signs this</span><span>${h.esc(it.copy.signerNote)}</span></div>
           <div class="acts"><button type="button" class="btn2" data-act="user:usr_morgan">Switch to ${h.esc(signer(s))}</button>${s.nextItem ? `<button type="button" class="btn3" data-act="select:${s.nextItem.id}">Your next item: ${h.esc(label(s.nextItem))}</button>` : ''}</div>`}
      ${policy(s, h, it)}
    </div>${evidence(s, h, it)}`
  }

  function afterState(s, h) {
    const r = s.run
    const its = runIds(s)
    const denied = s.strip.tiles.find((t) => t.status === 'denied')
    const leaving = its.filter((i) => i.claim && i.claim.status === 'denied').length
    const rows = r.changes.map((c) => {
      const flagged = c.label === 'Denied' ? `<span class="sm" style="display:block">Flagged ${denied.flagged + leaving} to ${denied.flagged}</span>` : ''
      return `<div class="chg"><span>${h.esc(c.label)}</span><span class="v">${c.from === c.to ? `stays ${c.to}` : `${c.from} → ${c.to}`}${flagged}</span><span class="note">${h.esc(c.note || '')}</span></div>`
    }).join('')
    const nx = s.nextItem
    return `<div class="after" data-part="inbox.after-state">
      <h3>${r.failed ? 'What happened' : 'What changed'}</h3>${rows}
      ${r.failed ? '' : `<p class="line-done">${h.esc(r.doneLine)}</p>`}
      <div class="acts">${nx ? `<button type="button" class="btn" data-act="next">Next: ${h.esc(label(nx))}</button>` : `<button type="button" class="btn2" data-act="dismiss">Close</button>`}
      ${r.failed && its[0] ? `<button type="button" class="btn3" data-act="select:${its[0].id}">Back to ${h.esc(label(its[0]))}</button>` : ''}</div>
    </div>`
  }

  function runPane(s, h) {
    const r = s.run
    const its = runIds(s)
    const failedAt = r.steps.findIndex((x) => x.state === 'failed')
    const cents = its.reduce((a, i) => a + i.cents, 0)
    const lab = r.failed ? `Stopped at step ${failedAt + 1} of ${r.steps.length}` : r.done ? `${h.agentName(its[0] && its[0].agent)} agent finished` : `${h.agentName(its[0] && its[0].agent)} agent is working`
    return `<div data-part="inbox.run">
      <div class="runlab ${r.failed ? 'bad' : ''}"><span>${h.esc(lab)}</span><span class="rt">${h.money(cents)}</span></div>
      <div class="hl"><h2>${h.esc(r.title)}</h2></div>
      <div class="runwho">${its.map((i) => `<span class="nm">${h.esc(i.patient.display_name)}</span> ${h.esc(idOf(i))}`).join(', ')}</div>
      ${r.failed ? `<p class="failmsg">${h.esc(r.failedText)}</p>` : ''}
      <ol class="steps">${r.steps.map((x, i) => `<li class="${x.state}"><i class="tick">${x.state === 'done' ? '✓' : x.state === 'failed' ? '✕' : ''}</i><span>${gl(h, x.text)}</span><span class="d">${x.state === 'pending' && r.failed ? 'Not run' : h.esc(x.detail || '')}</span></li>`).join('')}</ol>
    </div>${r.done ? afterState(s, h) : ''}`
  }

  function empty(s, h) {
    const n = s.nextItem
    return `<div class="emptyp" data-part="inbox.empty"><h2>${n ? 'Pick up where you left off' : 'Nothing left for you'}</h2>
      <p>${n ? `${h.esc(n.copy.headline)}.` : `This week agents ran ${s.week.ranAlone} items without you.`}</p>
      ${n ? `<button type="button" class="btn" data-act="next">Next: ${h.esc(label(n))}</button>` : ''}</div>`
  }

  function inbox(s, h) {
    const sub = `<span class="sub"><b>${s.strip.inbox_open}</b> items: ${s.reconcile.claims} claims, ${s.reconcile.visits} upcoming visits</span>`
    const sum = `<span class="sum" data-part="shell.agent-summary">This week agents ran <b class="ag">${s.week.ranAlone}</b> items without you; <b>${s.week.cameToYou}</b> came to you.<button type="button" class="lnk" data-act="nav:Activity">See what they did</button></span>`
    return `<div class="top" data-part="shell.header"><h1>Inbox</h1>${sub}${sum}${search()}</div>
      ${strip(s, h)}
      <div class="panes">${queue(s, h)}<section class="detail" data-scroll="detail" aria-label="Detail">${s.run ? runPane(s, h) : s.selected ? decision(s, h) : empty(s, h)}</section></div>`
  }

  /* claim */
  function moveFor(s, h) {
    const c = s.claim
    if (c.queued && !HELD.test(c.queued)) return { who: 'agents', label: 'With the agents, then ' + c.claim.payer.short_name }
    const it = c.openItems[0]
    if (it && !s.canAct(it)) return { who: 'signer', label: 'Waiting on ' + signer(s) }
    return h.move(c.claim)
  }

  function openItem(s, h) {
    const c = s.claim
    const r = s.run
    const mine = r && c.openItems.length + (c.queued ? 1 : 0) > 0 && r.ids.some((id) => D().items.find((x) => x.id === id && x.claim && x.claim.id === c.claim.id))
    if (mine && !r.done) {
      const at = r.steps.findIndex((x) => x.state === 'active')
      return `<div class="open" data-part="claim.open-item"><div><div class="lab ag">Agent is working, step ${at + 1} of ${r.steps.length}</div>${h.esc(r.title)}</div></div>`
    }
    if (mine && r.failed) return `<div class="open" data-part="claim.open-item"><div><div class="lab rk">Stopped</div>${h.esc(r.failedText)}</div></div>`
    if (c.queued) return `<div class="open" data-part="claim.open-item"><div><div class="lab ${HELD.test(c.queued) ? '' : 'ag'}">${HELD.test(c.queued) ? 'Off your list' : 'Done'}</div>${h.esc(c.queued)}</div></div>`
    const it = c.openItems[0]
    if (!it) return ''
    const can = s.canAct(it)
    return `<div class="open" data-part="claim.open-item">
      <div><div class="lab ag">${h.esc(h.agentName(it.agent))} agent recommends</div>${gl(h, dots(it.recommendation))}</div>
      <div class="acts">${can ? `<button type="button" class="btn" data-act="approve:${it.id}">${h.esc(it.copy.action)}</button>` : `<span><b>${h.esc(signer(s))} signs this</b></span>`}<button type="button" class="btn3" data-act="select:${it.id}">Open in Inbox</button></div>
    </div>`
  }

  function claimPage(s, h) {
    const c = s.claim
    const k = c.claim
    const m = c.money
    const denied = k.status === 'denied'
    const est = /^estimate/.test(m.basis || '')
    const mv = moveFor(s, h)
    const treatment = (D().copy.items['itm_' + k.number] || {}).treatment || k.procedures
    const tiles = s.strip.tiles.find((t) => t.status === k.status)
    const e = est ? ', est.' : ''
    const fig = [
      ['Billed', m.billed_cents],
      ['Allowed' + e, m.allowed_cents],
      ['Contractual' + e, m.contractual_cents === null ? null : -m.contractual_cents],
      ['Insurance' + e, m.insurance_est_cents],
      ['Patient' + e, m.patient_est_cents],
      ['Paid', m.paid_cents],
    ]
    const tl = [...c.timeline].reverse().sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    let lastDay = ''
    const tlRows = tl.map((t) => {
      const day = h.dateYear(t.at)
      const showDay = day !== lastDay
      lastDay = day
      const parts = (t.detail || '').split(' · ').filter((p) => p && !/^#\d+/.test(p) && !/^\$/.test(p) && p !== k.payer.short_name)
      const ours = t.kind === 'root_cause'
      return `<li><span class="d">${showDay ? day : ''}</span><span class="h">${h.time(t.at)}</span><i class="dot lane-${t.lane}" title="${h.esc(t.lane)}"></i><span class="ttl"><span class="${ours ? 'ours' : ''}">${gl(h, dots(dash(t.title)))}</span>${parts.length ? `<span class="det">${gl(h, parts.join(', '))}</span>` : ''}</span></li>`
    }).join('')
    return `<div class="top" data-part="shell.header"><h1>Claims</h1><span class="sub"><button type="button" class="lnk" data-act="back">Back to ${s.from === 'denials' ? 'Denials' : 'Inbox'}</button></span>${search()}</div>
      ${strip(s, h, tiles ? k.status : null)}
      <div class="page" data-scroll="claim">
        <div class="chead" data-part="claim.header">
          <div>
            <h2>${h.esc(c.patient.display_name)} <span class="no">#${k.number}</span></h2>
            <div class="meta">${h.esc(treatment)}, ${h.esc(c.coverage ? c.coverage.plan_name : k.payer.name)}, DOS ${h.dateYear(k.dos)}, ${h.esc(c.provider_name)}</div>
            <div class="whose"><i class="mk mk-${mv.who}"></i><span>${h.esc(mv.label)}</span><span class="a12 num" style="margin-left:10px">DOB ${h.dateYear(c.patient.dob)}, ICN ${h.esc(k.icn || 'none yet')}, ${plural(k.age_days, 'day')} old</span></div>
          </div>
          <div class="fig">
            <div class="big ${denied ? 'rk' : ''}">${h.money(denied ? k.billed_cents : m.billed_cents)}</div>
            <div class="a12">${denied ? 'at stake' : 'billed'}</div>
            ${c.deadline && c.deadline.due_on ? `<div class="due num">Appeal due ${h.dateYear(c.deadline.due_on)}, ${h.daysUntil(c.deadline.due_on)} days left</div><div class="a12">${h.esc(c.deadline.basis)}</div>` : ''}
          </div>
        </div>
        ${c.denial ? `<div class="denial ${c.denial.root_cause === 'ours' ? '' : 'plain'}" data-part="claim.denial"><span><span class="num">${gl(h, c.denial.carc + (c.denial.rarc ? ' ' + c.denial.rarc : ''))}</span> ${h.esc(c.denial.decoded)}</span>${c.denial.root_cause === 'ours' ? `<span class="t">Root cause: ours</span>` : ''}</div>` : ''}
        ${openItem(s, h)}
        <div class="money" data-part="claim.money">
          ${fig.map(([l, v]) => `<div><div class="a12">${h.esc(l)}</div><div class="ct">${v === null || v === undefined ? '—' : h.money(v)}</div></div>`).join('')}
          ${est ? `<div class="basis">Estimates from the contract allowed. ${denied ? `The ${h.esc(k.payer.short_name)} ERA paid ${h.money(m.paid_cents)} and put ${h.money(m.patient_resp_cents)} on the patient.` : ''}</div>` : `<div class="basis">Per the 835.</div>`}
        </div>
        <div class="cols">
          <div data-part="claim.timeline"><h3>Timeline <span class="note">newest first</span><span class="lg"><span><i class="lane-agent"></i>agents</span><span><i class="lane-payer"></i>payer</span><span><i class="lane-system"></i>system</span></span></h3><ol class="tl">${tlRows}</ol></div>
          <div>
            <div data-part="claim.lines"><h3>Line items</h3>
              <table><thead><tr><th>CDT</th><th>Tooth</th><th>Procedure</th><th class="r">Billed</th><th class="r">Allowed${e}</th><th class="r">Paid</th><th>Adjustments</th><th class="r">Patient, ERA</th></tr></thead>
              <tbody>${c.lines.map((l) => `<tr><td>${h.esc(l.cdt)}</td><td>${h.esc(l.tooth || '')}</td><td>${h.esc(CDT[l.cdt] || '')}</td><td class="r">${h.money(l.fee_cents)}</td><td class="r">${h.money(l.allowed_cents)}</td><td class="r">${h.money(l.paid_cents)}</td><td><span class="c2">${(l.adj || []).map((x) => gl(h, x.group + '-' + x.code) + ' ' + h.money(x.cents)).join('<br>')}</span></td><td class="r">${h.money(l.patient_cents)}</td></tr>`).join('')}</tbody>
              <tfoot><tr><td colspan="3">Total</td><td class="r">${h.money(m.billed_cents)}</td><td class="r">${h.money(m.allowed_cents)}</td><td class="r">${h.money(m.paid_cents)}</td><td></td><td class="r">${h.money(m.patient_resp_cents)}</td></tr></tfoot></table>
            </div>
            <div data-part="claim.side">
              ${c.attachments.length ? `<div class="pan"><h3>Attachments</h3>${c.attachments.map((a) => `<div class="r"><span>${gl(h, a.kind.toUpperCase())}${a.note ? `, ${h.esc(a.note)}` : ''}</span><span class="m">NEA# ${h.esc(a.nea_number)}, ${h.esc(a.source)}, ${h.date(a.created_at)} ${h.time(a.created_at)}</span></div>`).join('')}</div>` : ''}
              ${c.acks.length ? `<div class="pan"><h3>Acknowledgements</h3>${c.acks.map((a) => `<div class="r"><span>${gl(h, dots(dash(a.message)))}</span><span class="m">${h.date(a.at)} ${h.time(a.at)}</span></div>`).join('')}</div>` : ''}
            </div>
          </div>
        </div>
      </div>`
  }

  /* denials */
  function denialRow(s, h, r) {
    const it = r.item
    const k = r.claim
    const ours = r.root_cause === 'ours'
    const blocked = it && !s.canAct(it)
    const dl = r.deadline
    const move = r.resolved
      ? ran.has(r.inbox_item_id) ? { mk: 'agents', t: 'With the agents', u: 'Then ' + k.payer.short_name } : { mk: 'nobody', t: 'Off your list', u: 'Rejected or snoozed' }
      : blocked ? { mk: 'signer', t: r.signer + ' signs', u: `Contractual write-off, tier ${it.tier}` }
        : { mk: 'you', t: 'Your move', u: `${h.agentName(it ? it.agent : r.agent)} agent has it ready, tier ${it ? it.tier : ''}` }
    return `<div class="drow ${r.resolved ? 'off' : ''}" data-part="denials.row">
      <div><button type="button" class="who" data-act="open-claim:${k.id}"><span class="nm">${h.esc(k.patient.display_name)}</span><span class="no">#${k.number}</span></button><div class="a12">${h.esc(k.payer.short_name)}, ${h.esc(k.procedures)}</div></div>
      <div><div class="code">${gl(h, r.carc + (r.rarc ? ' ' + r.rarc : ''))}${ours ? ` <span class="rk b" style="margin-left:6px">Root cause: ours</span>` : ''}</div><div class="a12">${h.esc(r.decoded)}</div></div>
      <div class="r"><div class="stake">${h.money(k.billed_cents)}</div><div class="a12">${r.patient_billable_if_lost ? 'Patient can be billed' : 'Patient cannot be billed'}</div></div>
      <div data-part="denials.deadline">${dl.due_on ? `<div class="num">${h.dateYear(dl.due_on)}, ${h.daysUntil(dl.due_on)} days</div><div class="a12">${h.esc(dl.basis)}</div>` : `<div>No deadline</div><div class="a12">Closes in Payments</div>`}</div>
      <div data-part="denials.action"><div class="mv"><i class="mk mk-${move.mk}"></i><span>${h.esc(move.t)}</span>${it && !r.resolved ? `<button type="button" class="lnk" data-act="select:${it.id}">Open item</button>` : ''}</div><div class="a12" style="padding-left:15px">${h.esc(move.u)}</div></div>
    </div>`
  }

  function denialsPage(s, h) {
    const d = s.denials
    const rows = d.groups.flatMap((g) => g.rows)
    const cents = d.groups.reduce((a, g) => a + g.cents, 0)
    const next = rows.filter((r) => !r.resolved && r.item && s.canAct(r.item) && r.deadline.due_on).sort((a, b) => (a.deadline.due_on < b.deadline.due_on ? -1 : 1))[0]
    const live = rows.filter((r) => !r.resolved).length
    const flight = d.in_flight.length + rows.filter((r) => r.resolved).length
    const counted = rows.filter((r) => r.carc !== 'PR-119')
    const reasons = {}
    counted.forEach((r) => { const n = r.carc === 'CO-16' ? 'Documentation' : r.carc === 'CO-119' ? 'Frequency' : r.carc; reasons[n] = (reasons[n] || 0) + 1 })
    const payers = [...new Set(counted.map((r) => r.claim.payer.short_name))]
    const limits = rows.length - counted.length
    const ours = rows.filter((r) => r.root_cause === 'ours').length
    return `<div class="top" data-part="shell.header"><h1>Denials</h1><span class="sub"><b>${d.total}</b> denied, <b>${h.money(cents)}</b>, grouped by what happens next</span>${search()}</div>
      ${strip(s, h, 'denied')}
      <div class="page" data-scroll="denials">
        <div class="dbar" data-part="denials.summary"><span class="n">Next action <b>${live}</b></span><span class="n">In flight <b>${flight}</b></span>
          ${next ? `<span class="acts"><span class="a12 num">Earliest deadline ${h.dateYear(next.deadline.due_on)}</span><button type="button" class="btn" data-act="select:${next.item.id}">Review ${h.esc(next.claim.patient.display_name)} #${next.claim.number}</button></span>` : ''}</div>
        <div class="dwrap"><div class="dgrid">
          <div class="dh"><span>Claim</span><span>Reason</span><span class="r">At stake</span><span>Appeal deadline</span><span>Whose move</span></div>
          ${d.groups.map((g) => {
            const [nm, tt] = g.label.split(' · ')
            return `<div class="dg"><span class="nm">${h.esc(nm)}</span><span class="tt">${h.esc(tt || '')}</span><span class="rt">${g.count} ${g.count === 1 ? 'claim' : 'claims'}, <b>${h.money(g.cents)}</b></span></div>${g.rows.map((r) => denialRow(s, h, r)).join('')}`
          }).join('')}
        </div>
        <aside class="dside" data-part="denials.side"><h3>${h.esc(payers.join(', '))} by reason</h3>
          ${Object.entries(reasons).map(([k, v]) => `<div class="r"><span>${h.esc(k)}</span><span class="num">${v}</span></div>`).join('')}
          <div class="r t"><span class="rk">Root cause: ours</span><span class="num rk">${ours}</span></div>
          ${limits ? `<p>Max met and alternate benefits are plan limits, so they are not counted (${limits} here).</p>` : ''}
        </aside></div>
      </div>`
  }

  window.TorchProto.register({
    id: 'a',
    name: 'Biller’s view',
    tagline: 'The same two panes, quieter. Names and numbers carry the page.',
    premise: 'Nothing needs removing; today everything is just equally loud. This keeps the layout and the density and rations weight, so someone who works this queue all day can read it like a ledger.',
    proves: ['H4', 'H5', 'C1', 'C2', 'C3', 'S1'],
    serves: 'Demo steps 1, 2, 3, 4',
    fonts: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap',
    autoOpen: true,
    css,
    render(s, h) {
      if (s.run) s.run.ids.forEach((id) => (s.run.failed ? ran.delete(id) : ran.add(id)))
      const inner = s.screen === 'claim' ? (s.claim ? claimPage(s, h) : '') : s.screen === 'denials' ? denialsPage(s, h) : inbox(s, h)
      return `<div class="app" style="position:relative">${side(s, h)}<main class="main">${inner}</main>${s.toast ? `<div class="toast" role="status">${h.esc(s.toast)}</div>` : ''}</div>`
    },
  })
})()
