import { afterEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  const makeTx = () => ({
    execute: vi.fn(() => Promise.resolve([])),
    transaction: vi.fn((run: (db: unknown) => Promise<unknown>): Promise<unknown> => run(makeTx())),
  });
  let tx = makeTx();
  const root = {
    transaction: vi.fn((run: (db: unknown) => Promise<unknown>) => {
      tx = makeTx();
      return run(tx);
    }),
  };
  return {
    get tx() {
      return tx;
    },
    root,
  };
});

vi.mock("../../db/src/connection", () => ({ getRuntimeDb: () => fake.root }));

import { getDb, withOrg, currentOrgId, afterOrgCommit } from "../../db/src";
import { identityDatabase } from "../../db/src/identity";

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

  it("runs side effects after the transaction and outside tenant context", async () => {
    const events: string[] = [];
    await withOrg("org-a", () => {
      afterOrgCommit(() => {
        expect(currentOrgId()).toBeUndefined();
        events.push("committed");
      });
      expect(events).toEqual([]);
      events.push("write");
      return Promise.resolve();
    });
    expect(events).toEqual(["write", "committed"]);
  });

  it("discards side effects when the transaction rolls back", async () => {
    const effect = vi.fn();
    await expect(
      withOrg("org-a", () => {
        afterOrgCommit(effect);
        return Promise.reject(new Error("rollback"));
      }),
    ).rejects.toThrow("rollback");
    expect(effect).not.toHaveBeenCalled();
  });

  it("defers same-org nested effects until the enclosing commit", async () => {
    const effect = vi.fn();
    await withOrg("org-a", async () => {
      await withOrg("org-a", () => {
        afterOrgCommit(effect);
        return Promise.resolve();
      });
      expect(effect).not.toHaveBeenCalled();
    });
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it("keeps autocommit side effects immediate outside an organization transaction", () => {
    const effect = vi.fn();
    afterOrgCommit(effect);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it("keeps the auth adapter on a stable pool instead of capturing a request transaction", async () => {
    vi.stubEnv("PINWREN_MODE", "selfhost");
    await withOrg("org-a", () => {
      expect(getDb()).toBe(fake.tx);
      expect(identityDatabase()).toBe(fake.root);
      return Promise.resolve();
    });
  });
});
