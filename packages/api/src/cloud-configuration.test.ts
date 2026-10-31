import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deploymentMode } from "../../db/src/deployment-mode";
import { assertCloudDatabaseSecurity } from "../../db/src/cloud-security";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("PINWREN_MODE", undefined);
  vi.stubEnv("DATABASE_URL", "postgres://unused@127.0.0.1:1/none");
  vi.stubEnv("PINWREN_URL", "http://localhost:3100");
  vi.stubEnv("PINWREN_SECRET", "x".repeat(48));
  vi.stubEnv("PINWREN_SERVICE_DATABASE_URL", undefined);
});
afterEach(() => vi.unstubAllEnvs());

it("defaults to selfhost without Cloud credentials or a database connection", async () => {
  expect(deploymentMode()).toBe("selfhost");
  const { env } = await import("./env");
  expect(env().PINWREN_MODE).toBe("selfhost");
  await expect(assertCloudDatabaseSecurity()).resolves.toBeUndefined();
});

it("rejects unknown deployment modes", async () => {
  vi.stubEnv("PINWREN_MODE", "cluod");
  expect(() => deploymentMode()).toThrow(/PINWREN_MODE/);
  const { env } = await import("./env");
  expect(() => env()).toThrow(/PINWREN_MODE/);
});

it("requires separate service credentials in Cloud mode", async () => {
  vi.stubEnv("PINWREN_MODE", "cloud");
  const { env } = await import("./env");
  expect(() => env()).toThrow(/PINWREN_SERVICE_DATABASE_URL/);
});

it("rejects migration credentials in a Cloud runtime process", async () => {
  vi.stubEnv("PINWREN_MODE", "cloud");
  vi.stubEnv("PINWREN_MIGRATION_DATABASE_URL", "postgres://migration@127.0.0.1:1/none");
  await expect(assertCloudDatabaseSecurity()).rejects.toThrow(/migration credentials/);
});

it("does not expose credentials when a Cloud connection URL is malformed", async () => {
  vi.stubEnv("PINWREN_MODE", "cloud");
  vi.stubEnv("DATABASE_URL", "postgres://runtime:cloud-test-secret@[");
  vi.stubEnv("PINWREN_SERVICE_DATABASE_URL", "postgres://service@localhost/database");
  const error: unknown = await assertCloudDatabaseSecurity().catch((failure: unknown) => failure);
  expect(error).toBeInstanceOf(Error);
  expect(JSON.stringify(error)).not.toContain("cloud-test-secret");
});
