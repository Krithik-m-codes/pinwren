// Link-outs to the monitoring tools a visitor's session was recorded in. The widget stores what it finds on
// the page in `metadata.observability` (and a site can set the same shape itself with
// `Pinwren.setMetadata({ observability })`). Everything here is untrusted visitor input: ids must be plain
// tokens, hosts plain hostnames, and a stored URL is used only if it is https without credentials. The result is
// a list of validated `https:` links — nothing from the metadata reaches an `href` any other way.

export type ObservabilityProvider = "sentry" | "posthog" | "logrocket" | "datadog";
export type ObservabilityLink = {
  provider: ObservabilityProvider;
  /** Which thing it opens; picks the chip's label. */
  kind: "event" | "replay" | "session";
  href: string;
};

const ID = /^[\w.:-]{1,100}$/;
const HOST = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : null;
const id = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : null);
const host = (v: unknown) => (typeof v === "string" && HOST.test(v) ? v.toLowerCase() : null);

/** `https:` only, no credentials, bounded; the browser-normalised form. Anything else is null. */
export function safeHttpsUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 1000) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

export function observabilityLinks(metadata: unknown): ObservabilityLink[] {
  const o = obj(obj(metadata)?.observability);
  if (!o) return [];
  const out: ObservabilityLink[] = [];

  const s = obj(o.sentry);
  if (s) {
    // The widget sends the web host (sentry.io, de.sentry.io, or a self-hosted one); the organisation is
    // resolved by Sentry itself when you are signed in.
    const base = `https://${host(s.host) ?? "sentry.io"}`;
    const eventId = id(s.eventId);
    const replayId = id(s.replayId);
    if (eventId)
      out.push({
        provider: "sentry",
        kind: "event",
        href: safeHttpsUrl(`${base}/issues/?query=${encodeURIComponent(`id:${eventId}`)}`) ?? "",
      });
    if (replayId)
      out.push({
        provider: "sentry",
        kind: "replay",
        href: safeHttpsUrl(`${base}/replays/${encodeURIComponent(replayId)}/`) ?? "",
      });
  }

  const p = obj(o.posthog);
  const phUrl = safeHttpsUrl(p?.replayUrl);
  if (phUrl) out.push({ provider: "posthog", kind: "replay", href: phUrl });

  const lr = safeHttpsUrl(obj(o.logrocket)?.sessionUrl);
  if (lr) out.push({ provider: "logrocket", kind: "session", href: lr });

  const d = obj(o.datadog);
  const ddSession = id(d?.sessionId);
  if (ddSession) {
    const site = host(d?.site) ?? "datadoghq.com";
    const href = safeHttpsUrl(`https://app.${site}/rum/replay/sessions/${encodeURIComponent(ddSession)}`);
    if (href) out.push({ provider: "datadog", kind: "replay", href });
  }
  return out.filter((l) => l.href);
}
