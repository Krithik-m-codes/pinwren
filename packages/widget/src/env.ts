import type { WidgetFeedbackCreate } from "@pinwren/core";

export function uuid(): string {
  return (
    // randomUUID only exists in secure contexts (https://, localhost) and Safari 15.4+.
    ("randomUUID" in crypto ? crypto.randomUUID() : undefined) ??
    "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (Number(c) ^ ((crypto.getRandomValues(new Uint8Array(1))[0] ?? 0) & (15 >> (Number(c) / 4)))).toString(
        16,
      ),
    )
  );
}

/**
 * Browser details sent with feedback. In privacy mode (wave-3 §3) the user agent is reduced to the browser and
 * OS families — no versions, no device model, nothing that narrows down who the visitor is.
 */
export function environment(privacy = false, ua = navigator.userAgent): WidgetFeedbackCreate["environment"] {
  const browser =
    /Edg\/(\d+)/.exec(ua)?.[0]?.replace("Edg/", "Edge ") ??
    /Chrome\/(\d+)/.exec(ua)?.[0]?.replace("/", " ") ??
    /Firefox\/(\d+)/.exec(ua)?.[0]?.replace("/", " ") ??
    (/Version\/(\d+).*Safari/.exec(ua)?.[1] ? `Safari ${/Version\/(\d+)/.exec(ua)?.[1] ?? ""}` : undefined);
  const os = ua.includes("Windows")
    ? "Windows"
    : ua.includes("Android")
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : ua.includes("Mac OS X")
          ? "macOS"
          : ua.includes("Linux")
            ? "Linux"
            : undefined;
  if (privacy) {
    const family = browser?.replace(/ \d+$/, "");
    return {
      userAgent: [family ?? "Unknown browser", os ?? "unknown OS"].join(" on "),
      browser: family,
      os,
      viewport: { w: innerWidth, h: innerHeight },
      dpr: Math.min(8, Math.max(0.5, devicePixelRatio || 1)),
      locale: navigator.language,
    };
  }
  return {
    userAgent: ua.slice(0, 500),
    browser,
    os,
    viewport: { w: innerWidth, h: innerHeight },
    dpr: Math.min(8, Math.max(0.5, devicePixelRatio || 1)),
    locale: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    referrer: document.referrer || undefined,
  };
}

export const errText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);
