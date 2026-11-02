import { afterEach, describe, expect, it, vi } from "vitest";
import { statsApi } from "./api/stats";
import { realtimeStarted } from "./slices/realtime";
import { FakeEventSource, flush, json, mockFetch, testStore } from "./test-utils";

afterEach(() => vi.unstubAllGlobals());

const statsCalls = (calls: { path: string }[]) => calls.filter((c) => c.path.startsWith("/stats"));

describe("dashboardStats", () => {
  it("asks for one range and project and caches the answer", async () => {
    const m = mockFetch((_req, url) => (url.pathname === "/api/stats" ? json({ days: 7 }) : undefined));
    const store = testStore();
    const arg = { days: 7 as const, projectId: "p1" };
    const first = store.dispatch(statsApi.endpoints.dashboardStats.initiate(arg));
    await first;
    await store.dispatch(statsApi.endpoints.dashboardStats.initiate(arg));
    expect(statsCalls(m.calls).map((c) => c.path)).toEqual(["/stats?days=7&projectId=p1"]);
    first.unsubscribe();
  });

  it("leaves the project out of the query for the whole workspace", async () => {
    const m = mockFetch((_req, url) => (url.pathname === "/api/stats" ? json({ days: 14 }) : undefined));
    const store = testStore();
    const sub = store.dispatch(statsApi.endpoints.dashboardStats.initiate({ days: 14 }));
    await sub;
    expect(statsCalls(m.calls).map((c) => c.path)).toEqual(["/stats?days=14"]);
    sub.unsubscribe();
  });

  it("refetches an open dashboard when an item changes on the stream", async () => {
    const m = mockFetch((_req, url) => (url.pathname === "/api/stats" ? json({ days: 14 }) : undefined));
    const store = testStore();
    store.dispatch(realtimeStarted());
    await flush();
    const sub = store.dispatch(statsApi.endpoints.dashboardStats.initiate({ days: 14 }));
    await sub;
    const source = FakeEventSource.instances.at(-1);
    source?.open();
    source?.emit("feedback.deleted", { id: "33333333-3333-4333-8333-333333333333", projectId: "p" });
    await flush(10);
    expect(statsCalls(m.calls)).toHaveLength(2);
    sub.unsubscribe();
  });
});
