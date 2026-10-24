// Side panel + thread card CSS (widget-panel.js) — injected into the widget's shadow root when the chunk loads (see dom.ts adoptStyle).
export const PANEL_CSS = /* css */ `
/* Thread card */
.thread .head { display: flex; align-items: center; gap: 6px; padding: 10px 10px 10px 12px; border-bottom: 1px solid var(--line); }
.thread .scroll { max-height: min(52vh, 440px); overflow: auto; padding: 12px; display: grid; gap: 14px; overscroll-behavior: contain; }
.replies { display: grid; gap: 14px; }
.msg { display: grid; grid-template-columns: 24px 1fr; gap: 10px; }
.mb { display: grid; gap: 3px; min-width: 0; }
.msg .meta b { font-size: 13px; }
.pad { padding-left: 34px; }
.reply { display: flex; align-items: flex-end; gap: 8px; padding: 10px 10px 10px 12px; border-top: 1px solid var(--line); }
.reply textarea { min-height: 36px; max-height: 140px; }
.send { width: 34px; height: 34px; border-radius: 999px; background: var(--accent); color: var(--accent-fg); display: grid; place-items: center; flex: none; }
.acts { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px; border-top: 1px solid var(--line); }
.acts a { text-decoration: none; color: var(--fg); }

/* Sidebar (SitePing-style) */
.panel { position: fixed; top: 0; right: 0; bottom: 0; z-index: 2147483602; width: 400px; max-width: 100vw; background: var(--bg);
  box-shadow: var(--shadow); display: flex; flex-direction: column; animation: slide .18s ease-out; }
.phead { display: flex; align-items: center; gap: 6px; padding: 16px 12px 12px 18px; }
.ptitle { font-size: 17px; font-weight: 700; letter-spacing: -.01em; }
.stats { display: grid; gap: 8px; padding: 10px 18px 12px; border-block: 1px solid var(--line);
  background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 6%, var(--bg)), var(--bg)); }
.srow { display: flex; align-items: center; gap: 14px; }
.stat { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.stat b { font-size: 15px; color: var(--fg); letter-spacing: 0; }
.stat i { width: 7px; height: 7px; border-radius: 999px; background: var(--ok); }
.stat.done i { background: var(--muted); }
.stat.bugs i { background: var(--danger); }
.bar { flex: 1; height: 4px; border-radius: 999px; background: var(--line); overflow: hidden; }
.bar span { display: block; height: 100%; border-radius: inherit; background: var(--ok); transition: width .3s ease; }
.ptools { display: grid; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
.prow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.prow .seg { flex: 1; min-width: 0; }
.search { display: flex; align-items: center; gap: 6px; padding-left: 12px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); color: var(--muted); }
.search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
.search input { background: transparent; border: 0; padding-left: 0; height: 38px; box-shadow: none !important; }
.search input::-webkit-search-cancel-button { display: none; }
.panel .btn.sm { border-radius: 999px; height: 30px; padding: 0 11px; color: var(--fg); font-weight: 500; }
.panel .btn.sm[aria-pressed=true] { border-color: color-mix(in srgb, var(--accent) 50%, transparent); background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); }
.panel .btn.sm.danger { color: var(--danger); }
.panel .btn.sm.danger.solid { background: var(--danger); border-color: var(--danger); color: #fff; }
.panel .seg { border-radius: 999px; }
.panel .seg button { border-radius: 999px; height: 26px; }
.drop .up { font-size: 10.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.drop b { color: var(--accent); }
.selbar { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-bottom: 1px solid var(--line); min-height: 44px; }
.check { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); }
.check .box { width: 16px; height: 16px; border-radius: 5px; border: 1.5px solid var(--line); display: grid; place-items: center; color: transparent; background: var(--bg); }
.check .box svg { width: 12px; height: 12px; stroke-width: 3; }
.check[aria-checked=true] .box, .check[aria-checked=mixed] .box { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.plist { flex: 1; overflow: auto; padding: 10px 12px 16px; display: grid; align-content: start; gap: 10px; overscroll-behavior: contain;
  background: color-mix(in srgb, var(--soft) 55%, var(--bg)); }
.group { display: flex; align-items: center; gap: 6px; padding: 6px 4px 0; font-size: 12px; font-weight: 600; color: var(--muted); min-width: 0; }
.group span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fcard { position: relative; display: grid; grid-template-columns: 1fr; gap: 8px; padding: 12px 12px 10px 18px; border-radius: 14px; background: var(--bg);
  box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 0 0 1px var(--line); transition: box-shadow .12s; }
.fcard::before { content: ""; position: absolute; left: 7px; top: 12px; bottom: 12px; width: 3px; border-radius: 999px; background: var(--k); }
.fcard:hover, .fcard.sel { box-shadow: 0 4px 14px -6px rgba(0,0,0,.2), 0 0 0 1px color-mix(in srgb, var(--k) 45%, var(--line)); }
.fcard .check.solo { position: absolute; left: 16px; top: 13px; opacity: 0; transition: opacity .12s; }
.fcard:hover .check.solo, .fcard .check.solo:focus-visible, .fcard .check.solo[aria-checked=true], .plist:has(.check.solo[aria-checked=true]) .check.solo { opacity: 1; }
.fcard:has(.check.solo:is([aria-checked=true], :focus-visible)) .fmain, .fcard:hover:has(.check.solo) .fmain,
.plist:has(.check.solo[aria-checked=true]) .fcard:has(.check.solo) .fmain { padding-left: 24px; }
.fmain { display: grid; gap: 6px; text-align: left; min-width: 0; transition: padding .12s; }
.fmain:focus-visible { outline-offset: 4px; border-radius: 6px; }
.fmain .num { font-size: 12.5px; color: var(--muted); }
.fmain .tag { background: color-mix(in srgb, var(--k) 12%, transparent); color: var(--k); border-radius: 999px; }
.where { display: inline-flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.where svg { width: 12px; height: 12px; }
.facts { display: flex; justify-content: flex-end; gap: 6px; }
.empty { display: grid; justify-items: center; gap: 6px; padding: 40px 16px; text-align: center; }
.spin { width: 18px; height: 18px; border-radius: 999px; border: 2px solid var(--line); border-top-color: var(--accent); animation: spin .8s linear infinite; }
.confirm { display: grid; gap: 10px; padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); border-top: 1px solid var(--line); background: var(--bg);
  box-shadow: 0 -8px 24px -12px rgba(0,0,0,.2); animation: up .16s ease-out; }
.xwrap { position: relative; }
.xmenu { position: absolute; right: 0; top: calc(100% + 6px); z-index: 1; width: 200px; padding: 4px; border-radius: 12px; background: var(--bg);
  box-shadow: var(--shadow); animation: pop .12s ease-out; }
.prow .xmenu { right: auto; left: 0; }
.xmenu button { display: flex; align-items: center; gap: 8px; width: 100%; height: 32px; padding: 0 10px; border-radius: 8px; font-size: 13px; text-align: left; }
.xmenu button:hover, .xmenu button:focus-visible { background: var(--soft); outline: none; }
.xmenu button[aria-checked=true] { font-weight: 600; color: var(--accent); }
.xmenu svg { color: var(--muted); }
.xmenu .sw { width: 9px; height: 9px; border-radius: 999px; background: var(--k, transparent); box-shadow: inset 0 0 0 1.5px var(--k, var(--muted)); }
@media (max-width: 639px) { .panel { width: 100vw; } .phead .btn.sm { padding: 0 8px; } }
`;
