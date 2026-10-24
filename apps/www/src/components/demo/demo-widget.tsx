"use client";

import { useEffect, useRef } from "react";
import { interceptWidgetFetch, LOCAL_BASE, SERVER_BASE } from "@/components/demo/playground/intercept";
import { DEMO_IDENTITY, type PlaygroundSettings } from "@/components/demo/playground/settings";

// Starts the real widget (built from packages/widget and served from /demo-api/) on the sample page, with a
// project key that is this visitor's sandbox. The key lives in a cookie so /demo/inbox can show the same
// sandbox; the widget itself never sends cookies. Every playground change takes the widget down and starts
// it again with the new options, as a host page would after changing its embed.

export const DEMO_COOKIE = "pinwren_demo";
const SCRIPT_ID = "pinwren-demo-widget";

type InitOptions = {
  projectKey: string;
  endpoint: string;
  forceShow: boolean;
  accent: string;
  locale: string;
  theme: PlaygroundSettings["theme"];
};
type PinwrenGlobal = {
  init?: (o: InitOptions) => void;
  identify?: (user: typeof DEMO_IDENTITY | null) => void;
  destroy?: () => void;
  q?: unknown[][];
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

const win = () => window as unknown as { Pinwren?: PinwrenGlobal };

/** (Re)start the widget with the playground's options; queued if widget.js hasn't run yet. */
function start(s: PlaygroundSettings) {
  const opts: InitOptions = {
    projectKey: demoKey(),
    endpoint: `${location.origin}${s.mode === "local" ? LOCAL_BASE : SERVER_BASE}`,
    forceShow: true,
    accent: s.accent,
    locale: s.locale,
    theme: s.theme,
  };
  const identity = s.identity ? DEMO_IDENTITY : null;
  const w = win();
  if (typeof w.Pinwren?.init === "function") {
    w.Pinwren.destroy?.();
    w.Pinwren.identify?.(identity);
    w.Pinwren.init(opts);
    return;
  }
  // Queue the calls; widget.js replays `Pinwren.q` when it runs (blueprint 05 §8).
  w.Pinwren = {
    q: [
      ["identify", identity],
      ["init", opts],
    ],
  };
  if (!document.getElementById(SCRIPT_ID)) {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = `${SERVER_BASE}/widget.js`;
    script.async = true;
    document.body.append(script);
  }
}

export function DemoWidget({ settings }: { settings: PlaygroundSettings }) {
  const current = useRef(settings);

  // The fetch wrapper goes in before widget.js runs and comes out after the widget is down.
  useEffect(() => {
    const undo = interceptWidgetFetch({ settings: () => current.current });
    return () => {
      // Leaving the demo page (e.g. for the inbox) takes the widget down completely — or, if it hasn't
      // loaded yet, cancels the queued start.
      const w = win();
      if (typeof w.Pinwren?.destroy === "function") w.Pinwren.destroy();
      else if (w.Pinwren?.q) w.Pinwren.q.length = 0;
      undo();
    };
  }, []);

  useEffect(() => {
    current.current = settings;
    start(settings);
  }, [settings]);

  return null;
}
