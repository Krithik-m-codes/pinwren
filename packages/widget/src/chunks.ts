// Lazy parts of the widget (blueprint 05 §1–§2, wave-4 §7). Each is its own script next to widget.js and
// registers itself on a window global when it runs; the core loads it on first use (or on a hint of intent,
// like opening the menu) so the page never pays for UI the visitor doesn't open.
//
//   widget-panel.<hash>.js     side panel + thread card + export
//   widget-report.<hash>.js    bug report form, drafts, attachments
//   widget-editor.<hash>.js    screenshot annotation editor
//   widget-capture.<hash>.js   SnapDOM (screenshot engine)
//   widget-replay.<hash>.js    rrweb recorder (session replay)
//   widget-flows.<hash>.js     composer attachments, re-pin mode (wave 5)
//   widget-i18n-<code>.<hash>.js
//
// File names are content-hashed so CDNs can cache them forever; build.mjs inlines the name map into
// widget.js as `__PINWREN_MANIFEST__` (widget.js itself stays un-hashed with a short cache). Without a
// manifest (unit tests, an older build) the plain `widget-<name>.js` is requested.
//
// Chunks don't bundle their own copies of the shared modules (i18n state, diagnostics buffers, DOM helpers):
// build.mjs points those imports at `window.__pinwrenLib`, which index.ts fills from lib.ts.

declare const __PINWREN_MANIFEST__: Record<string, string> | undefined;

export type ChunkName = "capture" | "editor" | "report" | "panel" | "replay" | "flows";

const GLOBALS: Record<ChunkName, string> = {
  capture: "__pinwrenCapture",
  editor: "__pinwrenEditor",
  report: "__pinwrenReport",
  panel: "__pinwrenPanel",
  replay: "__pinwrenReplay",
  flows: "__pinwrenFlows",
};

const MANIFEST: Record<string, string> = typeof __PINWREN_MANIFEST__ === "object" ? __PINWREN_MANIFEST__ : {};

/** URL of a chunk (`panel`, `i18n-fr`, …) under `base`, the directory widget.js was served from. */
export function chunkUrl(base: string, name: string): string {
  const file = MANIFEST[name];
  // Only names the build produced reach the page: no path tricks via the manifest.
  return `${base}/${file && /^widget-[\w-]+\.[\w-]+\.js$/.test(file) ? file : `widget-${name}.js`}`;
}

let nonce = "";
/** CSP nonce (`data-nonce`) for the chunk and locale scripts the widget adds. */
export function setNonce(value: string | undefined) {
  nonce = value ?? "";
}

/** A `<script>` for one of our files, carrying the page's CSP nonce when it gave one. */
export function script(src: string): HTMLScriptElement {
  const s = document.createElement("script");
  s.src = src;
  s.async = true;
  if (nonce) s.nonce = nonce;
  return s;
}

const pending = new Map<ChunkName, Promise<unknown>>();

export function loadChunk<T>(base: string, name: ChunkName): Promise<T> {
  const w = window as unknown as Record<string, unknown>;
  const ready = w[GLOBALS[name]];
  if (ready) return Promise.resolve(ready as T);
  let p = pending.get(name);
  if (!p) {
    const src = chunkUrl(base, name);
    p = new Promise((resolve, reject) => {
      const s = script(src);
      s.onload = () => {
        s.remove();
        const m = w[GLOBALS[name]];
        if (m) resolve(m);
        else reject(new Error(`${src} did not register`));
      };
      s.onerror = () => {
        s.remove();
        reject(new Error(`Couldn't load ${src}`));
      };
      document.head.append(s);
    }).catch((err: unknown) => {
      pending.delete(name); // allow a retry next time
      throw err;
    });
    pending.set(name, p);
  }
  return p as Promise<T>;
}

/** Start fetching a chunk the visitor is likely to need next; failures are silent (the real load reports). */
export function preload(base: string, name: ChunkName) {
  loadChunk(base, name).catch(() => {
    // Preloading is opportunistic; the real load reports its own failure.
  });
}
