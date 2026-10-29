import { afterEach, describe, expect, it, vi } from "vitest";
import { guestApi } from "./api/guest";
import { flush, json, mockFetch, testStore } from "./test-utils";

afterEach(() => vi.unstubAllGlobals());
const access = { reporterTokens: ["reporter_token_123456"], pageTokens: ["signed.token"] };
const args = { key: "public_project", access };

describe("guest portal requests", () => {
  it("sends capabilities only in headers on private no-store requests", async () => {
    const seen: Request[] = [];
    mockFetch((req) => {
      seen.push(req);
      return json({ items: [] });
    });
    const store = testStore();
    await store.dispatch(guestApi.endpoints.guestPortal.initiate(args));
    expect(seen[0]?.url).toBe("http://pinwren.test/api/guest/public_project/feedback");
    expect(seen[0]?.headers.get("x-pinwren-reporter-tokens")).toBe(access.reporterTokens[0]);
    expect(seen[0]?.headers.get("x-pinwren-page-tokens")).toBe("signed.token");
    expect(seen[0]?.cache).toBe("no-store");
  });

  it("isolates cached results by credentials and clears private data when reset", async () => {
    mockFetch((req) => json({ items: [req.headers.get("x-pinwren-reporter-tokens")] }));
    const store = testStore();
    await store.dispatch(guestApi.endpoints.guestPortal.initiate(args));
    const other = { ...args, access: { reporterTokens: ["another_token_123456"], pageTokens: [] } };
    await store.dispatch(guestApi.endpoints.guestPortal.initiate(other));
    expect(guestApi.endpoints.guestPortal.select(args)(store.getState()).data?.items).toEqual(
      access.reporterTokens,
    );
    expect(guestApi.endpoints.guestPortal.select(other)(store.getState()).data?.items).toEqual(
      other.access.reporterTokens,
    );
    store.dispatch(guestApi.util.resetApiState());
    expect(guestApi.endpoints.guestPortal.select(args)(store.getState()).data).toBeUndefined();
  });

  it("posts only a public reply body and refreshes the conversation and report list", async () => {
    const { calls } = mockFetch((req) =>
      json(req.method === "POST" ? { comment: { body: "Thanks" } } : { items: [], replies: [] }),
    );
    const store = testStore();
    const list = store.dispatch(guestApi.endpoints.guestPortal.initiate(args));
    const thread = store.dispatch(guestApi.endpoints.guestThread.initiate({ ...args, id: "feedback-id" }));
    await Promise.all([list, thread]);
    await store.dispatch(
      guestApi.endpoints.guestReply.initiate({ ...args, id: "feedback-id", body: "Thanks" }),
    );
    await flush();
    expect(calls.find((c) => c.method === "POST")).toEqual({
      method: "POST",
      path: "/guest/public_project/feedback/feedback-id/comments",
      body: { body: "Thanks" },
    });
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(4);
  });
});
