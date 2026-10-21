// All widget CSS. It lives inside a closed shadow root, so nothing leaks in or out (blueprint 05 §3).
// z-index ladder: shield < outline < areas < pins < launcher < menu/panel < cards < modal < toast.
const CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Cpath d='M3 25V12a9 9 0 0 1 9-9h4a9 9 0 0 1 0 18H8z' fill='%235b5bd6' stroke='white' stroke-width='2'/%3E%3Cpath d='M14 8v8M10 12h8' stroke='white' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E\") 3 25, crosshair";

export const STYLES = /* css */ `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.root {
  --bg: #ffffff; --fg: #18181b; --muted: #6b6b76; --line: #e4e4e7; --soft: #f4f4f5;
  --accent: var(--annota-accent, #5b5bd6); --accent-fg: #fff; --danger: #d93036; --ok: #218358; --warn: #ad5700;
  --shadow: 0 12px 32px -12px rgba(0,0,0,.28), 0 2px 6px -2px rgba(0,0,0,.08), 0 0 0 1px rgba(0,0,0,.06);
  font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--fg); -webkit-font-smoothing: antialiased; text-align: left; letter-spacing: normal;
}
@media (prefers-color-scheme: dark) {
  .root { --bg: #1c1c1f; --fg: #fafafa; --muted: #a1a1aa; --line: #34343a; --soft: #27272a; --ok: #3dd68c; --warn: #ffc53d;
    --shadow: 0 12px 32px -12px rgba(0,0,0,.8), 0 0 0 1px rgba(255,255,255,.09); }
}
button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; padding: 0; margin: 0; }
button:disabled { cursor: default; opacity: .55; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
svg { width: 16px; height: 16px; flex: none; }
b { font-weight: 600; }
p { margin: 0; }
a { color: var(--accent); }
.grow { flex: 1; min-width: 0; }
.muted { color: var(--muted); font-size: 12px; }
.err { color: var(--danger); font-size: 12px; }
.err:empty { display: none; }
kbd { font: 11px ui-monospace, SFMono-Regular, monospace; padding: 1px 5px; border-radius: 4px; background: var(--soft); color: var(--muted); box-shadow: inset 0 -1px 0 var(--line); }

textarea, input { width: 100%; font: inherit; color: var(--fg); background: var(--soft); border: 1px solid transparent;
  border-radius: 10px; padding: 8px 10px; margin: 0; resize: none; outline: none; transition: border-color .12s, background .12s; }
textarea:focus, input:focus { border-color: var(--accent); background: var(--bg); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
textarea:focus-visible, input:focus-visible { outline: none; }
textarea::placeholder, input::placeholder { color: var(--muted); }
textarea { min-height: 76px; field-sizing: content; max-height: 220px; }
.row { display: flex; gap: 8px; }

/* Launcher */
.launcher { position: fixed; z-index: 2147483600; height: 52px; min-width: 52px; border-radius: 999px;
  background: var(--accent); color: var(--accent-fg); box-shadow: 0 8px 24px -6px color-mix(in srgb, var(--accent) 60%, transparent), var(--shadow);
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: transform .16s ease, box-shadow .16s; }
.launcher.pill { height: 44px; padding: 0 18px 0 14px; font-weight: 600; font-size: 14px; }
.launcher:hover { transform: translateY(-1px) scale(1.04); }
.launcher:active { transform: scale(.97); }
.launcher svg { width: 22px; height: 22px; transition: transform .2s ease; }
.launcher.pill svg { width: 18px; height: 18px; }
.launcher[aria-expanded=true] svg { transform: rotate(-12deg) scale(.92); }
.launcher .count { position: absolute; top: -3px; right: -3px; min-width: 20px; height: 20px; padding: 0 6px;
  border-radius: 999px; background: var(--fg); color: var(--bg); font-size: 11px; font-weight: 700; line-height: 20px;
  text-align: center; box-shadow: 0 0 0 2px var(--bg); }
.launcher[data-tip]::after { content: attr(data-tip); position: absolute; white-space: nowrap; pointer-events: none;
  padding: 5px 9px; border-radius: 8px; background: var(--fg); color: var(--bg); font-size: 12px; font-weight: 500;
  opacity: 0; transform: translateY(4px); transition: opacity .12s, transform .12s; }
.launcher.bottom[data-tip]::after { bottom: calc(100% + 10px); }
.launcher.top[data-tip]::after { top: calc(100% + 10px); }
.launcher.right[data-tip]::after { right: 0; }
.launcher.left[data-tip]::after { left: 0; }
.launcher[data-tip]:hover::after, .launcher[data-tip]:focus-visible::after { opacity: 1; transform: none; }
.launcher[aria-expanded=true]::after { display: none; }
.picking .launcher { opacity: .35; }

/* Menu */
.menu { position: fixed; z-index: 2147483601; width: 284px; padding: 6px; background: var(--bg); border-radius: 14px;
  box-shadow: var(--shadow); animation: pop .14s ease-out; }
.menu.top { transform-origin: top; }
.menu button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border-radius: 9px; text-align: left; }
.menu button:hover, .menu button:focus-visible { background: var(--soft); outline: none; }
.menu .ico { width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; background: var(--soft); color: var(--accent); flex: none; }
.menu button:hover .ico { background: var(--bg); }
.menu small { display: block; color: var(--muted); font-size: 12px; }
.menu .foot { padding: 6px 10px 2px; margin-top: 4px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; }

/* Comment mode */
.shield { position: fixed; inset: 0; z-index: 2147483590; cursor: ${CURSOR}; touch-action: none; background: transparent;
  -webkit-user-select: none; user-select: none; }
.hint { position: fixed; z-index: 2147483602; left: 50%; top: 16px; translate: -50% 0; max-width: calc(100vw - 24px);
  padding: 8px 14px; border-radius: 999px; background: var(--fg); color: var(--bg); font-size: 13px; pointer-events: none;
  box-shadow: var(--shadow); display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 8px; align-items: center; animation: pop .14s ease-out; }
.hint kbd { background: rgba(127,127,127,.3); color: inherit; box-shadow: none; }
.outline { position: fixed; z-index: 2147483591; pointer-events: none; border: 1.5px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 7%, transparent); border-radius: 4px; transition: all .06s ease-out; }
.outline span { position: absolute; left: -1.5px; top: -21px; padding: 1px 6px; border-radius: 4px; background: var(--accent);
  color: var(--accent-fg); font: 11px/17px ui-monospace, monospace; white-space: nowrap; }

/* Regions and pins on the page */
.area { position: fixed; z-index: 2147483592; pointer-events: none; border-radius: 6px;
  border: 1.5px solid color-mix(in srgb, var(--accent) 45%, transparent); background: color-mix(in srgb, var(--accent) 6%, transparent);
  transition: background .15s, border-color .15s; }
.area.hot, .area.draft { border: 2px solid var(--accent); background: color-mix(in srgb, var(--accent) 16%, transparent); }
.area.draft { z-index: 2147483596; }
.area.moved { border-style: dashed; border-color: var(--warn); }
.av { width: 24px; height: 24px; border-radius: 999px; background: var(--c, var(--accent)); color: #fff; flex: none;
  display: grid; place-items: center; font-size: 10px; font-weight: 700; letter-spacing: .02em; }
.av svg { width: 13px; height: 13px; }
.pin { position: fixed; z-index: 2147483595; width: ${32}px; height: ${32}px; border-radius: 50% 50% 50% 4px;
  background: var(--c, var(--accent)); border: 2px solid #fff; color: #fff; box-shadow: 0 4px 12px -2px rgba(0,0,0,.35);
  display: grid; place-items: center; transform-origin: 0 100%; transition: transform .14s ease, opacity .14s; }
.pin .av { width: 100%; height: 100%; background: none; font-size: 11px; }
.pin .n { position: absolute; top: -7px; right: -9px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px;
  background: var(--fg); color: var(--bg); font-size: 10px; font-weight: 700; line-height: 18px; text-align: center;
  box-shadow: 0 0 0 2px var(--bg); }
.pin:hover, .pin.active, .pin:focus-visible { transform: scale(1.12); z-index: 2147483597; }
.pin.active { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 45%, transparent), 0 4px 12px -2px rgba(0,0,0,.35); }
.pin.resolved { filter: saturate(.2); opacity: .8; }
.pin.resolved .n { background: var(--ok); color: #fff; }
.pin.moved { border-style: dashed; border-color: var(--warn); }
.pin.pending { opacity: .7; }
.pin.draft { z-index: 2147483596; background: var(--accent); pointer-events: none; animation: drop .2s ease-out; }
.pin.pulse { animation: pulse 1.2s ease-out 2; }

/* Cards */
.card { position: fixed; z-index: 2147483603; width: 340px; max-width: calc(100vw - 24px); background: var(--bg);
  border-radius: 14px; box-shadow: var(--shadow); animation: pop .14s ease-out; outline: none; }
.card.sheet { left: 0 !important; right: 0; bottom: 0; top: auto !important; width: 100%; max-width: none;
  border-radius: 18px 18px 0 0; padding-bottom: env(safe-area-inset-bottom); animation: up .2s ease-out; }
.card.preview { width: 280px; padding: 12px; display: grid; gap: 6px; pointer-events: none; z-index: 2147483604; }
.composer { padding: 12px; display: grid; gap: 10px; }
.meta { display: flex; align-items: center; gap: 6px; font-size: 12px; min-width: 0; flex-wrap: wrap; }
.by { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; }
.by .av { width: 20px; height: 20px; font-size: 9px; }
.title { display: block; font-size: 13px; }
.text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13.5px; }
.clamp, .clamp2 { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
.clamp2 { -webkit-line-clamp: 2; }
.tag { display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 6px; background: var(--k);
  color: #fff; font-size: 11px; font-weight: 600; letter-spacing: .01em; flex: none; }
.chip { display: inline-flex; align-items: center; height: 18px; padding: 0 7px; border-radius: 999px; background: var(--soft);
  color: var(--muted); font-size: 11px; font-weight: 600; }
.chip.ok { background: color-mix(in srgb, var(--ok) 14%, transparent); color: var(--ok); }
.chip.warn { background: color-mix(in srgb, var(--warn) 14%, transparent); color: var(--warn); }
.chip.team { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }
.kinds { display: flex; gap: 6px; flex-wrap: wrap; }
.kinds button { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 999px;
  border: 1px solid var(--line); font-size: 12px; font-weight: 500; color: var(--muted); }
.kinds button::before { content: ""; width: 7px; height: 7px; border-radius: 999px; background: var(--k); }
.kinds button:hover { background: var(--soft); }
.kinds button[aria-checked=true] { border-color: var(--k); color: var(--fg); background: color-mix(in srgb, var(--k) 12%, transparent); }
.who { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
.who b { color: var(--fg); }
.who .av { width: 20px; height: 20px; font-size: 9px; }
.linkish { color: var(--accent); font-size: 12px; font-weight: 500; }
.linkish:hover { text-decoration: underline; }
.consent { display: grid; gap: 4px; padding: 8px 10px; border-radius: 10px; background: var(--soft); color: var(--muted); font-size: 12px; }
.consent a { font-weight: 500; justify-self: start; }
.foot { display: flex; align-items: center; gap: 6px; }
.btn { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 14px; border-radius: 9px; font-weight: 600; font-size: 13px; }
.btn.primary { background: var(--accent); color: var(--accent-fg); }
.btn.primary:hover:not(:disabled) { filter: brightness(1.08); }
.btn.ghost:hover { background: var(--soft); }
.btn.sm { height: 28px; padding: 0 9px; font-size: 12px; border: 1px solid var(--line); }
.btn.sm:hover { background: var(--soft); }
.btn.sm svg { width: 14px; height: 14px; }
.ib { width: 28px; height: 28px; border-radius: 8px; display: inline-grid; place-items: center; color: var(--muted); flex: none; }
.ib:hover { background: var(--soft); color: var(--fg); }
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

/* Side panel */
.panel { position: fixed; top: 0; right: 0; bottom: 0; z-index: 2147483602; width: 360px; max-width: 100vw; background: var(--bg);
  box-shadow: var(--shadow); display: flex; flex-direction: column; animation: slide .18s ease-out; }
.phead { display: flex; align-items: center; gap: 8px; padding: 14px 12px 10px 16px; font-size: 15px; }
.ptools { display: grid; gap: 8px; padding: 0 12px 10px; border-bottom: 1px solid var(--line); }
.seg { display: flex; padding: 2px; border-radius: 10px; background: var(--soft); }
.seg button { flex: 1; height: 28px; border-radius: 8px; font-size: 12px; font-weight: 600; color: var(--muted); }
.seg button[aria-pressed=true] { background: var(--bg); color: var(--fg); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
.search { display: flex; align-items: center; gap: 6px; padding-left: 10px; border-radius: 10px; background: var(--soft); color: var(--muted); }
.search input { background: transparent; border: 0; padding-left: 0; height: 34px; }
.search input::-webkit-search-cancel-button { display: none; }
.switch { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); justify-self: start; }
.knob { position: relative; width: 28px; height: 16px; border-radius: 999px; background: var(--line); transition: background .15s; }
.knob::after { content: ""; position: absolute; left: 2px; top: 2px; width: 12px; height: 12px; border-radius: 999px; background: #fff;
  box-shadow: 0 1px 2px rgba(0,0,0,.3); transition: transform .15s; }
.switch[aria-checked=true] .knob { background: var(--accent); }
.switch[aria-checked=true] .knob::after { transform: translateX(12px); }
.plist { flex: 1; overflow: auto; padding: 6px; overscroll-behavior: contain; }
.item { display: grid; grid-template-columns: 24px 1fr; gap: 10px; width: 100%; padding: 10px; border-radius: 10px; text-align: left; }
.item:hover { background: var(--soft); }
.ib-body { display: grid; gap: 4px; min-width: 0; }
.ib-body .meta:last-child:empty { display: none; }
.empty { display: grid; gap: 4px; padding: 40px 16px; text-align: center; }

/* Bug report modal */
.modal { position: fixed; inset: 0; z-index: 2147483604; background: rgba(9,9,11,.62); backdrop-filter: blur(2px);
  display: grid; place-items: center; padding: 16px; animation: fade .14s; }
.editor { width: min(1180px, 100%); height: min(760px, calc(100vh - 32px), calc(100dvh - 32px)); display: grid; grid-template-rows: auto minmax(0,1fr); gap: 10px; animation: pop .16s ease-out; }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; background: var(--bg); border-radius: 12px; padding: 5px; box-shadow: var(--shadow); }
.tgroup { display: flex; align-items: center; gap: 2px; }
.sep { width: 1px; height: 20px; background: var(--line); margin: 0 4px; }
.tb { position: relative; width: 32px; height: 32px; border-radius: 8px; display: grid; place-items: center; color: var(--muted); }
.tb:hover:not(:disabled) { background: var(--soft); color: var(--fg); }
.tb[aria-pressed=true] { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }
.tb:disabled { opacity: .35; }
.tb[data-tip]:hover::after { content: attr(data-tip); position: absolute; top: calc(100% + 6px); left: 50%; translate: -50% 0; z-index: 1;
  white-space: nowrap; padding: 4px 8px; border-radius: 6px; background: var(--fg); color: var(--bg); font-size: 11px; font-weight: 500; pointer-events: none; }
.tb .dot { border-radius: 999px; background: currentColor; }
.size-s .dot { width: 4px; height: 4px; } .size-m .dot { width: 7px; height: 7px; } .size-l .dot { width: 11px; height: 11px; }
.swatch { width: 22px; height: 22px; margin: 0 2px; border-radius: 999px; background: var(--sw); box-shadow: inset 0 0 0 1px rgba(127,127,127,.45); transition: transform .1s; }
.swatch:hover:not(:disabled) { transform: scale(1.1); }
.swatch[aria-pressed=true] { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--sw); }
.swatch:disabled { opacity: .35; }
.stage { display: grid; grid-template-columns: minmax(0,1fr) 340px; grid-template-rows: minmax(0,1fr); gap: 10px; min-height: 0; }
.shot { display: grid; grid-template-rows: minmax(0,1fr) auto; gap: 10px; min-height: 0; min-width: 0; }
.canvas-wrap { position: relative; min-height: 0; overflow: auto; border-radius: 12px; display: grid; place-items: center; padding: 12px;
  background: #18181b radial-gradient(rgba(255,255,255,.07) 1px, transparent 1px) 0 0 / 16px 16px; }
.ed { position: relative; max-width: 100%; max-height: 100%; line-height: 0; }
.ed canvas { display: block; max-width: 100%; max-height: calc(min(760px, 100vh - 32px) - 150px); border-radius: 6px;
  box-shadow: 0 8px 30px rgba(0,0,0,.45); cursor: crosshair; touch-action: none; }
.ed canvas[data-tool=text] { cursor: text; }
.ed-text { position: absolute; width: auto; min-width: 8em; padding: 0 2px; margin: 0; border: 1px dashed currentColor; border-radius: 3px;
  background: rgba(255,255,255,.85); font-weight: 600; line-height: 1.2; box-shadow: none !important; }
.note { display: grid; justify-items: center; gap: 8px; max-width: 360px; padding: 24px; text-align: center; color: #d4d4d8; font-size: 13px; line-height: 1.5; }
.note svg { width: 22px; height: 22px; }
.note b { color: #fff; font-size: 15px; }
.note .row { flex-wrap: wrap; justify-content: center; margin-top: 6px; }
.note .btn.sm { color: #fafafa; border-color: rgba(255,255,255,.25); }
.note .btn.sm:hover { background: rgba(255,255,255,.08); }
.note-ico { width: 40px; height: 40px; border-radius: 999px; display: grid; place-items: center; background: rgba(229,72,77,.18); color: #ff8589; }
.spin { width: 22px; height: 22px; border-radius: 999px; border: 2.5px solid rgba(255,255,255,.2); border-top-color: #fff; animation: spin .8s linear infinite; }
.capbar { justify-self: center; background: var(--bg); box-shadow: var(--shadow); padding: 3px; max-width: 100%; overflow-x: auto; }
.capbar button { flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 0 12px; height: 30px; }
.capbar svg { width: 15px; height: 15px; }
.capbar button:hover:not(:disabled):not([aria-pressed=true]) { color: var(--fg); }
.side { background: var(--bg); border-radius: 14px; box-shadow: var(--shadow); display: grid; grid-template-rows: auto minmax(0,1fr) auto; min-height: 0; overflow: hidden; }
.side-head { display: flex; gap: 10px; align-items: flex-start; padding: 14px 16px 12px; border-bottom: 1px solid var(--line); }
.side-head b { display: block; font-size: 15px; }
.side-head small { display: block; color: var(--muted); font-size: 12px; margin-top: 1px; }
.side-ico { width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; flex: none;
  background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger); }
.side-body { display: grid; gap: 12px; padding: 14px 16px; overflow: auto; align-content: start; overscroll-behavior: contain; }
.side-foot { padding: 12px 16px; border-top: 1px solid var(--line); gap: 8px; }
.side-foot .err { flex: 1; min-width: 0; line-height: 1.35; }
.desc { min-height: 96px; }
.field { display: grid; gap: 6px; }
.label { font-size: 12px; font-weight: 600; color: var(--muted); }
.sev button[aria-checked=true] { background: var(--bg); color: var(--fg); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
.sev button[data-sev=high][aria-checked=true] { color: var(--warn); }
.sev button[data-sev=critical][aria-checked=true] { color: var(--danger); }
.drop { display: flex; gap: 10px; align-items: center; padding: 10px 12px; border: 1.5px dashed var(--line); border-radius: 10px;
  color: var(--muted); font-size: 12.5px; transition: border-color .12s, background .12s; }
.drop small { display: block; font-size: 11px; margin-top: 2px; }
.drop.over { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 7%, transparent); }
.files { display: grid; gap: 6px; }
.file { display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 6px; border-radius: 10px; background: var(--soft); font-size: 12.5px; min-width: 0; }
.file img, .fi { width: 36px; height: 36px; border-radius: 7px; object-fit: cover; flex: none; background: var(--bg); }
.fi { display: grid; place-items: center; color: var(--danger); }
.fname { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.file small { color: var(--muted); font-size: 11px; }
.summary { list-style: none; margin: 0; padding: 4px 10px; border-radius: 10px; background: var(--soft); display: grid; font-size: 12.5px; }
.summary li { display: flex; align-items: center; gap: 8px; padding: 5px 0; }
.summary li + li { border-top: 1px solid var(--line); }
.summary svg { width: 14px; height: 14px; color: var(--muted); }
.summary li.on > svg:last-child { color: var(--ok); }
.summary li.off { color: var(--muted); }
.card.ask { position: static; width: 380px; padding: 20px; display: grid; gap: 8px; }
.ask-ico { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); }
.ask-title { font-size: 15px; }
.ask .foot { margin-top: 8px; }
.launcher.queued::before { content: ""; position: absolute; bottom: 1px; right: 1px; width: 12px; height: 12px; border-radius: 999px;
  background: var(--warn); box-shadow: 0 0 0 2px var(--bg); }
@media (max-width: 760px) {
  .editor { height: 100%; grid-template-rows: auto auto; overflow: auto; }
  .stage { grid-template-columns: 1fr; }
  .ed canvas { max-height: 42vh; }
  .side { overflow: visible; }
}

.toast { position: fixed; z-index: 2147483605; left: 50%; bottom: 24px; translate: -50% 0; padding: 10px 16px;
  border-radius: 12px; background: var(--fg); color: var(--bg); box-shadow: var(--shadow); font-size: 13px; font-weight: 500; animation: pop .14s ease-out; }

@media (max-width: 639px) {
  .panel { width: 100vw; }
  .menu { width: calc(100vw - 24px); max-width: 320px; }
}
@keyframes pop { from { opacity: 0; transform: translateY(4px) scale(.98); } }
@keyframes up { from { transform: translateY(100%); } }
@keyframes slide { from { transform: translateX(100%); } }
@keyframes fade { from { opacity: 0; } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes drop { from { opacity: 0; transform: translateY(-6px) scale(.8); } }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 60%, transparent); } 100% { box-shadow: 0 0 0 18px transparent; } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;
