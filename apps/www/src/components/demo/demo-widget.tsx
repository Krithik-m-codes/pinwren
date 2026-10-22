"use client";

import { useEffect } from "react";

// Starts the real widget (built from packages/widget and served from /demo-api/) against the in-memory demo
// API, with a project key that is this visitor's sandbox. The key lives in a cookie so /demo/inbox can show
// the same sandbox; the widget itself never sends cookies.

export const DEMO_COOKIE = "pinwren_demo";
const SCRIPT_ID = "pinwren-demo-widget";

type PinwrenGlobal = {
  init?: (o: { projectKey: string; endpoint: string; forceShow?: boolean }) => void;
  destroy?: () => void;
};

export function demoKey(): string {
  const found = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${DEMO_COOKIE}=`));
  const existing = found ? decodeURIComponent(found.slice(DEMO_COOKIE.length + 1)) : "";
  if (/^pk_demo_[A-Za-z0-9_-]{16,40}$/.test(existing)) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const id = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const key = `pk_demo_${id}`;
  document.cookie = `${DEMO_COOKIE}=${encodeURIComponent(key)}; path=/; max-age=${6 * 60 * 60}; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
  return key;
}

export function DemoWidget() {
  useEffect(() => {
    const opts = { projectKey: demoKey(), endpoint: `${location.origin}/demo-api`, forceShow: true };
    const w = window as unknown as { Pinwren?: PinwrenGlobal & { q?: unknown[] } };
    if (typeof w.Pinwren?.init === "function") {
      // Loaded on an earlier visit to this page in the same session (client-side navigation).
      w.Pinwren.init(opts);
    } else {
      // Queue the call; widget.js replays `Pinwren.q` when it runs (blueprint 05 §8).
      w.Pinwren = { q: [["init", opts]] };
      if (!document.getElementById(SCRIPT_ID)) {
        const s = document.createElement("script");
        s.id = SCRIPT_ID;
        s.src = "/demo-api/widget.js";
        s.async = true;
        document.body.append(s);
      }
    }
    // Leaving the demo page (e.g. for the inbox) takes the widget down completely — or, if it hasn't loaded
    // yet, cancels the queued start.
    return () => {
      if (typeof w.Pinwren?.destroy === "function") w.Pinwren.destroy();
      else if (w.Pinwren?.q) w.Pinwren.q.length = 0;
    };
  }, []);
  return null;
}
