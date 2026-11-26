import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getDb } from "@pinwren/db";
import { sql } from "drizzle-orm";
import { resolveSmtp } from "../email/config";
import { describeEmailError } from "../email/deliveries";
import { buildTransport } from "../email/send";
import { env } from "../env";
import { storage } from "../storage";

/** `pinwren doctor` and Settings: one result per check, never a throw, so one failure hides nothing. */
export type DiagnosticCheck = { name: string; ok: boolean; detail: string; warn?: boolean };

const TIMEOUT_MS = 10_000;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Fails a slow dependency instead of hanging the request (a black-holed SMTP host can take minutes). */
function within<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

async function databaseCheck(): Promise<DiagnosticCheck> {
  const started = Date.now();
  try {
    await within(getDb().execute(sql`select 1`), "database query");
    return { name: "database", ok: true, detail: `reachable (${Date.now() - started} ms)` };
  } catch (err) {
    return { name: "database", ok: false, detail: `query failed: ${message(err)}` };
  }
}

/** Migration files shipped with this build vs the ones the database recorded as applied. */
export async function migrationsCheck(folder?: string): Promise<DiagnosticCheck> {
  const dir =
    folder ?? process.env.PINWREN_MIGRATIONS_DIR ?? resolve(process.cwd(), "../../packages/db/drizzle");
  let expected: number;
  try {
    const journal = JSON.parse(await readFile(resolve(dir, "meta/_journal.json"), "utf8")) as {
      entries?: unknown[];
    };
    expected = journal.entries?.length ?? 0;
  } catch {
    // Not a failure of the instance: the folder only exists next to the build, not in every deployment.
    return {
      name: "migrations",
      ok: true,
      warn: true,
      detail: "skipped: migration files not found (set PINWREN_MIGRATIONS_DIR)",
    };
  }
  try {
    const rows = await within(
      getDb().execute(sql`select count(*)::int as applied from drizzle.__drizzle_migrations`),
      "migration query",
    );
    const applied = (rows as unknown as { applied: number }[])[0]?.applied ?? 0;
    if (applied === expected)
      return { name: "migrations", ok: true, detail: `up to date (${applied} applied)` };
    return applied < expected
      ? {
          name: "migrations",
          ok: false,
          detail: `${expected - applied} pending (${applied} of ${expected} applied); restart the server to apply them`,
        }
      : {
          name: "migrations",
          ok: false,
          detail: `database has ${applied} migrations but this build ships ${expected}: a newer version ran here, do not run this one`,
        };
  } catch (err) {
    return { name: "migrations", ok: false, detail: `cannot read the migration table: ${message(err)}` };
  }
}

/** Writes, reads back and removes a probe object through the configured driver (local disk or S3). */
async function storageCheck(): Promise<DiagnosticCheck> {
  const e = env();
  const driver = e.STORAGE_DRIVER === "s3" ? "S3" : `local disk (${e.PINWREN_DATA_DIR})`;
  const key = `diagnostics/${randomUUID()}.gz`;
  try {
    const bytes = new TextEncoder().encode("pinwren doctor");
    await within(storage().put(key, bytes, "application/gzip"), "storage write");
    const back = await within(storage().get(key), "storage read");
    await within(storage().remove(key), "storage delete");
    if (back?.bytes !== bytes.byteLength) {
      return { name: "storage", ok: false, detail: `${driver}: wrote a probe but could not read it back` };
    }
    return { name: "storage", ok: true, detail: `${driver} is writable` };
  } catch (err) {
    await storage()
      .remove(key)
      .catch(() => undefined);
    return { name: "storage", ok: false, detail: `${driver}: ${message(err)}` };
  }
}

/** Connects, negotiates TLS and logs in (`verify()`); sends nothing. Unconfigured is a warning, not a failure. */
async function smtpCheck(): Promise<DiagnosticCheck> {
  let smtp: Awaited<ReturnType<typeof resolveSmtp>>;
  try {
    smtp = await resolveSmtp();
  } catch (err) {
    // The settings live in the database, so a database outage lands here too: report it, don't throw.
    return { name: "smtp", ok: false, detail: `cannot read the email settings: ${message(err)}` };
  }
  if (!smtp) {
    return {
      name: "smtp",
      ok: true,
      warn: true,
      detail: "not configured: no email is sent and reset links are shown to the admin instead",
    };
  }
  const transport = buildTransport(smtp);
  try {
    await within(transport.verify(), "SMTP verify");
    return { name: "smtp", ok: true, detail: `${smtp.host}:${smtp.port} accepted the login` };
  } catch (err) {
    return { name: "smtp", ok: false, detail: `${smtp.host}:${smtp.port}: ${describeEmailError(err)}` };
  } finally {
    transport.close();
  }
}

/** Settings that work but are usually a mistake in production. No secret value is ever printed. */
export function configCheck(): DiagnosticCheck {
  const e = env();
  const problems: string[] = [];
  const url = new URL(e.PINWREN_URL);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) problems.push("PINWREN_URL is not https");
  if (url.protocol === "https:" && !e.PINWREN_ENFORCE_HTTPS) problems.push("PINWREN_ENFORCE_HTTPS is off");
  if (e.PINWREN_TRUST_PROXY === 0 && !local) {
    problems.push("PINWREN_TRUST_PROXY is 0: behind a proxy every client shares its address");
  }
  return problems.length
    ? { name: "config", ok: true, warn: true, detail: problems.join("; ") }
    : { name: "config", ok: true, detail: `PINWREN_URL ${e.PINWREN_URL}` };
}

export async function runDiagnostics(): Promise<DiagnosticCheck[]> {
  // Independent checks run together; the order of the list stays fixed.
  const [database, migrations, storageProbe, smtp] = await Promise.all([
    databaseCheck(),
    migrationsCheck(),
    storageCheck(),
    smtpCheck(),
  ]);
  return [database, migrations, storageProbe, smtp, configCheck()];
}
