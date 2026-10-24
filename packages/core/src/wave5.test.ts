import { describe, expect, it } from "vitest";
import { parseWidgetConfig, widgetConfig } from "./config";
import { appRoleOf, memberCreate, ORG_ROLE_FOR, roleCan } from "./roles";
import {
  annotationLayer,
  captureGeometry,
  commentCreate,
  emailSettingsUpdate,
  feedbackListQuery,
  feedbackUpdate,
  labelCreate,
  MAX_ANNOTATION_BYTES,
  notificationPreferenceInput,
  notificationsRead,
  projectNotifications,
  projectNotificationsUpdate,
  reviewLinkCreate,
  userPreferenceUpdate,
  widgetFeedbackCreate,
} from "./schemas";

// Wave-5 shared contract (docs/contracts/wave-5.md).

const uuid = "0b0e6f1c-1a7e-4a5e-9a51-6f0c3b1f8e2d";

describe("annotation layer + capture geometry", () => {
  const layer = {
    v: 1,
    width: 1280,
    height: 720,
    shapes: [
      { tool: "rect", color: "#e5484d", size: "m", a: { x: 1, y: 2 }, b: { x: 30, y: 40 } },
      { tool: "highlighter", color: "#f5a524", size: "l", points: [{ x: 1, y: 1 }] },
      { tool: "text", color: "#18181b", size: "s", at: { x: 5, y: 5 }, text: "here", px: 24 },
      { tool: "step", color: "#0090ff", size: "m", at: { x: 9, y: 9 }, n: 1 },
    ],
  };

  it("accepts every tool", () => {
    expect(annotationLayer.parse(layer).shapes).toHaveLength(4);
  });

  it("refuses unknown tools, bad colours and non-finite points", () => {
    const bad = (shape: unknown) => annotationLayer.safeParse({ ...layer, shapes: [shape] }).success;
    expect(bad({ tool: "laser", color: "#fff", size: "m", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } })).toBe(
      false,
    );
    expect(bad({ tool: "rect", color: "red", size: "m", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } })).toBe(false);
    expect(bad({ tool: "pen", color: "#fff", size: "m", points: [{ x: Number.NaN, y: 0 }] })).toBe(false);
  });

  it("caps the serialised size", () => {
    const text = {
      tool: "text",
      color: "#fff",
      size: "m",
      at: { x: 0, y: 0 },
      text: "x".repeat(500),
      px: 12,
    };
    const big = { ...layer, shapes: Array.from({ length: 200 }, () => text) };
    expect(JSON.stringify(big).length).toBeGreaterThan(MAX_ANNOTATION_BYTES);
    expect(annotationLayer.safeParse(big).success).toBe(false);
  });

  it("travels with a bug report", () => {
    const report = {
      clientId: uuid,
      kind: "bug",
      body: "Broken",
      page: { url: "https://example.com/" },
      environment: { userAgent: "x", viewport: { w: 390, h: 844 }, dpr: 3 },
      annotations: layer,
      capture: { vw: 390, vh: 844, scrollY: 120, mode: "visible" },
    };
    const out = widgetFeedbackCreate.parse(report);
    expect(out.capture?.mode).toBe("visible");
    expect(captureGeometry.safeParse({ vw: 0, vh: 1, scrollY: 0, mode: "visible" }).success).toBe(false);
    expect(captureGeometry.safeParse({ vw: 1, vh: 1, scrollY: 0, mode: "tab" }).success).toBe(false);
  });
});

describe("triage schemas", () => {
  it("accepts labels, due date, duplicate and kind on update", () => {
    const p = feedbackUpdate.parse({
      labelIds: [uuid],
      dueAt: "2026-11-01T12:00:00+02:00",
      duplicateOfId: null,
      kind: "idea",
    });
    expect(p).toEqual({
      labelIds: [uuid],
      dueAt: "2026-11-01T12:00:00+02:00",
      duplicateOfId: null,
      kind: "idea",
    });
    expect(feedbackUpdate.safeParse({ dueAt: "tomorrow" }).success).toBe(false);
  });

  it("parses the new list filters from a query string", () => {
    const q = feedbackListQuery.parse({ labelId: uuid, hasReplay: "1", trash: "false", browser: " Safari " });
    expect(q).toMatchObject({ labelId: uuid, hasReplay: true, trash: false, browser: "Safari" });
    expect(q.sort).toBe("created");
    expect(q.order).toBe("desc");
    expect(feedbackListQuery.parse({ sort: "priority", order: "asc" })).toMatchObject({
      sort: "priority",
      order: "asc",
    });
    expect(feedbackListQuery.safeParse({ sort: "random" }).success).toBe(false);
    expect(feedbackListQuery.safeParse({ trash: "yes" }).success).toBe(false);
  });

  it("validates labels", () => {
    expect(labelCreate.parse({ name: " Regression ", color: "#e5484d" }).name).toBe("Regression");
    expect(labelCreate.safeParse({ name: "", color: "#e5484d" }).success).toBe(false);
    expect(labelCreate.safeParse({ name: "x", color: "blue" }).success).toBe(false);
  });

  it("accepts mentions on a team comment, capped", () => {
    expect(commentCreate.parse({ body: "@Dana look", mentions: ["u1"] }).mentions).toEqual(["u1"]);
    expect(commentCreate.parse({ body: "hi" }).mentions).toBeUndefined();
    expect(
      commentCreate.safeParse({ body: "x", mentions: Array.from({ length: 21 }, (_, i) => `u${i}`) }).success,
    ).toBe(false);
  });
});

