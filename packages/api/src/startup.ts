import { env } from "./env";
import { PRODUCTION_KEYS } from "./license/keys";
import { mergeStalePages } from "./services/page-merge";
import { hasAnyUser, promoteFirstAccount } from "./services/setup";
import { encryptLegacyChatWebhookUrls } from "./webhooks/url";

// One-off work at server start (called from the dashboard's instrumentation hook). Each step logs and
// carries on: none of it may keep the server from starting.

/**
 * The first account administers the instance (ADR 0021 amendment, BugPin model). Instances upgraded from
 * the setup-token flow whose token was never claimed get their oldest account promoted here; on a fresh
 * instance this only says where to start. Every worker runs it; the advisory lock makes it idempotent.
 */
export async function ensureInstanceAdmin(): Promise<void> {
  try {
    if (await promoteFirstAccount()) {
      console.info("[pinwren] the first account is now the instance administrator");
      return;
    }
    if (!(await hasAnyUser())) {
      const url = `${env().PINWREN_URL.replace(/\/$/, "")}/sign-up`;
      console.info(`[pinwren] no accounts yet: open ${url} to create the administrator account`);
    }
  } catch (err) {
    console.error("[pinwren] could not check the instance administrator", err);
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
  try {
    const n = await mergeStalePages();
    if (n) console.log(`[pinwren] re-grouped ${n} page(s) under the wave-5 URL rules`);
  } catch (err) {
    console.error("[pinwren] could not re-group pages", err);
  }
}
