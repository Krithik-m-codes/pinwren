import { afterEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  const tx = { execute: vi.fn(() => Promise.resolve([])) };
  const root = { transaction: vi.fn((run: (db: unknown) => Promise<unknown>) => run(tx)) };
  return { tx, root };
});

vi.mock("../../db/src/connection", () => ({ getRuntimeDb: () => fake.root }));

import { getDb, withOrg, currentOrgId } from "../../db/src";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("organization transaction context", () => {
  it.each(["", " ", "\t", " org-a", "org-a ", "org\u0000a"])(
    "rejects invalid identifier %j before opening a transaction",
    async (id) => {
      await expect(withOrg(id, () => Promise.resolve())).rejects.toThrow(/organization/i);
      expect(fake.root.transaction).not.toHaveBeenCalled();
    },
  );

  it("sets SQL context before invoking the callback and returns its value", async () => {
    const value = await withOrg("org-a", (db) => {
      expect(fake.tx.execute).toHaveBeenCalledTimes(1);
      expect(db).toBe(fake.tx);
      expect(getDb()).toBe(fake.tx);
      expect(currentOrgId()).toBe("org-a");
      return Promise.resolve(42);
    });
    expect(value).toBe(42);
    expect(currentOrgId()).toBeUndefined();
  });

  it("reuses same-org nested scope and rejects another org without a second transaction", async () => {
    await withOrg("org-a", async (db) => {
      await withOrg("org-a", (nested) => {
        expect(nested).toBe(db);
        return Promise.resolve();
      });
      await expect(withOrg("org-b", () => Promise.resolve())).rejects.toThrow(/organization/i);
    });
    expect(fake.root.transaction).toHaveBeenCalledTimes(1);
  });

  it("isolates concurrent asynchronous scopes", async () => {
    let release: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    await Promise.all([
      withOrg("org-a", async () => {
        await ready;
        expect(currentOrgId()).toBe("org-a");
      }),
      withOrg("org-b", () => {
        expect(currentOrgId()).toBe("org-b");
        release();
        return Promise.resolve();
      }),
    ]);
    expect(currentOrgId()).toBeUndefined();
  });

  it("propagates errors and clears context", async () => {
    const failure = new Error("rollback this write");
    await expect(withOrg("org-a", () => Promise.reject(failure))).rejects.toBe(failure);
    expect(currentOrgId()).toBeUndefined();
  });

  it("denies missing Cloud context and preserves selfhost access", () => {
    vi.stubEnv("PINWREN_MODE", "cloud");
    expect(() => getDb()).toThrow(/organization/i);
    vi.stubEnv("PINWREN_MODE", "selfhost");
    expect(getDb()).toBe(fake.root);
  });

  it("invalidates detached asynchronous work when its scope finishes", async () => {
    let release: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    let detached: Promise<void> = Promise.resolve();
    await withOrg("org-a", () => {
      detached = ready.then(() => {
        expect(() => getDb()).toThrow(/closed|finished/i);
        expect(() => currentOrgId()).toThrow(/closed|finished/i);
      });
      return Promise.resolve();
    });
    release();
    await detached;
  });
});
