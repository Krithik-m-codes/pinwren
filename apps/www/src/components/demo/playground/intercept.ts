import type { DemoConfig } from "@/lib/demo/config";
import { handleLocal } from "./local-api";
import { type PlaygroundSettings, withPlayground } from "./settings";

// The playground sits between the widget and its API with a fetch wrapper, installed before widget.js
// runs (the widget's own diagnostics wrapper then wraps this one):
// - Server mode: requests go to the demo API; `/w/config` comes back with the playground's switches applied.
// - Local mode: the widget's endpoint is `<origin>/demo-local`, which never reaches the network — every
//   `/w/*` call is answered from IndexedDB (local-api.ts).

export const LOCAL_BASE = "/demo-local";
export const SERVER_BASE = "/demo-api";

export type Interception = { settings: () => PlaygroundSettings };

export function interceptWidgetFetch(ctx: Interception): () => void {
  // Restored as it was (same function object), so code that kept a reference still matches.
  const before = Object.getOwnPropertyDescriptor(window, "fetch");
  const original = window.fetch.bind(window);
  const wrapped: typeof fetch = async (input, init) => {
    // Read the URL without building a Request: that would consume a streamed body meant for the page.
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin) return original(input, init);
    const s = ctx.settings();
    if (url.pathname.startsWith(`${LOCAL_BASE}/w/`)) {
      return handleLocal(new Request(input, init), `${location.origin}${LOCAL_BASE}`, s);
    }
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (url.pathname === `${SERVER_BASE}/w/config` && method === "GET") {
      const res = await original(input, init);
      if (!res.ok) return res;
      const cfg = (await res.json()) as DemoConfig;
      return new Response(JSON.stringify(withPlayground(cfg, s)), {
        status: res.status,
        headers: { "content-type": "application/json" },
      });
    }
    return original(input, init);
  };
  window.fetch = wrapped;
  return () => {
    // Only undo our own wrapper; anything wrapped on top of it (the widget's diagnostics) restores itself.
    if (window.fetch === wrapped && before) Object.defineProperty(window, "fetch", before);
  };
}
