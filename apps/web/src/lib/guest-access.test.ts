import { describe, expect, it } from "vitest";
import { forgetGuestAccess, readGuestAccess } from "./guest-access";

const token = "reporter_token_123456";
const access = { reporterTokens: [token], pageTokens: [] };
function browser(hash = "") {
  const entries = new Map<string, string>();
  const replacements: unknown[][] = [];
  return {
    entries,
    replacements,
    location: { hash, pathname: "/guest/project", search: "?item=123" },
    history: { state: { preserve: true }, replaceState: (...args: unknown[]) => replacements.push(args) },
    storage: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, value);
      },
      removeItem: (key: string) => {
        entries.delete(key);
      },
    },
  };
}

describe("guest browser access", () => {
  it("consumes and strips fragment credentials while preserving history state and the URL", () => {
    const b = browser(`#access=${encodeURIComponent(JSON.stringify(access))}`);
    expect(readGuestAccess("project", b)).toEqual(access);
    expect(b.replacements).toEqual([[{ preserve: true }, "", "/guest/project?item=123"]]);
    b.location.hash = "";
    expect(readGuestAccess("project", b)).toEqual(access);
    expect(readGuestAccess("other-project", b)).toBeNull();
  });

  it.each([
    "#access=%XX",
    "#access=%7B",
    "#access=" + encodeURIComponent(JSON.stringify({ reporterTokens: ["bad"] })),
    "#access=" +
      encodeURIComponent(JSON.stringify({ reporterTokens: Array.from({ length: 51 }, () => token) })),
  ])("strips and refuses malformed or oversized credentials: %s", (hash) => {
    const b = browser(hash);
    expect(readGuestAccess("project", b)).toBeNull();
    expect(b.replacements).toHaveLength(1);
    expect(b.entries.size).toBe(0);
  });

  it("does not interpret query parameters as credentials", () => {
    const b = browser();
    b.location.search = `?access=${encodeURIComponent(JSON.stringify(access))}`;
    expect(readGuestAccess("project", b)).toBeNull();
  });

  it("keeps new credentials usable when browser storage is blocked", () => {
    const b = browser(`#access=${encodeURIComponent(JSON.stringify(access))}`);
    b.storage.setItem = () => {
      throw new Error("blocked");
    };
    expect(readGuestAccess("project", b)).toEqual(access);
  });

  it("forgets only this project's credentials", () => {
    const b = browser(`#access=${encodeURIComponent(JSON.stringify(access))}`);
    readGuestAccess("project", b);
    readGuestAccess("other", b);
    forgetGuestAccess("project", b.storage);
    b.location.hash = "";
    expect(readGuestAccess("project", b)).toBeNull();
    expect(readGuestAccess("other", b)).toEqual(access);
  });

  it("rejects tampered saved credentials", () => {
    const b = browser(`#access=${encodeURIComponent(JSON.stringify(access))}`);
    readGuestAccess("project", b);
    const key = b.entries.keys().next().value;
    if (!key) throw new Error("Expected saved access");
    b.entries.set(key, JSON.stringify({ reporterTokens: ["injected,header"] }));
    b.location.hash = "";
    expect(readGuestAccess("project", b)).toBeNull();
    expect(b.entries.size).toBe(0);
  });
});
