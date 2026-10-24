import { MAX_REJECTED_ORIGINS, type RejectedOrigin } from "@pinwren/core";
import { getDb, project } from "@pinwren/db";
import { eq } from "drizzle-orm";
import { consume } from "../rate-limit";

// Refused widget origins (wave-5 contract §3.3). When a request carries a valid project key from a site that
// isn't on the allowlist, the project remembers the origin so the Install tab can say "Blocked a request from
// https://www.example.com — Allow" instead of waiting forever for the first widget load.

/** At most one write per origin per minute; the count still goes up by one per write. */
export const REJECTED_ORIGIN_INTERVAL_MS = 60_000;
/** New origins per project and minute, so a script cycling fake Origin headers can't turn this into writes. */
const NEW_ORIGINS_PER_MIN = 10;

/** A refused Origin header as stored: scheme, host and port only, lower-case, bounded. */
export function cleanOrigin(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin.toLowerCase().slice(0, 300);
  } catch {
    return null;
  }
}

/**
 * The list after one more refusal of `origin`, newest first and at most `MAX_REJECTED_ORIGINS` long — or null
 * when nothing needs writing (the same origin was recorded less than a minute ago).
 */
export function nextRejectedOrigins(
  stored: unknown,
  origin: string,
  now = Date.now(),
): { list: RejectedOrigin[]; isNew: boolean } | null {
  const list = (Array.isArray(stored) ? stored : []).filter(
    (r: unknown): r is RejectedOrigin =>
      !!r &&
      typeof (r as RejectedOrigin).origin === "string" &&
      typeof (r as RejectedOrigin).at === "string" &&
      typeof (r as RejectedOrigin).count === "number",
  );
  const prev = list.find((r) => r.origin === origin);
  if (prev && now - Date.parse(prev.at) < REJECTED_ORIGIN_INTERVAL_MS) return null;
  const entry: RejectedOrigin = {
    origin,
    at: new Date(now).toISOString(),
    count: Math.min((prev?.count ?? 0) + 1, 1_000_000),
  };
  return {
    list: [entry, ...list.filter((r) => r.origin !== origin)].slice(0, MAX_REJECTED_ORIGINS),
    isNew: !prev,
  };
}

/** Record a refusal on the project. Best effort: never fails the (already refused) request. */
export async function recordRejectedOrigin(
  p: { id: string; rejectedOrigins: unknown },
  rawOrigin: string,
): Promise<void> {
  const origin = cleanOrigin(rawOrigin);
  if (!origin) return;
  const next = nextRejectedOrigins(p.rejectedOrigins, origin);
  if (!next) return;
  try {
    if (next.isNew && !(await consume(`wro:${p.id}`, NEW_ORIGINS_PER_MIN, 60))) return;
    await getDb().update(project).set({ rejectedOrigins: next.list }).where(eq(project.id, p.id));
  } catch (err) {
    console.warn("[pinwren] could not record a refused origin", err);
  }
}
