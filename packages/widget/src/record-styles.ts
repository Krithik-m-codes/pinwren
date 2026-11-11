// "Record screen" CSS (widget-record.js) — injected into the widget's shadow root when the chunk loads. The
// controls window (Document Picture-in-Picture) is a separate document without the widget's custom
// properties, so it carries its own small stylesheet.
export const RECORD_CSS = /* css */ `
.rc-btns { display: flex; flex-wrap: wrap; gap: 6px; }
.rc-add { gap: 7px; }
.rc-add:disabled { opacity: .5; }
.rc-row { display: flex; align-items: center; gap: 8px; margin-top: 6px; padding: 6px; border-radius: 10px; background: var(--soft); font-size: 12.5px; min-width: 0; }
.rc-row[hidden] { display: none; }
.rc-row small { display: block; color: var(--muted); font-size: 11px; }
.rc-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.rc-ib { flex: none; width: 28px; height: 28px; border-radius: 999px; display: grid; place-items: center; color: var(--fg); }
.rc-ib:hover { background: var(--line); }
.rc-ib:focus-visible, .rc-sw:focus-visible, .rc-video:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.rc-ib svg { width: 14px; height: 14px; }
.rc-scrim { position: fixed; inset: 0; z-index: 2147483646; display: grid; place-items: center; padding: 16px; background: rgba(9,9,11,.55); visibility: visible; animation: fade .12s; }
.rc-count { align-content: center; justify-items: center; gap: 10px; color: #fafafa; text-align: center; }
.rc-num { font-size: 96px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; text-shadow: 0 2px 24px rgba(0,0,0,.5); }
.rc-live { font-size: 15px; font-weight: 600; }
.rc-hint { max-width: 420px; font-size: 13px; color: #d4d4d8; }
.rc-hint:empty { display: none; }
.rc-dialog { display: grid; gap: 12px; width: min(480px, 100%); max-height: calc(100vh - 32px); overflow: auto; padding: 20px; border-radius: 16px; background: var(--bg); color: var(--fg); box-shadow: var(--shadow), 0 0 0 1px var(--line); font-size: 13px; line-height: 1.5; }
.rc-dialog h2 { margin: 0; font-size: 16px; font-weight: 650; }
.rc-dialog p { margin: 0; }
.rc-points { margin: 0; padding-left: 18px; color: var(--muted); display: grid; gap: 3px; }
.rc-mic { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; background: var(--soft); }
.rc-mic > svg, .rc-mic > span:first-child svg { width: 16px; height: 16px; flex: none; }
.rc-mic small { display: block; color: var(--muted); font-size: 11.5px; }
.rc-sw { all: unset; box-sizing: border-box; flex: none; width: 34px; height: 20px; border-radius: 999px; background: var(--line); position: relative; cursor: pointer; transition: background .15s; }
.rc-sw::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgb(0 0 0 / .25); transition: transform .15s; }
.rc-sw[aria-checked=true] { background: var(--ok); }
.rc-sw[aria-checked=true]::after { transform: translateX(14px); }
.rc-err { color: var(--danger); font-size: 12.5px; }
.rc-err:empty { display: none; }
.rc-note { padding: 8px 10px; border-radius: 8px; background: var(--soft); font-size: 12.5px; }
.rc-info { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.rc-video { width: 100%; max-height: 50vh; border-radius: 10px; background: #000; }
.rc-foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.rc-zone { position: fixed; left: 0; bottom: 0; z-index: 2147483646; width: 56px; height: 56px; overflow: hidden; visibility: visible; }
.rc-zone:hover, .rc-zone:focus-within { width: auto; height: auto; padding: 10px; overflow: visible; }
.rc-bar { display: inline-flex; align-items: center; gap: 8px; padding: 6px 8px 6px 12px; border-radius: 999px; background: #18181b; color: #fafafa; font-size: 12.5px; box-shadow: var(--shadow); opacity: 0; }
.rc-zone:hover .rc-bar, .rc-zone:focus-within .rc-bar { opacity: 1; }
.rc-bar .rc-ib { color: #fafafa; }
.rc-bar .rc-ib:hover { background: rgba(255,255,255,.14); }
.rc-bar .stop { background: #dc2626; }
.rc-bar .stop:hover { background: #ef4444; }
.rc-dot { width: 9px; height: 9px; border-radius: 50%; background: #ef4444; animation: rc-pulse 1.4s ease-in-out infinite; }
.rc-bar.paused .rc-dot { animation: none; background: #a1a1aa; }
.rc-time { font-variant-numeric: tabular-nums; color: #d4d4d8; }
@keyframes rc-pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .rc-dot { animation: none; } .rc-scrim { animation: none; } }
`;

export const PIP_CSS = /* css */ `
html, body { margin: 0; height: 100%; background: #18181b; color: #fafafa; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
.rc-bar { display: flex; align-items: center; gap: 10px; height: 100%; padding: 0 14px; box-sizing: border-box; }
.rc-dot { width: 10px; height: 10px; border-radius: 50%; background: #ef4444; flex: none; animation: p 1.4s ease-in-out infinite; }
.rc-bar.paused .rc-dot { animation: none; background: #a1a1aa; }
.rc-state { font-weight: 600; }
.rc-time { flex: 1; text-align: right; font-variant-numeric: tabular-nums; color: #d4d4d8; }
.rc-ib { all: unset; box-sizing: border-box; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; cursor: pointer; color: #fafafa; flex: none; }
.rc-ib:hover { background: rgba(255,255,255,.14); }
.rc-ib:focus-visible { outline: 2px solid #fafafa; outline-offset: 2px; }
.rc-ib svg { width: 16px; height: 16px; }
.stop { background: #dc2626; }
.stop:hover { background: #ef4444; }
@keyframes p { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .rc-dot { animation: none; } }
`;
