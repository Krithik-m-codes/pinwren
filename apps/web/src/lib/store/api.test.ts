import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeedbackList, FeedbackRow, ProjectDetail } from "@/lib/api";
import { listArgs } from "@/lib/inbox-filters";
import { api } from "./api";
import { applyProjectPatch } from "./api/projects";
import { flush, json, mockFetch, problem, testStore } from "./test-utils";

afterEach(() => vi.unstubAllGlobals());

const row = (id: string, over: Partial<FeedbackRow> = {}): FeedbackRow => ({
  id,
  number: 1,
  kind: "bug",
  status: "open",
  priority: "none",
  title: null,
  body: "Broken",
  assigneeIds: [],
  reporterGuest: null,
  createdAt: "2026-10-01T00:00:00Z",
  projectId: "p1",
  projectName: "Site",
  pageUrl: null,
  roundId: null,
  hasScreenshot: false,
  hasReplay: false,
  attachmentCount: 0,
  commentCount: 0,
  ...over,
});
const list = (...items: FeedbackRow[]): FeedbackList => ({ items, nextCursor: null });

describe("RTK Query endpoints", () => {
  it("lists feedback with the filters as a sorted query string", async () => {
    const { calls } = mockFetch(() => json(list(row("f1"))));
    const store = testStore();
    const args = listArgs({ projectId: "11111111-1111-4111-8111-111111111111", priority: "high" }, "list");
    const res = await store.dispatch(api.endpoints.listFeedback.initiate(args));
    expect(res.data?.items[0]?.id).toBe("f1");
    expect(calls[0]?.path).toBe(
      "/feedback?limit=100&priority=high&projectId=11111111-1111-4111-8111-111111111111&status=active",
    );
  });

  it("turns problem-details answers into { status, code, message }", async () => {
    mockFetch(() => problem(403, "READ_ONLY_ROLE", "Your role (viewer) can read but not change anything"));
    const store = testStore();
    const res = await store.dispatch(
      api.endpoints.updateFeedback.initiate({ ids: ["f1"], patch: { status: "resolved" } }),
    );
    expect("error" in res && res.error).toEqual({
      status: 403,
      code: "READ_ONLY_ROLE",
      message: "Your role (viewer) can read but not change anything",
    });
  });

  it("updates feedback optimistically in every cached list and detail", async () => {
    let release: (r: Response) => void = () => undefined;
    mockFetch((req) => {
      if (req.method === "PATCH") return new Promise<Response>((r) => (release = r));
      return json(list(row("f1"), row("f2")));
    });
    const store = testStore();
    const args = listArgs({}, "list");
    await store.dispatch(api.endpoints.listFeedback.initiate(args));
    const pending = store.dispatch(
      api.endpoints.updateFeedback.initiate({ ids: ["f1"], patch: { status: "resolved" } }),
    );
    await flush();
    const now = api.endpoints.listFeedback.select(args)(store.getState()).data;
    expect(now?.items.find((i) => i.id === "f1")?.status).toBe("resolved");
    expect(now?.items.find((i) => i.id === "f2")?.status).toBe("open");
    release(json({ feedback: { id: "f1" } }));
    await pending;
  });

  it("rolls the optimistic change back when the API refuses", async () => {
    mockFetch((req) =>
      req.method === "PATCH" ? problem(409, "CONFLICT", "Changed meanwhile") : json(list(row("f1"))),
    );
    const store = testStore();
    const args = listArgs({}, "list");
    await store.dispatch(api.endpoints.listFeedback.initiate(args));
    await store.dispatch(
      api.endpoints.updateFeedback.initiate({ ids: ["f1"], patch: { priority: "urgent" } }),
    );
    await flush();
    expect(api.endpoints.listFeedback.select(args)(store.getState()).data?.items[0]?.priority).toBe("none");
  });

  it("sends one PATCH per item for bulk changes and refetches the lists afterwards", async () => {
    const { calls } = mockFetch((req) =>
      req.method === "PATCH" ? json({}) : json(list(row("a"), row("b"))),
    );
    const store = testStore();
    const args = listArgs({}, "list");
    const sub = store.dispatch(api.endpoints.listFeedback.initiate(args));
    await sub;
    await store.dispatch(
      api.endpoints.updateFeedback.initiate({ ids: ["a", "b"], patch: { assigneeIds: ["u1"] } }),
    );
    await flush();
    expect(calls.filter((c) => c.method === "PATCH").map((c) => c.path)).toEqual([
      "/feedback/a",
      "/feedback/b",
    ]);
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(2);
    sub.unsubscribe();
  });

  it("removes deleted items from cached lists", async () => {
    mockFetch((req) =>
      req.method === "DELETE" ? new Response(null, { status: 204 }) : json(list(row("a"), row("b"))),
    );
    const store = testStore();
    const args = listArgs({}, "list");
    await store.dispatch(api.endpoints.listFeedback.initiate(args));
    const n = await store.dispatch(api.endpoints.deleteFeedback.initiate(["a"])).unwrap();
    expect(n).toBe(1);
    expect(
      api.endpoints.listFeedback
        .select(args)(store.getState())
        .data?.items.map((i) => i.id),
    ).toEqual(["b"]);
  });

  it("marks notifications read at once and keeps the count right", async () => {
    let release: (r: Response) => void = () => undefined;
    mockFetch((req) => {
      if (req.method === "POST") return new Promise<Response>((r) => (release = r));
      return json({
        items: [
          { id: "n1", type: "feedback.created", feedbackId: null, data: {}, readAt: null, createdAt: "x" },
          { id: "n2", type: "feedback.created", feedbackId: null, data: {}, readAt: null, createdAt: "x" },
        ],
        unreadCount: 2,
      });
    });
    const store = testStore();
    await store.dispatch(api.endpoints.notifications.initiate(undefined));
    const p = store.dispatch(api.endpoints.markNotificationsRead.initiate({ ids: ["n1"] }));
    await flush();
    const data = api.endpoints.notifications.select(undefined)(store.getState()).data;
    expect(data?.unreadCount).toBe(1);
    expect(data?.items[0]?.readAt).not.toBeNull();
    release(json({ updated: 1 }));
    await p;
  });

  it("derives the pages view from up to five pages of the project's feedback", async () => {
    const { calls } = mockFetch((_req, url) =>
      url.searchParams.get("cursor")
        ? json({ items: [row("b")], nextCursor: null })
        : json({ items: [row("a")], nextCursor: "c1" }),
    );
    const store = testStore();
    const res = await store.dispatch(api.endpoints.projectFeedback.initiate("p1"));
    expect(res.data?.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(calls).toHaveLength(2);
  });

  it("sends one project PATCH at a time, in order", async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    mockFetch(async (req) => {
      const body = (await req.clone().json()) as { name: string };
      order.push(`start ${body.name}`);
      if (body.name === "first") await new Promise<void>((r) => (release = r));
      order.push(`end ${body.name}`);
      return json({ project: { id: "p1", name: body.name } });
    });
    const store = testStore();
    const a = store.dispatch(api.endpoints.updateProject.initiate({ id: "p1", patch: { name: "first" } }));
    const b = store.dispatch(api.endpoints.updateProject.initiate({ id: "p1", patch: { name: "second" } }));
    await flush();
    expect(order).toEqual(["start first"]);
    release();
    await Promise.all([a, b]);
    expect(order).toEqual(["start first", "end first", "start second", "end second"]);
  });

  it("merges a project patch the way the API does (deep, partial configs)", () => {
    const p = {
      archivedAt: null,
      widgetConfig: { launcher: { position: "bottom-right", accent: "#000000" }, readOnly: false },
      captureConfig: { replay: { enabled: false, seconds: 60 } },
      widgetBranding: { hidePoweredBy: false },
    } as unknown as ProjectDetail;
    const next = applyProjectPatch(
      p,
      {
        widgetConfig: { launcher: { accent: "#ffffff" } },
        captureConfig: { replay: { enabled: true } },
        archived: true,
      },
      new Date("2026-10-22T00:00:00Z"),
    );
    expect(next.widgetConfig.launcher).toMatchObject({ position: "bottom-right", accent: "#ffffff" });
    expect(next.captureConfig.replay).toEqual({ enabled: true, seconds: 60 });
    expect(next.archivedAt).toBe("2026-10-22T00:00:00.000Z");
  });
});
