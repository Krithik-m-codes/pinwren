// Custom questions CSS (widget-fields.js) — injected into the widget's shadow root when the chunk loads.
export const FIELDS_CSS = /* css */ `
.cf { display: grid; gap: 12px; margin: 0; padding: 0; border: 0; min-width: 0; }
.cf > legend { font-size: 12px; font-weight: 600; color: var(--muted); padding: 0; margin-bottom: 8px; }
.cf-q { display: grid; gap: 5px; margin: 0; padding: 0; border: 0; min-width: 0; }
.cf-q > legend, .cf-q > label.cf-l { font-size: 12.5px; font-weight: 600; color: var(--fg); padding: 0; }
.cf-q i { color: var(--danger); font-style: normal; margin-left: 2px; }
.cf-q small { color: var(--muted); font-size: 11.5px; line-height: 1.35; }
.cf-q select { width: 100%; font: inherit; color: var(--fg); background: var(--soft); border: 1px solid transparent; border-radius: 8px; padding: 8px 10px; }
.cf-q select:focus { border-color: var(--accent); background: var(--bg); outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
.cf-q [aria-invalid=true] { border-color: var(--danger); }
.cf-q small.cf-e { color: var(--danger); font-weight: 500; }
.cf-c { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; line-height: 1.35; }
.cf-c input { width: 16px; height: 16px; margin: 1px 0 0; flex: none; accent-color: var(--accent); }
.cf-g { display: grid; gap: 6px; }
`;
