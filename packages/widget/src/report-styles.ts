// Bug report modal CSS (widget-report.js) — injected into the widget's shadow root when the chunk loads (see dom.ts adoptStyle).
export const REPORT_CSS = /* css */ `
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
.side-logo { height: 32px; max-width: 120px; object-fit: contain; flex: none; border-radius: 6px; }
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
.summary .sw { all: unset; box-sizing: border-box; flex: none; width: 28px; height: 16px; border-radius: 999px; background: var(--line); position: relative; cursor: pointer; transition: background .15s; }
.summary .sw::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgb(0 0 0 / .25); transition: transform .15s; }
.summary .sw[aria-checked=true] { background: var(--ok); }
.summary .sw[aria-checked=true]::after { transform: translateX(12px); }
.summary .sw:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.card.ask { position: static; width: 380px; padding: 20px; display: grid; gap: 8px; }
.ask-ico { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); }
.ask-title { font-size: 15px; }
.ask .foot { margin-top: 8px; }
@media (max-width: 760px) {
  .editor { height: 100%; grid-template-rows: auto auto; overflow: auto; }
  .stage { grid-template-columns: 1fr; }
  .ed canvas { max-height: 42vh; }
  .side { overflow: visible; }
}
`;
