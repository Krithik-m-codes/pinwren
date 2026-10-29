import { afterEach, beforeEach, expect, it, vi } from "vitest";

const guard = vi.hoisted(() => vi.fn<() => Promise<void>>());
vi.mock("@pinwren/db/cloud-security", () => ({ assertCloudDatabaseSecurity: guard }));

beforeEach(() => {
  vi.resetModules();
  guard.mockReset();
  guard.mockRejectedValue(new Error("Unsafe Cloud database role"));
  vi.stubEnv("PINWREN_MODE", "cloud");
  vi.stubEnv("DATABASE_URL", "postgres://runtime@127.0.0.1:1/none");
  vi.stubEnv("PINWREN_SERVICE_DATABASE_URL", "postgres://service@127.0.0.1:1/none");
  vi.stubEnv("PINWREN_URL", "http://localhost:3100");
  vi.stubEnv("PINWREN_SECRET", "x".repeat(48));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("fails closed before a standalone Cloud API can serve requests", async () => {
  const { app } = await import("./index");
  const response = await app.request("/api/health");
  expect(response.status).toBe(500);
  expect(guard).toHaveBeenCalledTimes(1);
  expect(await response.text()).not.toContain("Unsafe Cloud database role");
});

it("retries a failed startup check and shares a successful check", async () => {
  guard.mockRejectedValueOnce(new Error("not provisioned")).mockResolvedValue(undefined);
  const { app } = await import("./index");
  expect((await app.request("/api/health")).status).toBe(500);
  expect((await app.request("/api/health")).status).toBe(200);
  expect((await app.request("/api/health")).status).toBe(200);
  expect(guard).toHaveBeenCalledTimes(2);
});

it("preserves selfhost health checks without Cloud credentials", async () => {
  vi.stubEnv("PINWREN_MODE", "selfhost");
  vi.stubEnv("PINWREN_SERVICE_DATABASE_URL", undefined);
  const { app } = await import("./index");
  expect((await app.request("/api/health")).status).toBe(200);
  expect(guard).not.toHaveBeenCalled();
});

it("propagates worker security failures before queue startup", async () => {
  const { startJobs } = await import("./jobs");
  await expect(startJobs()).rejects.toThrow("Unsafe Cloud database role");
});
