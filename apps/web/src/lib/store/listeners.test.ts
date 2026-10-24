import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedbackList, FeedbackRow } from "@/lib/api";
import { listArgs } from "@/lib/inbox-filters";
import { api } from "./api";
import { backoffMs, fieldsFromChanges, listDependsOn, streamUrl } from "./listeners";
import {
  followChanged,
  newItemsShown,
  presenceWatched,
  realtimeStarted,
  realtimeStopped,
} from "./slices/realtime";
import { API, FakeEventSource, flush, json, mockFetch, testStore } from "./test-utils";

const P = "22222222-2222-4222-8222-222222222222";
const F = "33333333-3333-4333-8333-333333333333";

const row = (id: string): FeedbackRow => ({
  id,
  number: 1,
  kind: "comment",
  status: "open",
  priority: "none",
  title: null,
  body: "x",
  assigneeIds: [],
  reporterGuest: null,
  createdAt: "2026-10-01T00:00:00Z",
  projectId: P,
  projectName: "Site",
  pageUrl: null,
  roundId: null,
  hasScreenshot: false,
  hasReplay: false,
  screenshotAssetId: null,
  attachmentCount: 0,
  commentCount: 0,
  labels: [],
  dueAt: null,
  updatedAt: "2026-10-01T00:00:00Z",
  deletedAt: null,
});
const rowsOf = (data: { pages: FeedbackList[] } | undefined) => data?.pages.flatMap((p) => p.items);

