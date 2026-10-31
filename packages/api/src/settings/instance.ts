import { readInstanceSetting, saveInstanceSetting } from "../db/system";
import { getDb, project } from "@pinwren/db";
import { and, isNull, sql } from "drizzle-orm";
import { env } from "../env";
import { type OutboundFetch, outboundErrorText, safeFetch } from "../outbound/safe-fetch";

// Instance security settings (session lifetime, update check). Stored in `setting` and edited by
// instance admins; an environment variable for a field overrides and locks it (CLAUDE.md).

export const SECURITY_SETTING_KEY = "security";
export const UPDATE_STATE_KEY = "update";
export const DEFAULT_SESSION_DAYS = 7;

type StoredSecurity = { sessionDays?: number; updateCheck?: boolean };

export type SecuritySettingsView = {
  sessionDays: number;
  updateCheck: boolean;
  /** Read-only, from the environment. */
  enforceHttps: boolean;
  trustProxy: boolean;
  /** X-Forwarded-For hops trusted (PINWREN_TRUST_PROXY). */
  trustProxyHops: number;
  locked: { sessionDays: boolean; updateCheck: boolean };
  /** Projects with privacy mode on; any of them switches the update check off. */
  privacyModeProjects: number;
  version: string;
  update: UpdateState | null;
};

export type UpdateState = {
  checkedAt: string;
  latest: string | null;
  url: string | null;
  available: boolean;
  error: string | null;
};

async function readSetting<T>(key: string): Promise<T> {
  const row = await readInstanceSetting(key);
  return (row?.value ?? {}) as T;
}

async function writeSetting(key: string, value: Record<string, unknown>, userId: string | null) {
  await saveInstanceSetting({ key, value, updatedBy: userId });
}

export async function countPrivacyModeProjects(): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(project)
    .where(and(isNull(project.archivedAt), sql`(${project.widgetConfig}->>'privacyMode')::boolean is true`));
  return row?.n ?? 0;
}

export async function getSecuritySettings(): Promise<SecuritySettingsView> {
  const e = env();
  const stored = await readSetting<StoredSecurity>(SECURITY_SETTING_KEY);
  const update = await readSetting<Partial<UpdateState>>(UPDATE_STATE_KEY);
  return {
    sessionDays: e.PINWREN_SESSION_DAYS ?? stored.sessionDays ?? DEFAULT_SESSION_DAYS,
    updateCheck: e.PINWREN_UPDATE_CHECK ?? stored.updateCheck ?? true,
    enforceHttps: e.PINWREN_ENFORCE_HTTPS,
    trustProxy: e.PINWREN_TRUST_PROXY > 0,
    trustProxyHops: e.PINWREN_TRUST_PROXY,
    locked: {
      sessionDays: e.PINWREN_SESSION_DAYS !== undefined,
      updateCheck: e.PINWREN_UPDATE_CHECK !== undefined,
    },
    privacyModeProjects: await countPrivacyModeProjects(),
    version: e.PINWREN_VERSION,
    update: update.checkedAt ? (update as UpdateState) : null,
  };
}

/** Returns the names of fields refused because an environment variable locks them. */
export async function updateSecuritySettings(
  patch: { sessionDays?: number | undefined; updateCheck?: boolean | undefined },
  userId: string,
): Promise<string[]> {
  const e = env();
  const rejected: string[] = [];
  if (patch.sessionDays !== undefined && e.PINWREN_SESSION_DAYS !== undefined) rejected.push("sessionDays");
  if (patch.updateCheck !== undefined && e.PINWREN_UPDATE_CHECK !== undefined) rejected.push("updateCheck");
  if (rejected.length) return rejected;
  const stored = await readSetting<StoredSecurity>(SECURITY_SETTING_KEY);
  const next: StoredSecurity = { ...stored };
  if (patch.sessionDays !== undefined) next.sessionDays = patch.sessionDays;
  if (patch.updateCheck !== undefined) next.updateCheck = patch.updateCheck;
  await writeSetting(SECURITY_SETTING_KEY, next, userId);
  return [];
}

// Read on every sign-in. Deliberately not cached: with several worker processes a per-process cache
// kept serving the old lifetime after an admin changed it, and sign-ins are rare enough that one small
// query each costs nothing.
export async function sessionLifetimeDays(): Promise<number> {
  const e = env();
  if (e.PINWREN_SESSION_DAYS !== undefined) return e.PINWREN_SESSION_DAYS;
  try {
    return (await readSetting<StoredSecurity>(SECURITY_SETTING_KEY)).sessionDays ?? DEFAULT_SESSION_DAYS;
  } catch {
    // The settings table is unreachable: fall back to the default rather than failing sign-in.
    return DEFAULT_SESSION_DAYS;
  }
}

// --- Update check ----------------------------------------------------------------------------------

/** Compare dotted versions ("v1.2.10" > "1.2.9"); pre-release suffixes are ignored. */
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/i, "")
      .split(/[-+]/)[0]
      ?.split(".")
      .map((n) => Number.parseInt(n, 10) || 0) ?? [];
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export type UpdateCheckResult =
  { checked: true; state: UpdateState } | { checked: false; reason: "disabled" | "privacy_mode" };

/**
 * `update.check` (daily): read the latest GitHub release of PINWREN_UPDATE_REPO. Skipped when the
 * admin switched it off or any project uses privacy mode (no third-party calls, F-021). Never
 * throws: offline instances just record the error.
 */
export async function runUpdateCheck(fetchImpl: OutboundFetch = safeFetch): Promise<UpdateCheckResult> {
  const s = await getSecuritySettings();
  if (!s.updateCheck) return { checked: false, reason: "disabled" };
  if (s.privacyModeProjects > 0) return { checked: false, reason: "privacy_mode" };
  const e = env();
  const base = e.GITHUB_API_URL.replace(/\/$/, "");
  const state: UpdateState = {
    checkedAt: new Date().toISOString(),
    latest: s.update?.latest ?? null,
    url: s.update?.url ?? null,
    available: s.update?.available ?? false,
    error: null,
  };
  try {
    const res = await fetchImpl(`${base}/repos/${e.PINWREN_UPDATE_REPO}/releases/latest`, {
      headers: { accept: "application/vnd.github+json", "user-agent": `Pinwren/${e.PINWREN_VERSION}` },
      // GITHUB_API_URL is the operator's own setting; size and time caps still apply.
      trusted: true,
      timeoutMs: 5000,
      maxBytes: 512 * 1024,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
    const tag = typeof body.tag_name === "string" ? body.tag_name.slice(0, 50) : null;
    const url =
      typeof body.html_url === "string" && /^https?:\/\//.test(body.html_url) ? body.html_url : null;
    state.latest = tag;
    state.url = url;
    state.available = !!tag && isNewerVersion(tag, e.PINWREN_VERSION);
  } catch (err) {
    state.error =
      err instanceof Error && err.name !== "OutboundError"
        ? err.message.slice(0, 200)
        : outboundErrorText(err);
  }
  await writeSetting(UPDATE_STATE_KEY, state, null).catch(() => {
    // The result is advisory; the next scheduled check tries again.
  });
  return { checked: true, state };
}
