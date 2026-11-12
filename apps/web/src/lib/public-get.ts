// A public `GET /api…` for the prerendered sign-in screens (`useSetupStatus`, `useSignInMethods`). Answers are
// shared between the screens of one visit for 30 s. A failed answer (a dropped connection, a 5xx while the
// server restarts or compiles a route in dev) is retried and is never remembered: caching it made the next
// screen decide "email is set up" or "sign-up is open" from nothing, and keep that for 30 s.

const TTL_MS = 30_000;
const RETRY_DELAYS_MS = [400, 1_200];

type Entry = { at: number; body: Promise<unknown> };
const cache = new Map<string, Entry>();

type Fetcher = (input: string, init: { credentials: "same-origin" }) => Promise<Response>;

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

async function attempt(path: string, fetcher: Fetcher): Promise<unknown> {
  try {
    const r = await fetcher(`/api${path}`, { credentials: "same-origin" });
    return r.ok ? ((await r.json()) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

/** The JSON answer, or undefined once every try has failed. */
export function publicGet(path: string, now: number, fetcher: Fetcher = fetch): Promise<unknown> {
  const hit = cache.get(path);
  if (hit && now - hit.at <= TTL_MS) return hit.body;
  const entry: Entry = {
    at: now,
    body: (async () => {
      let body = await attempt(path, fetcher);
      for (const delay of RETRY_DELAYS_MS) {
        if (body !== undefined) break;
        await sleep(delay);
        body = await attempt(path, fetcher);
      }
      if (body === undefined && cache.get(path)?.at === now) cache.delete(path);
      return body;
    })(),
  };
  cache.set(path, entry);
  return entry.body;
}

/** Test hook: forget every remembered answer. */
export function clearPublicGets() {
  cache.clear();
}
