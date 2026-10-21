// Lazy parts of the widget (blueprint 05 §1–§2). Each is its own script next to widget.js and registers
// itself on a window global when it runs; the core loads it on first use (or on a hint of intent, like
// opening the menu) so the page never pays for UI the visitor doesn't open.
//
//   widget-panel.js    side panel + export
//   widget-report.js   bug report form, drafts, attachments
//   widget-capture.js  SnapDOM + annotation editor
//
// Chunks don't bundle their own copies of the shared modules (i18n state, diagnostics buffers, DOM helpers):
// build.mjs points those imports at `window.__pinwrenLib`, which index.ts fills from lib.ts.

export type ChunkName = "capture" | "report" | "panel";

const GLOBALS: Record<ChunkName, string> = {
  capture: "__pinwrenCapture",
  report: "__pinwrenReport",
  panel: "__pinwrenPanel",
};

const pending = new Map<ChunkName, Promise<unknown>>();

export function loadChunk<T>(endpoint: string, name: ChunkName): Promise<T> {
  const w = window as unknown as Record<string, unknown>;
  const ready = w[GLOBALS[name]];
  if (ready) return Promise.resolve(ready as T);
  let p = pending.get(name);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `${endpoint}/widget-${name}.js`;
      s.async = true;
      s.onload = () => {
        s.remove();
        const m = w[GLOBALS[name]];
        if (m) resolve(m);
        else reject(new Error(`widget-${name}.js did not register`));
      };
      s.onerror = () => {
        s.remove();
        reject(new Error(`Couldn't load widget-${name}.js`));
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
export function preload(endpoint: string, name: ChunkName) {
  loadChunk(endpoint, name).catch(() => {
    // Preloading is opportunistic; the real load reports its own failure.
  });
}
