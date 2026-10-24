import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DESKTOP_KEY, setDesktopEnabled, showDesktopNotification } from "@/lib/desktop-notifications";
import { notificationHref, notificationSubject, notificationText } from "@/lib/notification-text";
import { api } from "./api";
import { notificationsQueryString } from "./api/notifications";
import { realtimeStarted } from "./slices/realtime";
import { FakeEventSource, flush, json, mockFetch, testStore } from "./test-utils";

// Wave 5, notifications (docs/contracts/wave-5.md §3.2): the bell refetches on the per-user
// `notification.created` stream event (not on raw feedback events), and what a notification says.

const F = "33333333-3333-4333-8333-333333333333";

describe("notification wording", () => {
  it("names the kind and who sent it", () => {
    const data = {
      actorName: "Maria",
      kind: "bug",
      number: 42,
      title: "Pay button dead",
      projectName: "Shop",
    };
    expect(notificationText({ type: "feedback.created", data })).toBe("New bug report from Maria");
    expect(notificationText({ type: "feedback.created", data: { kind: "idea" } })).toBe("New change request");
    expect(notificationText({ type: "comment.mentioned", data })).toBe("Maria mentioned you");
    expect(notificationText({ type: "feedback.status_changed", data: { ...data, status: "wont_fix" } })).toBe(
      "Maria marked it won't fix",
    );
    expect(
      notificationText({ type: "feedback.priority_changed", data: { ...data, priority: "urgent" } }),
    ).toBe("Maria set priority to urgent");
    expect(notificationText({ type: "webhook.disabled", data: { name: "Slack #bugs" } })).toBe(
      "Webhook “Slack #bugs” was disabled",
    );
    expect(notificationSubject({ type: "feedback.created", data })).toBe("#42 Pay button dead");
  });

  it("links to the item, switching workspace when asked, or to the integrations", () => {
    expect(notificationHref({ type: "comment.created", feedbackId: F, data: {} })).toBe(
      `/inbox?status=all&item=${F}`,
    );
    expect(notificationHref({ type: "comment.created", feedbackId: F, data: {} }, "org 1")).toBe(
      `/inbox?status=all&org=org%201&item=${F}`,
    );
    expect(notificationHref({ type: "webhook.disabled", feedbackId: null, data: { webhookId: "w1" } })).toBe(
      "/settings/integrations?webhook=w1",
    );
  });

  it("builds the notifications page query", () => {
    expect(notificationsQueryString({ unread: true, projectId: "p1" }, "c1")).toBe(
      "limit=30&unread=1&projectId=p1&before=c1",
    );
    expect(notificationsQueryString({ unread: false, projectId: null }, null)).toBe("limit=30");
  });
});

describe("bell and the stream", () => {
  let fetched = 0;
  beforeEach(() => {
    fetched = 0;
    mockFetch((_req, url) => {
      if (url.pathname === "/api/notifications") {
        fetched++;
        return json({ items: [], unreadCount: fetched - 1 });
      }
      return json({});
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refetches on notification.created, not on feedback.created", async () => {
    const store = testStore();
    const sub = store.dispatch(api.endpoints.notifications.initiate(undefined));
    await sub;
    expect(fetched).toBe(1);
    store.dispatch(realtimeStarted());
    await flush();
    const es = FakeEventSource.instances.at(-1);
    if (!es) throw new Error("no stream");
    es.open();
    es.emit("feedback.created", {
      id: F,
      projectId: F,
      number: 1,
      kind: "bug",
      status: "open",
      priority: "none",
      title: null,
      createdAt: "x",
    });
    await flush();
    expect(fetched).toBe(1);
    es.emit("notification.created", {
      id: F,
      type: "feedback.created",
      feedbackId: F,
      orgId: "o1",
      data: { actorName: "Maria", kind: "bug" },
      createdAt: "2026-10-22T10:00:00.000Z",
    });
    await flush();
    expect(fetched).toBe(2);
    sub.unsubscribe();
  });
});

describe("desktop notifications", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    try {
      localStorage.removeItem(DESKTOP_KEY);
    } catch {
      // no storage in this environment
    }
  });

  it("stays off without browser support and never throws", async () => {
    expect(await setDesktopEnabled(true)).toBe("unsupported");
    expect(() => showDesktopNotification({ id: "1", title: "t", body: "b", href: "/" })).not.toThrow();
  });
});
