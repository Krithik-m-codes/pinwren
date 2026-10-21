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

/* Side panel */
.panel { position: fixed; top: 0; right: 0; bottom: 0; z-index: 2147483602; width: 360px; max-width: 100vw; background: var(--bg);
  box-shadow: var(--shadow); display: flex; flex-direction: column; animation: slide .18s ease-out; }
.phead { display: flex; align-items: center; gap: 8px; padding: 14px 12px 10px 16px; font-size: 15px; }
.ptools { display: grid; gap: 8px; padding: 0 12px 10px; border-bottom: 1px solid var(--line); }
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
.xwrap { position: relative; }
.xmenu { position: absolute; right: 0; top: calc(100% + 6px); z-index: 1; width: 200px; padding: 4px; border-radius: 12px; background: var(--bg);
  box-shadow: var(--shadow); animation: pop .12s ease-out; }
.xmenu button { display: flex; align-items: center; gap: 8px; width: 100%; height: 32px; padding: 0 10px; border-radius: 8px; font-size: 13px; text-align: left; }
.xmenu button:hover, .xmenu button:focus-visible { background: var(--soft); outline: none; }
.xmenu svg { color: var(--muted); }
@media (max-width: 639px) { .panel { width: 100vw; } }
`;
