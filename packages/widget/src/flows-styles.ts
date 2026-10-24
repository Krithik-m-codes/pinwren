// Styles of the lazy widget-flows.js chunk (composer attachments, re-pin banner). Minified by build.mjs.
export const FLOWS_CSS = /* css */ `
.cfiles { display: flex; flex-wrap: wrap; gap: 6px; margin: 2px 0 0; }
.cfiles:empty { display: none; }
.cfile { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 2px 4px 2px 8px;
  border: 1px solid var(--pw-line, #e4e4e7); border-radius: 999px; font-size: 12px; background: var(--pw-soft, #f4f4f5); }
.cfile span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px; }
.cfile button { display: grid; place-items: center; width: 20px; height: 20px; border: 0; border-radius: 50%;
  background: transparent; color: inherit; cursor: pointer; padding: 0; }
.cfile button:hover { background: rgba(0, 0, 0, 0.08); }
.cfile button:focus-visible { outline: 2px solid var(--pinwren-accent, #5b5bd6); outline-offset: 1px; }
.cfile svg, .repin svg { width: 14px; height: 14px; }
.repin { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
  display: flex; align-items: center; gap: 10px; max-width: calc(100vw - 24px); padding: 8px 8px 8px 14px;
  border-radius: 10px; background: #18181b; color: #fff; font: 500 13px/1.4 system-ui, sans-serif;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25); }
.repin button { border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 7px; background: transparent;
  color: inherit; font: inherit; padding: 4px 10px; cursor: pointer; }
.repin button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
`;
