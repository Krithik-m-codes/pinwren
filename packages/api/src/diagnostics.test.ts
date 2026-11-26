import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The database is the only thing faked: `execute` answers what each check asks, the rest is real
// (env parsing, the local-disk storage driver, the migration journal on disk).
const db = vi.hoisted(() => ({ execute: vi.fn<(query: unknown) => Promise<unknown>>() }));
vi.mock("@pinwren/db", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getDb: () => db,
}));

// Email settings are read through a separate system handle; the cases decide what they say.
const email = vi.hoisted(() => ({ resolveSmtp: vi.fn<() => Promise<unknown>>() }));
vi.mock("./email/config", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveSmtp: email.resolveSmtp,
}));

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pinwren-doctor-"));
  vi.resetModules();
  vi.stubEnv("PINWREN_MODE", undefined);
  vi.stubEnv("DATABASE_URL", "postgres://unused@127.0.0.1:1/none");
  vi.stubEnv("PINWREN_URL", "http://localhost:3100");
  vi.stubEnv("PINWREN_SECRET", "x".repeat(48));
  vi.stubEnv("PINWREN_DATA_DIR", dir);
  vi.stubEnv("SMTP_HOST", undefined);
  vi.stubEnv("EMAIL_FROM", undefined);
  db.execute.mockReset();
  email.resolveSmtp.mockReset().mockResolvedValue(null);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

async function journal(entries: number): Promise<string> {
  const folder = join(dir, "migrations");
  await mkdir(join(folder, "meta"), { recursive: true });
  await writeFile(
    join(folder, "meta/_journal.json"),
    JSON.stringify({ entries: Array.from({ length: entries }, (_, idx) => ({ idx })) }),
  );
  return folder;
}

describe("migrations", () => {
  it("is fine when every shipped migration is applied", async () => {
    db.execute.mockResolvedValue([{ applied: 3 }]);
    const { migrationsCheck } = await import("./services/diagnostics");
    expect(await migrationsCheck(await journal(3))).toMatchObject({
      ok: true,
      detail: "up to date (3 applied)",
    });
  });

  it("counts what is pending", async () => {
    db.execute.mockResolvedValue([{ applied: 1 }]);
    const { migrationsCheck } = await import("./services/diagnostics");
    const check = await migrationsCheck(await journal(3));
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("2 pending");
  });

  it("refuses a database newer than the build instead of calling it healthy", async () => {
    db.execute.mockResolvedValue([{ applied: 5 }]);
    const { migrationsCheck } = await import("./services/diagnostics");
    const check = await migrationsCheck(await journal(3));
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("newer version");
  });

  it("skips with a warning when the migration files are not shipped", async () => {
    const { migrationsCheck } = await import("./services/diagnostics");
    expect(await migrationsCheck(join(dir, "nowhere"))).toMatchObject({ ok: true, warn: true });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("reports an unreadable migration table", async () => {
    db.execute.mockRejectedValue(new Error('relation "drizzle.__drizzle_migrations" does not exist'));
    const { migrationsCheck } = await import("./services/diagnostics");
    expect(await migrationsCheck(await journal(1))).toMatchObject({ ok: false });
  });
});

describe("runDiagnostics", () => {
  it("reports every check, each on its own, and leaves no probe behind", async () => {
    db.execute.mockResolvedValue([{ applied: 0 }]);
    const { runDiagnostics } = await import("./services/diagnostics");
    const checks = await runDiagnostics();
    expect(checks.map((c) => c.name)).toEqual(["database", "migrations", "storage", "smtp", "config"]);
    expect(checks.find((c) => c.name === "database")).toMatchObject({ ok: true });
    expect(checks.find((c) => c.name === "storage")).toMatchObject({ ok: true });
    // Email unset is a warning with the consequence spelled out, not a failure.
    expect(checks.find((c) => c.name === "smtp")).toMatchObject({ ok: true, warn: true });
    const left = await readdir(join(dir, "assets", "diagnostics")).catch(() => []);
    expect(left).toEqual([]);
  });

  it("a database failure does not hide the other checks", async () => {
    db.execute.mockRejectedValue(new Error("connection refused"));
    const { runDiagnostics } = await import("./services/diagnostics");
    const checks = await runDiagnostics();
    expect(checks.find((c) => c.name === "database")).toMatchObject({ ok: false });
    expect(checks.find((c) => c.name === "storage")).toMatchObject({ ok: true });
  });

  it("reports unreadable email settings instead of throwing", async () => {
    email.resolveSmtp.mockRejectedValue(new Error("connection refused"));
    db.execute.mockResolvedValue([{ applied: 0 }]);
    const { runDiagnostics } = await import("./services/diagnostics");
    expect((await runDiagnostics()).find((c) => c.name === "smtp")).toMatchObject({ ok: false });
  });

  it("reports a storage directory that cannot be written", async () => {
    // A file where the data directory should be: mkdir fails the same way a read-only volume does.
    const blocked = join(dir, "blocked");
    await writeFile(blocked, "");
    vi.stubEnv("PINWREN_DATA_DIR", blocked);
    db.execute.mockResolvedValue([{ applied: 0 }]);
    const { runDiagnostics } = await import("./services/diagnostics");
    const storage = (await runDiagnostics()).find((c) => c.name === "storage");
    expect(storage?.ok).toBe(false);
  });
});

describe("config", () => {
  it("warns about a plain-http public URL and names the setting, never a secret", async () => {
    vi.stubEnv("PINWREN_URL", "http://feedback.example.com");
    const { configCheck } = await import("./services/diagnostics");
    const check = configCheck();
    expect(check).toMatchObject({ ok: true, warn: true });
    expect(check.detail).toContain("PINWREN_URL is not https");
    expect(check.detail).not.toContain("x".repeat(48));
  });

  it("is quiet for localhost development", async () => {
    const { configCheck } = await import("./services/diagnostics");
    expect(configCheck().warn).toBeUndefined();
  });
});