describe("notifications + email settings", () => {
  it("marks one item's notifications read", () => {
    expect(notificationsRead.parse({ feedbackId: uuid })).toEqual({ feedbackId: uuid });
    expect(notificationsRead.safeParse({ feedbackId: "nope" }).success).toBe(false);
  });

  it("has mention and priority switches, and account-wide digest settings", () => {
    expect(
      notificationPreferenceInput.parse({ projectId: uuid, mentioned: false, priorityChanges: true }),
    ).toMatchObject({ mentioned: false, priorityChanges: true });
    expect(userPreferenceUpdate.parse({ emailDigest: "daily", emailPaused: true })).toEqual({
      emailDigest: "daily",
      emailPaused: true,
    });
    expect(userPreferenceUpdate.safeParse({ emailDigest: "weekly" }).success).toBe(false);
  });

  it("takes the STARTTLS and self-signed switches", () => {
    expect(emailSettingsUpdate.parse({ requireTls: true, allowSelfSigned: null })).toEqual({
      requireTls: true,
      allowSelfSigned: null,
    });
  });
});

describe("visibility + safer defaults", () => {
  it("defaults to always visible and visitors can't resolve", () => {
    const c = parseWidgetConfig({});
    expect(c.visibility.mode).toBe("always");
    expect(c.visibility.urlPatterns).toEqual([]);
    expect(c.visitorsCanResolve).toBe(false);
  });

  it("keeps a stored mode and falls back on a broken one", () => {
    expect(
      parseWidgetConfig({ visibility: { mode: "urlPatterns", urlPatterns: ["/staging/*"] } }).visibility,
    ).toMatchObject({ mode: "urlPatterns", urlPatterns: ["/staging/*"], environments: "all" });
    expect(
      parseWidgetConfig({ visibility: { mode: "sometimes", minViewportWidth: 600 } }).visibility,
    ).toMatchObject({
      mode: "always",
      minViewportWidth: 600,
    });
    expect(widgetConfig.safeParse({ visibility: { queryParam: "has space" } }).success).toBe(false);
  });

  it("validates review links", () => {
    expect(
      reviewLinkCreate.parse({ label: "Client", url: "https://staging.example.com/" }).expiresInDays,
    ).toBeUndefined();
    expect(reviewLinkCreate.safeParse({ label: "Client", url: "javascript:alert(1)" }).success).toBe(false);
    expect(reviewLinkCreate.safeParse({ label: "x", url: "https://a.com", expiresInDays: 0 }).success).toBe(
      false,
    );
  });
});

describe("BugPin roles", () => {
  it("maps stored organisation roles onto Admin / Editor / Viewer", () => {
    expect(appRoleOf("owner")).toBe("admin");
    expect(appRoleOf("admin")).toBe("admin");
    expect(appRoleOf("member")).toBe("editor");
    expect(appRoleOf("viewer")).toBe("viewer");
    expect(appRoleOf("viewer, member")).toBe("editor");
    expect(appRoleOf("member,admin")).toBe("admin");
    expect(ORG_ROLE_FOR).toEqual({ admin: "admin", editor: "member", viewer: "viewer" });
  });

  it("lets Editors triage but not delete or change settings", () => {
    expect(roleCan("member", "feedback.update")).toBe(true);
    expect(roleCan("member", "feedback.create")).toBe(true);
    expect(roleCan("member", "feedback.delete")).toBe(false);
    expect(roleCan("member", "settings.manage")).toBe(false);
    expect(roleCan("member", "users.manage")).toBe(false);
    expect(roleCan("owner", "feedback.delete")).toBe(true);
    expect(roleCan("viewer", "feedback.read")).toBe(true);
    expect(roleCan("viewer", "feedback.comment")).toBe(false);
  });

  it("validates Add User", () => {
    const ok = { name: "Dana", email: "dana@example.com", password: "12345678", role: "editor" };
    expect(memberCreate.parse(ok).role).toBe("editor");
    expect(memberCreate.safeParse({ ...ok, password: "1234567" }).success).toBe(false);
    expect(memberCreate.safeParse({ ...ok, role: "owner" }).success).toBe(false);
    expect(memberCreate.safeParse({ ...ok, name: "  " }).success).toBe(false);
  });
});

describe("project notifications (Notifications › General / Reporter)", () => {
  it("accepts recipients and reporter switches", () => {
    const v = projectNotifications.parse({
      memberIds: null,
      emails: ["qa@example.com"],
      reporter: {
        enabled: true,
        received: true,
        statusChanged: true,
        priorityChanged: false,
        assigned: false,
      },
    });
    expect(v.emails).toEqual(["qa@example.com"]);
  });

  it("patches any subset and refuses bad addresses", () => {
    expect(projectNotificationsUpdate.parse({ reporter: { assigned: true } })).toEqual({
      reporter: { assigned: true },
    });
    expect(projectNotificationsUpdate.safeParse({ emails: ["not-an-email"] }).success).toBe(false);
    expect(
      projectNotificationsUpdate.safeParse({ emails: Array.from({ length: 21 }, (_, i) => `a${i}@x.io`) })
        .success,
    ).toBe(false);
  });
});
