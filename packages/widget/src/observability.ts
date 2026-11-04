// Observability link-outs (report chunk): when the host page already runs Sentry, PostHog, LogRocket or
// Datadog RUM, the ids of their current session/replay/event go into the report's `metadata.observability`,
// so the dashboard can link straight to them. Read-only and passive: we only look at globals those SDKs
// already put on `window`, never load or call into anything that sends data, and every value is validated
// here (and again by the dashboard) before it is stored. Privacy mode skips all of it.

export type Observability = {
  sentry?: { eventId?: string; replayId?: string; host?: string };
  posthog?: { sessionId?: string; replayUrl?: string };
  logrocket?: { sessionUrl?: string };
  datadog?: { sessionId?: string; applicationId?: string; site?: string };
};

type Obj = Record<string, unknown>;
const ID = /^[\w.:-]{1,100}$/;
const HOST = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i;

const id = (v: unknown): string | undefined => (typeof v === "string" && ID.test(v) ? v : undefined);

/** An https URL without credentials, at most 1000 characters; anything else (http:, javascript:, data:) is dropped. */
export function httpsUrl(v: unknown): string | undefined {
  if (typeof v !== "string" || v.length > 1000) return undefined;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password ? u.href : undefined;
  } catch {
    return undefined;
  }
}

const isObj = (v: unknown): v is Obj => (typeof v === "object" || typeof v === "function") && v !== null;

/** `obj.a.b(args)` when it exists; any throw (the SDK's own bugs, getters) counts as "not there". */
function call(obj: unknown, path: string, ...args: unknown[]): unknown {
  try {
    let parent: unknown = obj;
    let fn: unknown = obj;
    for (const key of path.split(".")) {
      if (!isObj(fn)) return undefined;
      parent = fn;
      fn = fn[key];
    }
    return typeof fn === "function" ? (fn as (...a: unknown[]) => unknown).apply(parent, args) : fn;
  } catch {
    return undefined;
  }
}

const hostOf = (dsn: unknown): string | undefined => {
  if (typeof dsn !== "string") return undefined;
  try {
    // `o123.ingest.de.sentry.io` is the SDK's ingest host; the web app lives on `de.sentry.io`.
    const host = new URL(dsn).hostname.replace(/^o\d+\./, "").replace(/^ingest\./, "");
    return HOST.test(host) ? host : undefined;
  } catch {
    return undefined;
  }
};

function sentry(w: Obj): Observability["sentry"] {
  const hub = isObj(w.__SENTRY__) ? w.__SENTRY__.hub : undefined;
  const S = w.Sentry;
  // Sentry v7 keeps a hub on `__SENTRY__`; v8+ has top-level helpers; v9 dropped `lastEventId()` for the scope's.
  const eventId = id(
    call(S, "lastEventId") ??
      call(call(S, "getCurrentScope"), "lastEventId") ??
      call(call(S, "getIsolationScope"), "lastEventId") ??
      call(hub, "lastEventId"),
  );
  const replay = call(S, "getReplay");
  const replayId = id(call(replay, "getReplayId"));
  const client = call(S, "getClient") ?? call(hub, "getClient");
  const host = hostOf(call(call(client, "getOptions"), "dsn") ?? call(call(client, "getDsn"), "host"));
  const out = { ...(eventId && { eventId }), ...(replayId && { replayId }), ...(host && { host }) };
  return eventId || replayId ? out : undefined;
}

/** What the page's monitoring SDKs say about the visitor's current session, or {} when none is there. */
export function detectObservability(w: Obj = window as unknown as Obj): Observability {
  const out: Observability = {};
  try {
    const s = sentry(w);
    if (s) out.sentry = s;
    const ph = w.posthog;
    const sessionId = id(call(ph, "get_session_id"));
    const replayUrl = httpsUrl(call(ph, "get_session_replay_url", { withTimestamp: true }));
    if (sessionId || replayUrl)
      out.posthog = { ...(sessionId && { sessionId }), ...(replayUrl && { replayUrl }) };
    const lr = httpsUrl(call(w.LogRocket, "sessionURL"));
    if (lr) out.logrocket = { sessionUrl: lr };
    const dd = call(w.DD_RUM, "getInternalContext");
    const ddSession = isObj(dd) ? id(dd.session_id) : undefined;
    if (ddSession) {
      const app = isObj(dd) ? id(dd.application_id) : undefined;
      const rawSite = call(call(w.DD_RUM, "getInitConfiguration"), "site");
      const site = typeof rawSite === "string" && HOST.test(rawSite) ? rawSite : undefined;
      out.datadog = { sessionId: ddSession, ...(app && { applicationId: app }), ...(site && { site }) };
    }
  } catch {
    // never let a third-party SDK break a bug report
  }
  return out;
}

/**
 * The host's metadata plus `observability` (what the host set itself via `setMetadata({ observability })`,
 * overridden by what was detected). Privacy mode and an empty result leave the metadata as it was.
 */
export function withObservability(
  host: Obj | null,
  privacyMode: boolean,
  found: Observability = privacyMode ? {} : detectObservability(),
): Obj | null {
  if (!Object.keys(found).length) return host;
  const own =
    host && isObj(host.observability) && !Array.isArray(host.observability) ? host.observability : {};
  return { ...host, observability: { ...own, ...found } };
}
