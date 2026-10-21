// All widget CSS. It lives inside a closed shadow root, so nothing leaks in or out (blueprint 05 §3).
export const STYLES = /* css */ `
:host { all: initial; }
* { box-sizing: border-box; }
.root {
  --bg: #ffffff; --fg: #18181b; --muted: #71717a; --line: #e4e4e7; --soft: #f4f4f5;
  --accent: var(--annota-accent, #5b5bd6); --accent-fg: #fff; --danger: #e5484d;
  --shadow: 0 10px 30px -10px rgba(0,0,0,.35), 0 0 0 1px rgba(0,0,0,.06);
  font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--fg); -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  .root { --bg: #18181b; --fg: #fafafa; --muted: #a1a1aa; --line: #3f3f46; --soft: #27272a;
    --shadow: 0 10px 30px -10px rgba(0,0,0,.8), 0 0 0 1px rgba(255,255,255,.08); }
}
button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; }
button:focus-visible, textarea:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.fab { position: fixed; z-index: 2147483600; right: 20px; bottom: 20px; width: 48px; height: 48px;
  border-radius: 999px; background: var(--accent); color: var(--accent-fg); box-shadow: var(--shadow);
  display: grid; place-items: center; transition: transform .15s ease; }
.fab:hover { transform: scale(1.06); }
.fab svg { width: 22px; height: 22px; }
.fab .count { position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 999px; background: var(--fg); color: var(--bg); font-size: 11px; font-weight: 600;
  display: grid; place-items: center; }

.menu { position: fixed; z-index: 2147483601; right: 20px; bottom: 78px; width: 260px; padding: 6px;
  background: var(--bg); border-radius: 14px; box-shadow: var(--shadow); animation: pop .14s ease-out; }
.menu button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; border-radius: 9px; text-align: left; }
.menu button:hover { background: var(--soft); }
.menu .ico { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: var(--soft); flex: none; }
.menu .ico svg { width: 16px; height: 16px; }
.menu small { display: block; color: var(--muted); font-size: 12px; }
.menu .sep { height: 1px; background: var(--line); margin: 6px 4px; }
.menu .foot { padding: 4px 10px 2px; color: var(--muted); font-size: 11px; }

.hint { position: fixed; z-index: 2147483602; left: 50%; top: 16px; transform: translateX(-50%);
  padding: 8px 14px; border-radius: 999px; background: var(--fg); color: var(--bg); font-size: 13px;
  box-shadow: var(--shadow); display: flex; gap: 10px; align-items: center; }
.hint kbd { font: 11px ui-monospace, monospace; padding: 1px 5px; border-radius: 4px; background: rgba(127,127,127,.3); }

.outline { position: fixed; z-index: 2147483590; pointer-events: none; border: 2px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent); border-radius: 4px; transition: all .06s ease-out; }
.outline span { position: absolute; left: -2px; top: -22px; padding: 1px 6px; border-radius: 4px; background: var(--accent);
  color: var(--accent-fg); font: 11px ui-monospace, monospace; white-space: nowrap; }

.pin { position: fixed; z-index: 2147483595; width: 28px; height: 28px; margin: -28px 0 0 0;
  border-radius: 999px 999px 999px 4px; background: var(--accent); color: var(--accent-fg);
  font-size: 12px; font-weight: 700; display: grid; place-items: center; box-shadow: var(--shadow);
  transition: transform .12s ease; }
.pin:hover, .pin.active { transform: scale(1.12); }
.pin.resolved { background: #30a46c; }
.pin.moved { outline: 2px dashed #f5a524; outline-offset: 2px; }
.pin.pulse { animation: pulse 1.2s ease-out 2; }

.card { position: fixed; z-index: 2147483603; width: 320px; max-width: calc(100vw - 24px); background: var(--bg);
  border-radius: 14px; box-shadow: var(--shadow); animation: pop .14s ease-out; overflow: hidden; }
.card header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--line); font-weight: 600; font-size: 13px; }
.card header .x { margin-left: auto; color: var(--muted); padding: 2px 6px; border-radius: 6px; }
.card header .x:hover { background: var(--soft); }
.card .body { padding: 12px; display: grid; gap: 10px; max-height: 50vh; overflow: auto; }
textarea, input { width: 100%; font: inherit; color: var(--fg); background: var(--soft); border: 1px solid var(--line);
  border-radius: 9px; padding: 8px 10px; resize: vertical; }
textarea { min-height: 84px; }
.row { display: flex; gap: 8px; }
.kinds { display: flex; gap: 6px; flex-wrap: wrap; }
.kinds button { padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); font-size: 12px; }
.kinds button[aria-pressed=true] { background: var(--accent); color: var(--accent-fg); border-color: transparent; }
.actions { display: flex; justify-content: flex-end; gap: 8px; padding: 0 12px 12px; }
.btn { padding: 7px 14px; border-radius: 9px; font-weight: 600; font-size: 13px; }
.btn.primary { background: var(--accent); color: var(--accent-fg); }
.btn.primary:disabled { opacity: .5; cursor: default; }
.btn.ghost:hover { background: var(--soft); }
.msg { padding: 8px 10px; border-radius: 9px; background: var(--soft); }
.msg .who { font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.msg.team { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.muted { color: var(--muted); font-size: 12px; }
.err { color: var(--danger); font-size: 12px; }

.modal { position: fixed; inset: 0; z-index: 2147483604; background: rgba(9,9,11,.72); display: grid; place-items: center; padding: 16px; animation: fade .14s; }
.editor { width: min(1100px, 100%); max-height: 100%; display: grid; grid-template-rows: auto 1fr; gap: 10px; }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; background: var(--bg); border-radius: 12px; padding: 6px; box-shadow: var(--shadow); }
.toolbar button { padding: 6px 10px; border-radius: 8px; font-size: 13px; display: flex; gap: 6px; align-items: center; }
.toolbar button[aria-pressed=true] { background: var(--soft); box-shadow: inset 0 0 0 1px var(--line); }
.toolbar .swatch { width: 18px; height: 18px; border-radius: 999px; padding: 0; box-shadow: inset 0 0 0 2px rgba(255,255,255,.6); }
.toolbar .swatch[aria-pressed=true] { outline: 2px solid var(--fg); outline-offset: 1px; }
.toolbar .grow { flex: 1; }
.stage { display: grid; grid-template-columns: 1fr 300px; gap: 10px; min-height: 0; }
.canvas-wrap { position: relative; min-height: 0; overflow: auto; border-radius: 12px; background: #000; display: grid; place-items: center; }
.canvas-wrap canvas { max-width: 100%; max-height: calc(100vh - 140px); cursor: crosshair; touch-action: none; display: block; }
.side { background: var(--bg); border-radius: 12px; box-shadow: var(--shadow); display: grid; gap: 10px; padding: 12px; align-content: start; }
@media (max-width: 720px) { .stage { grid-template-columns: 1fr; } .canvas-wrap canvas { max-height: 45vh; } }

.toast { position: fixed; z-index: 2147483605; left: 50%; bottom: 24px; transform: translateX(-50%); padding: 10px 16px;
  border-radius: 12px; background: var(--fg); color: var(--bg); box-shadow: var(--shadow); font-size: 13px; animation: pop .14s ease-out; }

@keyframes pop { from { opacity: 0; transform: translateY(4px) scale(.98); } }
@keyframes fade { from { opacity: 0; } }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 60%, transparent); } 100% { box-shadow: 0 0 0 18px transparent; } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;
