import { getDb, project, setting } from "@annota/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { env } from "../env";

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
  const [row] = await getDb().select().from(setting).where(eq(setting.key, key));
  return (row?.value ?? {}) as T;
}

async function writeSetting(key: string, value: Record<string, unknown>, userId: string | null) {
  await getDb()
    .insert(setting)
    .values({ key, value, updatedBy: userId })
    .onConflictDoUpdate({ target: setting.key, set: { value, updatedBy: userId, updatedAt: new Date() } });
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
    sessionDays: e.ANNOTA_SESSION_DAYS ?? stored.sessionDays ?? DEFAULT_SESSION_DAYS,
    updateCheck: e.ANNOTA_UPDATE_CHECK ?? stored.updateCheck ?? true,
    enforceHttps: e.ANNOTA_ENFORCE_HTTPS,
    trustProxy: e.ANNOTA_TRUST_PROXY,
    locked: {
      sessionDays: e.ANNOTA_SESSION_DAYS !== undefined,
      updateCheck: e.ANNOTA_UPDATE_CHECK !== undefined,
    },
    privacyModeProjects: await countPrivacyModeProjects(),
    version: e.ANNOTA_VERSION,
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
  if (patch.sessionDays !== undefined && e.ANNOTA_SESSION_DAYS !== undefined) rejected.push("sessionDays");
  if (patch.updateCheck !== undefined && e.ANNOTA_UPDATE_CHECK !== undefined) rejected.push("updateCheck");
  if (rejected.length) return rejected;
  const stored = await readSetting<StoredSecurity>(SECURITY_SETTING_KEY);
  const next: StoredSecurity = { ...stored };
  if (patch.sessionDays !== undefined) next.sessionDays = patch.sessionDays;
  if (patch.updateCheck !== undefined) next.updateCheck = patch.updateCheck;
  await writeSetting(SECURITY_SETTING_KEY, next, userId);
  lifetimeCache = undefined;
  return [];
}

// Read on every sign-in; cached briefly so a burst of sign-ins costs one query. Other processes
// pick up a change within the TTL.
let lifetimeCache: { days: number; until: number } | undefined;
export async function sessionLifetimeDays(): Promise<number> {
  const e = env();
  if (e.ANNOTA_SESSION_DAYS !== undefined) return e.ANNOTA_SESSION_DAYS;
  if (lifetimeCache && lifetimeCache.until > Date.now()) return lifetimeCache.days;
  let days = DEFAULT_SESSION_DAYS;
  try {
    days = (await readSetting<StoredSecurity>(SECURITY_SETTING_KEY)).sessionDays ?? DEFAULT_SESSION_DAYS;
  } catch {
    // The settings table is unreachable: fall back to the default rather than failing sign-in.
  }
  lifetimeCache = { days, until: Date.now() + 30_000 };
  return days;
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
  | { checked: true; state: UpdateState }
  | { checked: false; reason: "disabled" | "privacy_mode" };

/**
 * `update.check` (daily): read the latest GitHub release of ANNOTA_UPDATE_REPO. Skipped when the
 * admin switched it off or any project uses privacy mode (no third-party calls, F-021). Never
 * throws: offline instances just record the error.
 */
export async function runUpdateCheck(fetchImpl: typeof fetch = fetch): Promise<UpdateCheckResult> {
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
    const res = await fetchImpl(`${base}/repos/${e.ANNOTA_UPDATE_REPO}/releases/latest`, {
      headers: { accept: "application/vnd.github+json", "user-agent": `Annota/${e.ANNOTA_VERSION}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
    const tag = typeof body.tag_name === "string" ? body.tag_name.slice(0, 50) : null;
    const url =
      typeof body.html_url === "string" && /^https?:\/\//.test(body.html_url) ? body.html_url : null;
    state.latest = tag;
    state.url = url;
    state.available = !!tag && isNewerVersion(tag, e.ANNOTA_VERSION);
  } catch (err) {
    state.error = err instanceof Error ? err.message.slice(0, 200) : "check failed";
  }
  await writeSetting(UPDATE_STATE_KEY, state, null).catch(() => {});
  return { checked: true, state };
}
