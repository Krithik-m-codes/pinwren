import { env } from "./env";
import { PRODUCTION_KEYS } from "./license/keys";
import { issueSetupToken } from "./services/setup";
import { encryptLegacyChatWebhookUrls } from "./webhooks/url";

// One-off work at server start (called from the dashboard's instrumentation hook). Each step logs and
// carries on: none of it may keep the server from starting.

/** While no instance admin exists, print a fresh one-time setup token (ADR 0021). */
export async function announceSetupToken(): Promise<void> {
  try {
    const token = await issueSetupToken();
    if (!token) return;
    const url = `${env().PINWREN_URL.replace(/\/$/, "")}/setup`;
    console.warn(
      [
        "",
        "[pinwren] ─────────────────────────────────────────────────────────────────────",
        "[pinwren] This instance has no administrator yet.",
        `[pinwren] Sign in (or create the first account), open ${url}`,
        `[pinwren] and enter this one-time setup token:  ${token}`,
        "[pinwren] Or set PINWREN_ADMIN_EMAILS. The token is printed again on every start until claimed.",
        "[pinwren] ─────────────────────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
  } catch (err) {
    console.error("[pinwren] could not issue a setup token", err);
  }
}

/**
 * Release builds must carry the maintainers' licence public key; without one no Enterprise licence can
 * ever verify in production. `scripts/check-release-keys.mjs` fails the release build; this is the
 * runtime reminder for anything built another way.
 */
export function checkReleaseKeys(): void {
  if (process.env.NODE_ENV === "production" && Object.keys(PRODUCTION_KEYS).length === 0) {
    console.error(
      "[pinwren] PRODUCTION_KEYS is empty: Enterprise licences can't be verified by this build. " +
        "Maintainers: see docs/release/licence-keys.md.",
    );
  }
}

/** Data fixes that need the app's encryption key, so they can't be SQL migrations. */
export async function runStartupFixes(): Promise<void> {
  try {
    const n = await encryptLegacyChatWebhookUrls();
    if (n) console.log(`[pinwren] encrypted ${n} Slack/Discord webhook URL(s) at rest`);
  } catch (err) {
    console.error("[pinwren] could not encrypt stored chat webhook URLs", err);
  }
}
