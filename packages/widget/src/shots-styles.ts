// "Add screenshot" menu, region selection, attachment thumbnails, lightbox and annotate dialog CSS
// (widget-shots.js) — injected into the widget's shadow root when the chunk loads. The annotate dialog reuses
// the report modal's toolbar and canvas styles (report-styles.ts), which are always present with it.
export const SHOTS_CSS = /* css */ `
.sh-add { gap: 7px; }
.sh-add svg { width: 14px; height: 14px; }
.sh-add[aria-expanded=true] svg:last-child { rotate: 180deg; }
.sh-add:disabled { opacity: .5; }
.sh-menu { position: fixed; z-index: 2147483640; min-width: 220px; padding: 4px; border-radius: 12px; background: var(--bg); color: var(--fg);
  box-shadow: var(--shadow), 0 0 0 1px var(--line); display: grid; gap: 1px; animation: fade .1s; }
.sh-menu button { display: flex; align-items: center; gap: 9px; padding: 0 10px; height: 32px; border-radius: 8px; font-size: 13px; text-align: left; }
.sh-menu button:hover, .sh-menu button:focus-visible { background: var(--soft); outline: none; }
.sh-menu svg { width: 15px; height: 15px; color: var(--muted); flex: none; }
.sh-menu hr { all: unset; height: 1px; margin: 3px 6px; background: var(--line); }
.sh-shield { position: fixed; inset: 0; z-index: 2147483640; cursor: crosshair; touch-action: none; background: rgba(9,9,11,.35); overflow: hidden; }
.sh-shield.drag { background: none; }
.sh-sel { position: fixed; border: 2px solid #fff; outline: 1px solid rgba(0,0,0,.5); border-radius: 2px; box-shadow: 0 0 0 100vmax rgba(9,9,11,.5); pointer-events: none; }
.sh-hint { position: fixed; z-index: 2147483641; top: 14px; left: 50%; translate: -50% 0; padding: 7px 14px; border-radius: 999px; font-size: 12.5px; font-weight: 500;
  background: #18181b; color: #fafafa; box-shadow: var(--shadow); pointer-events: none; max-width: calc(100vw - 24px); }
.sh-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 8px; }
.sh-card { position: relative; display: grid; gap: 5px; min-width: 0; }
.sh-thumb { position: relative; display: block; width: 100%; aspect-ratio: 16 / 10; padding: 0; overflow: hidden; border-radius: 10px;
  background: var(--soft); box-shadow: inset 0 0 0 1px var(--line); cursor: zoom-in; }
.sh-thumb:disabled, .sh-thumb.pdf { cursor: default; }
.sh-thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top center; opacity: 0; transition: opacity .18s; }
.sh-card.tall .sh-thumb img { object-fit: contain; object-position: center; }
.sh-card.loaded .sh-thumb img { opacity: 1; }
.sh-skel { position: absolute; inset: 0; background: linear-gradient(100deg, transparent 30%, color-mix(in srgb, var(--fg) 8%, transparent) 50%, transparent 70%) 0 0 / 200% 100%; animation: sh-shim 1.2s linear infinite; }
.sh-card.loaded .sh-skel, .sh-card.failed .sh-skel { display: none; }
@keyframes sh-shim { to { background-position: -200% 0; } }
.sh-ph { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 4px; padding: 6px; text-align: center; color: var(--muted); font-size: 11px; line-height: 1.3; }
.sh-ph svg { width: 22px; height: 22px; }
.sh-ph.err { color: var(--danger); }
.sh-thumb:focus-visible, .sh-ib:focus-visible, .sh-lb button:focus-visible, .sh-stage:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.sh-acts { position: absolute; top: 5px; right: 5px; display: flex; gap: 4px; }
.sh-ib { width: 26px; height: 26px; border-radius: 999px; display: grid; place-items: center; background: rgba(9,9,11,.66); color: #fff; backdrop-filter: blur(4px); }
.sh-ib:hover { background: rgba(9,9,11,.88); }
.sh-ib svg { width: 13px; height: 13px; }
@media (hover: hover) { .sh-acts { opacity: 0; transition: opacity .12s; } .sh-card:hover .sh-acts, .sh-card:focus-within .sh-acts { opacity: 1; } }
.sh-meta { display: grid; min-width: 0; padding: 0 2px; font-size: 12px; }
.sh-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.sh-meta small { color: var(--muted); font-size: 11px; }
.sh-lb { position: fixed; inset: 0; z-index: 2147483645; display: grid; grid-template-rows: auto minmax(0,1fr); background: rgba(9,9,11,.96); color: #fafafa; animation: fade .12s; }
.sh-bar { display: flex; align-items: center; gap: 4px; padding: 8px 10px; flex-wrap: wrap; }
.sh-title { display: grid; min-width: 0; flex: 1; padding: 0 6px; font-size: 13px; font-weight: 600; }
.sh-title span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sh-title small { color: #a1a1aa; font-size: 11.5px; font-weight: 400; }
.sh-lb .sh-ib { width: 32px; height: 32px; background: transparent; backdrop-filter: none; }
.sh-lb .sh-ib:hover:not(:disabled) { background: rgba(255,255,255,.12); }
.sh-lb .sh-ib:disabled { opacity: .35; }
.sh-lb .sh-ib svg { width: 16px; height: 16px; }
.sh-zoom { min-width: 44px; text-align: center; font-size: 12px; font-variant-numeric: tabular-nums; color: #d4d4d8; }
.sh-stage { position: relative; overflow: hidden; touch-action: none; user-select: none; cursor: default; min-height: 0; }
.sh-stage.pan { cursor: grab; } .sh-stage.panning { cursor: grabbing; }
.sh-stage img { position: absolute; left: 0; top: 0; max-width: none; transform-origin: 0 0; user-select: none; -webkit-user-drag: none; will-change: transform; image-rendering: auto; }
.sh-stage .sh-ph { color: #d4d4d8; font-size: 13px; }
.sh-stage .spin { position: absolute; inset: 0; margin: auto; }
.sh-nav { position: absolute; top: 50%; translate: 0 -50%; width: 40px; height: 40px; background: rgba(9,9,11,.6); z-index: 1; }
.sh-nav.prev { left: 12px; } .sh-nav.next { right: 12px; }
.sh-ann .editor { grid-template-rows: auto minmax(0,1fr); }
.sh-ann .toolbar .btn { height: 30px; }
@media (prefers-reduced-motion: reduce) { .sh-skel, .sh-lb, .sh-menu { animation: none; } .sh-card .sh-thumb img { transition: none; } }
`;