let lists = 0;
beforeEach(() => {
  lists = 0;
  mockFetch((req, url) => {
    if (url.pathname === "/api/feedback") {
      lists++;
      return json({ items: [row(F)], nextCursor: null } satisfies FeedbackList);
    }
    if (url.pathname === "/api/presence") return json({ ok: true });
    return json({});
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const source = () => {
  const s = FakeEventSource.instances.at(-1);
  if (!s) throw new Error("no EventSource opened");
  return s;
};

describe("helpers", () => {
  it("builds the stream URL with project filter and last event id", () => {
    expect(streamUrl(API, undefined, null)).toBe(`${API}/stream`);
    expect(streamUrl(API, ["a", "b"], "w1.42")).toBe(`${API}/stream?projectIds=a%2Cb&lastEventId=w1.42`);
  });
  it("knows which list filters a change can reshape", () => {
    const active = listArgs({}, "list");
    expect(listDependsOn(active, ["status"])).toBe(true);
    expect(listDependsOn(active, ["priority"])).toBe(false);
    expect(listDependsOn(listArgs({ status: "all" }, "list"), ["status"])).toBe(false);
    expect(listDependsOn(listArgs({ assigneeId: "u1", status: "all" }, "list"), ["assigneeIds"])).toBe(true);
    expect(listDependsOn(listArgs({ sort: "priority", status: "all" }, "list"), ["priority"])).toBe(true);
    expect(listDependsOn(listArgs({ status: "all" }, "list"), ["deletedAt"])).toBe(true);
  });
  it("backs off exponentially up to 30 s", () => {
    expect([0, 1, 2, 10].map(backoffMs)).toEqual([1000, 2000, 4000, 30_000]);
  });
  it("reads the new values out of feedback.updated changes", () => {
    expect(
      fieldsFromChanges({
        status: { from: "open", to: "resolved" },
        body: { from: "a", to: "b" },
        priority: "x",
      }),
    ).toEqual({
      status: "resolved",
    });
  });
});

describe("real-time stream → RTK Query cache", () => {
  it("opens one stream and closes it on stop", async () => {
    const store = testStore();
    store.dispatch(realtimeStarted());
    await flush();
    expect(source().url).toBe(`${API}/stream`);
    source().open();
    expect(store.getState().realtime.status).toBe("open");
    store.dispatch(realtimeStopped());
    await flush();
    expect(source().closed).toBe(true);
    expect(store.getState().realtime.status).toBe("idle");
  });

  it("feedback.created refetches the list while it is followed, otherwise queues it behind the pill", async () => {
    const store = testStore();
    const args = listArgs({}, "list");
    const sub = store.dispatch(api.endpoints.listFeedback.initiate(args));
    await sub;
    store.dispatch(realtimeStarted());
    await flush();
    source().open();
    const created = {
      id: F,
      projectId: P,
      number: 9,
      kind: "bug",
      status: "open",
      priority: "none",
      title: "New",
      createdAt: "x",
    };
    source().emit("feedback.created", created, "w1.1");
    await flush();
    expect(lists).toBe(2);
    expect(store.getState().realtime.fresh).toEqual([F]);
    expect(store.getState().realtime.lastEventId).toBe("w1.1");

    store.dispatch(followChanged(false));
    const other = { ...created, id: "44444444-4444-4444-8444-444444444444" };
    source().emit("feedback.created", other, "w1.2");
    await flush();
    expect(lists).toBe(2);
    expect(store.getState().realtime.pending.map((p) => p.id)).toEqual([other.id]);

    store.dispatch(newItemsShown());
    await flush();
    expect(lists).toBe(3);
    expect(store.getState().realtime.pending).toEqual([]);
    sub.unsubscribe();
  });

  it("feedback.updated patches the cached row in place", async () => {
    const store = testStore();
    const args = listArgs({}, "list");
    const sub = store.dispatch(api.endpoints.listFeedback.initiate(args));
    await sub;
    store.dispatch(realtimeStarted());
    await flush();
    source().emit("feedback.updated", {
      id: F,
      projectId: P,
      changes: { priority: { from: "none", to: "urgent" } },
    });
    await flush();
    expect(rowsOf(api.endpoints.listFeedback.select(args)(store.getState()).data)?.[0]?.priority).toBe(
      "urgent",
    );
    sub.unsubscribe();
  });

  it("comment.created bumps the comment count; feedback.deleted removes the row", async () => {
    const store = testStore();
    const args = listArgs({}, "list");
    const sub = store.dispatch(api.endpoints.listFeedback.initiate(args));
    await sub;
    store.dispatch(realtimeStarted());
    await flush();
    source().emit("comment.created", {
      id: F,
      feedbackId: F,
      projectId: P,
      visibility: "public",
      authorName: "Dana",
    });
    await flush();
    expect(rowsOf(api.endpoints.listFeedback.select(args)(store.getState()).data)?.[0]?.commentCount).toBe(1);
    source().emit("comment.deleted", { id: F, feedbackId: F, projectId: P });
    await flush();
    expect(rowsOf(api.endpoints.listFeedback.select(args)(store.getState()).data)?.[0]?.commentCount).toBe(0);
    source().emit("feedback.deleted", { id: F, projectId: P });
    await flush();
    expect(rowsOf(api.endpoints.listFeedback.select(args)(store.getState()).data)).toEqual([]);
    sub.unsubscribe();
  });

  it("ignores malformed events", async () => {
    const store = testStore();
    store.dispatch(realtimeStarted());
    await flush();
    source().emit("feedback.created", { id: "not-a-uuid" });
    await flush();
    expect(store.getState().realtime.pending).toEqual([]);
    expect(store.getState().realtime.fresh).toEqual([]);
  });

  it("presence events record who is looking", async () => {
    const store = testStore();
    store.dispatch(realtimeStarted());
    await flush();
    source().emit("presence", {
      feedbackId: F,
      projectId: P,
      users: [{ id: "u2", name: "Bo", image: null }],
    });
    await flush();
    expect(store.getState().realtime.presence[F]?.[0]?.name).toBe("Bo");
  });

  it("reopens a closed stream with backoff and Last-Event-ID, then resyncs the lists", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const store = testStore();
    const args = listArgs({}, "list");
    const sub = store.dispatch(api.endpoints.listFeedback.initiate(args));
    await vi.runAllTimersAsync();
    store.dispatch(realtimeStarted());
    await vi.advanceTimersByTimeAsync(0);
    source().open();
    source().emit("presence", { feedbackId: F, projectId: P, users: [] }, "w1.7");
    source().fail();
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeEventSource.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(source().url).toBe(`${API}/stream?lastEventId=w1.7`);
    const before = lists;
    source().open();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().realtime.status).toBe("open");
    expect(lists).toBe(before + 1);
    store.dispatch(realtimeStopped());
    sub.unsubscribe();
  });
});

describe("presence heartbeat", () => {
  it("posts the open item every 20 s and null when it closes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const posted: unknown[] = [];
    mockFetch(async (req) => {
      posted.push(await req.json());
      return json({ ok: true });
    });
    const store = testStore();
    store.dispatch(presenceWatched(F));
    await vi.advanceTimersByTimeAsync(0);
    expect(posted).toEqual([{ feedbackId: F }]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(posted).toHaveLength(2);
    store.dispatch(presenceWatched(null));
    await vi.advanceTimersByTimeAsync(0);
    expect(posted.at(-1)).toEqual({ feedbackId: null });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(posted).toHaveLength(3);
  });
});
