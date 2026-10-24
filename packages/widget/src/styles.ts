// All widget CSS. It lives inside a closed shadow root, so nothing leaks in or out (blueprint 05 §3).
// z-index ladder: shield < outline < areas < hover ring < pins < launcher < dial/panel < cards < modal < toast.
const CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Cpath d='M3 25V12a9 9 0 0 1 9-9h4a9 9 0 0 1 0 18H8z' fill='%23d63a1c' stroke='white' stroke-width='2'/%3E%3Cpath d='M14 8v8M10 12h8' stroke='white' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E\") 3 25, crosshair";

export const STYLES = /* css */ `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.root {
  --bg: #ffffff; --fg: #18181b; --muted: #6b6b76; --line: #e4e4e7; --soft: #f4f4f5;
  --accent: var(--pinwren-accent, #d63a1c); --accent-fg: #fff; --danger: #d93036; --ok: #218358; --warn: #ad5700;
  --shadow: 0 12px 32px -12px rgba(0,0,0,.28), 0 2px 6px -2px rgba(0,0,0,.08), 0 0 0 1px rgba(0,0,0,.06);
  font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--fg); -webkit-font-smoothing: antialiased; text-align: left; letter-spacing: normal;
}
/* Dark follows the visitor's system unless the host page forces a theme (theme option, data-theme). */
@media (prefers-color-scheme: dark) {
  .root:not([data-theme=light]) { --bg: #1c1c1f; --fg: #fafafa; --muted: #a1a1aa; --line: #34343a; --soft: #27272a; --ok: #3dd68c; --warn: #ffc53d;
    --shadow: 0 12px 32px -12px rgba(0,0,0,.8), 0 0 0 1px rgba(255,255,255,.09); color-scheme: dark; }
}
.root[data-theme=dark] { --bg: #1c1c1f; --fg: #fafafa; --muted: #a1a1aa; --line: #34343a; --soft: #27272a; --ok: #3dd68c; --warn: #ffc53d;
    --shadow: 0 12px 32px -12px rgba(0,0,0,.8), 0 0 0 1px rgba(255,255,255,.09); color-scheme: dark; }
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

/* Launcher: a speed dial (fab.ts) */
.launcher { position: fixed; z-index: 2147483600; height: 52px; min-width: 52px; border-radius: 999px;
  background: var(--accent); color: var(--accent-fg); box-shadow: 0 8px 24px -6px color-mix(in srgb, var(--accent) 60%, transparent), var(--shadow);
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: transform .16s ease, box-shadow .16s; }
.launcher.pill { height: 44px; padding: 0 18px 0 14px; font-weight: 600; font-size: 14px; }
.launcher:hover { transform: translateY(-1px) scale(1.04); }
.launcher:active { transform: scale(.97); }
.launcher svg { width: 22px; height: 22px; transition: transform .2s ease; }
.launcher.pill svg { width: 18px; height: 18px; }
.launcher .lx { display: none; }
.launcher[aria-expanded=true] .li { display: none; }
.launcher[aria-expanded=true] .lx { display: contents; }
.launcher[aria-expanded=true] .lx svg { transform: rotate(90deg); }
.launcher .count { position: absolute; top: -4px; right: -4px; min-width: 20px; height: 20px; padding: 0 6px;
  border-radius: 999px; background: #17243a; color: #fff; font-size: 11px; font-weight: 700; line-height: 20px;
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

.dial { position: fixed; z-index: 2147483601; display: flex; flex-direction: column; gap: 10px; pointer-events: none; }
.dial.right { align-items: flex-end; }
.dial.left { align-items: flex-start; }
.dial > * { pointer-events: auto; animation: rise .16s ease-out backwards; }
.dial > :nth-child(2) { animation-delay: .03s; }
.dial > :nth-child(3) { animation-delay: .06s; }
.dial > :nth-child(4) { animation-delay: .09s; }
.act { display: flex; align-items: center; gap: 10px; }
.dial.left .act { flex-direction: row-reverse; }
.act .lbl { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border-radius: 999px; background: var(--bg);
  color: var(--fg); font-size: 13px; font-weight: 500; white-space: nowrap; box-shadow: var(--shadow); }
.act .lbl kbd { font-size: 10px; }
.act .note { color: var(--warn); font-size: 11.5px; }
.act .note::before { content: "·"; margin-right: 6px; color: var(--muted); }
.act .ic { position: relative; width: 44px; height: 44px; border-radius: 999px; display: grid; place-items: center; flex: none;
  background: var(--bg); color: var(--accent); box-shadow: var(--shadow); border: 1.5px solid color-mix(in srgb, var(--accent) 55%, transparent);
  transition: transform .12s, background .12s, color .12s; }
.act .ic svg { width: 19px; height: 19px; }
.act:hover .ic, .act:focus-visible .ic { background: var(--accent); color: var(--accent-fg); transform: scale(1.06); }
.act:focus-visible { outline: none; }
.act:focus-visible .lbl { box-shadow: 0 0 0 2px var(--accent), var(--shadow); }
.act[aria-checked=false] .ic { color: var(--muted); border-color: var(--line); }
.act .ac { position: absolute; top: -5px; right: -5px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: var(--fg);
  color: var(--bg); font-size: 10px; font-weight: 700; line-height: 18px; text-align: center; }
.dial .pw { padding: 0 6px; color: var(--muted); font-size: 11px; text-shadow: 0 0 6px var(--bg); }

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
.pin { position: fixed; z-index: 2147483595; width: 26px; height: 26px; border-radius: 999px; background: var(--bg);
  border: 2px solid var(--c, var(--accent)); color: var(--c, var(--accent)); box-shadow: 0 3px 10px -2px rgba(0,0,0,.3);
  display: grid; place-items: center; font-size: 11.5px; font-weight: 700; line-height: 1;
  transition: transform .14s ease, opacity .14s, background .14s, color .14s; }
.pin .ok { display: none; }
.pin .ok svg { width: 13px; height: 13px; stroke-width: 2.6; }
.pin:hover, .pin.active, .pin:focus-visible { transform: scale(1.15); z-index: 2147483597; background: var(--c, var(--accent)); color: #fff; }
.pin.active { box-shadow: 0 0 0 4px color-mix(in srgb, var(--c, var(--accent)) 30%, transparent), 0 3px 10px -2px rgba(0,0,0,.3); }
.pin.resolved { border-color: var(--muted); color: var(--muted); opacity: .75; }
.pin.resolved:hover, .pin.resolved.active, .pin.resolved:focus-visible { background: var(--muted); color: var(--bg); opacity: 1; }
.pin.resolved .n { display: none; }
.pin.resolved .ok { display: contents; }
.pin.moved { border-style: dashed; }
.pin.pending { opacity: .7; }
.pin.draft { z-index: 2147483596; background: var(--accent); border-color: #fff; color: #fff; pointer-events: none; animation: drop .2s ease-out; }
.pin.pulse { animation: pulse 1s ease-out 3; }
/* The hover outline around a marker's element or region */
.ring { position: fixed; z-index: 2147483593; pointer-events: none; border-radius: 8px; border: 2px solid var(--c, var(--accent));
  background: color-mix(in srgb, var(--c, var(--accent)) 6%, transparent); animation: fade .12s ease-out; }

/* Cards */
.card { position: fixed; z-index: 2147483603; width: 340px; max-width: calc(100vw - 24px); background: var(--bg);
  border-radius: 14px; box-shadow: var(--shadow); animation: pop .14s ease-out; outline: none; }
.card.sheet { left: 0 !important; right: 0; bottom: 0; top: auto !important; width: 100%; max-width: none;
  border-radius: 18px 18px 0 0; padding-bottom: env(safe-area-inset-bottom); animation: up .2s ease-out; }
.card.preview { width: 280px; padding: 12px 14px; display: grid; gap: 6px; pointer-events: none; z-index: 2147483604; }
.card.preview .when { margin-left: auto; }
.composer { width: 304px; padding: 14px; display: grid; gap: 10px; }
.composer .hintl { justify-self: end; margin-top: -4px; }
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
.kinds { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.kinds button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 36px; padding: 0 10px; border-radius: 999px;
  border: 1px solid var(--line); font-size: 13px; font-weight: 500; color: var(--muted); transition: background .12s, border-color .12s, color .12s; }
.kinds button svg { width: 14px; height: 14px; }
.kinds button:hover { background: var(--soft); color: var(--fg); }
.kinds button[aria-checked=true] { border-color: var(--k); color: var(--k); background: color-mix(in srgb, var(--k) 10%, transparent); font-weight: 600; }
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

/* Branding (wave-3 §2): dialogs may use their own accent; the text colour on it is picked for contrast. */
.card, .modal, .panel { --accent: var(--pinwren-dialog-accent, var(--pinwren-accent, #d63a1c)); --accent-fg: var(--pinwren-dialog-accent-fg, #fff); }


/* Comment on selection: highlighted quote on the page, the offer chip, the quote in cards */
.hl { position: fixed; z-index: 2147483592; pointer-events: none; border-radius: 2px;
  background: color-mix(in srgb, var(--accent) 20%, transparent); box-shadow: inset 0 -2px 0 var(--accent); }
.hl.hot, .hl.draft { background: color-mix(in srgb, var(--accent) 34%, transparent); }
.hl.moved { box-shadow: inset 0 -2px 0 var(--warn); background: color-mix(in srgb, var(--warn) 18%, transparent); }
.selbtn { position: fixed; z-index: 2147483603; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px 0 10px;
  border-radius: 999px; background: var(--fg); color: var(--bg); font-size: 12.5px; font-weight: 600; box-shadow: var(--shadow);
  animation: pop .14s ease-out; white-space: nowrap; }
.selbtn svg { width: 15px; height: 15px; }
.selbtn:hover { filter: brightness(1.15); }
.quote { margin: 0; padding: 6px 10px; border-left: 3px solid var(--accent); border-radius: 0 8px 8px 0; background: var(--soft);
  color: var(--muted); font-size: 12.5px; font-style: italic; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical;
  -webkit-line-clamp: 3; overflow: hidden; }

/* Segmented controls (panel filters, capture modes, severity) */
.seg { display: flex; padding: 2px; border-radius: 10px; background: var(--soft); }
.seg button { flex: 1; height: 28px; border-radius: 8px; font-size: 12px; font-weight: 600; color: var(--muted); }
.seg button[aria-pressed=true] { background: var(--bg); color: var(--fg); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
.launcher.queued::before { content: ""; position: absolute; bottom: 1px; right: 1px; width: 12px; height: 12px; border-radius: 999px;
  background: var(--warn); box-shadow: 0 0 0 2px var(--bg); }

.toast { position: fixed; z-index: 2147483605; left: 50%; bottom: 24px; translate: -50% 0; padding: 10px 16px;
  border-radius: 12px; background: var(--fg); color: var(--bg); box-shadow: var(--shadow); font-size: 13px; font-weight: 500; animation: pop .14s ease-out; }

@keyframes pop { from { opacity: 0; transform: translateY(4px) scale(.98); } }
@keyframes up { from { transform: translateY(100%); } }
@keyframes slide { from { transform: translateX(100%); } }
@keyframes fade { from { opacity: 0; } }
@keyframes rise { from { opacity: 0; transform: translateY(8px) scale(.9); } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes drop { from { opacity: 0; transform: translateY(-6px) scale(.8); } }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--c, var(--accent)) 60%, transparent); } 100% { box-shadow: 0 0 0 18px transparent; } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;
