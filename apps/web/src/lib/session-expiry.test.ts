// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { resetSessionExpiry, returnPathFor, sessionExpired } from "./session-expiry";

const at = (path: string) => {
  const u = new URL(path, "http://localhost");
  return { pathname: u.pathname, search: u.search, hash: u.hash } as Location;
};

beforeEach(() => {
  vi.useFakeTimers();
  resetSessionExpiry();
  toast.error.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("session expiry", () => {
  it("returns to the same screen, filters included", () => {
    expect(returnPathFor(at("/dashboard?project=p1&dash=d1"))).toBe("/dashboard?project=p1&dash=d1");
    expect(returnPathFor(at("/inbox?item=3#c"))).toBe("/inbox?item=3#c");
  });

  it("does nothing on screens that do not need a session", () => {
    expect(returnPathFor(at("/guest/abc"))).toBeNull();
    expect(returnPathFor(at("/sign-in"))).toBeNull();
    const go = vi.fn();
    sessionExpired(at("/share/xyz"), go);
    vi.runAllTimers();
    expect(toast.error).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
  });

  it("says so once and redirects to sign-in with the page to come back to", () => {
    const go = vi.fn();
    sessionExpired(at("/dashboard?assignee=me"), go);
    sessionExpired(at("/dashboard?assignee=me"), go);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(go).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith("/sign-in?next=%2Fdashboard%3Fassignee%3Dme");
  });
});
