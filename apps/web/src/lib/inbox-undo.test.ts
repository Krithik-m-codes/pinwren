import { describe, expect, it } from "vitest";
import type { FeedbackRow } from "@/lib/api";
import { undoChanges } from "./inbox-undo";

const row = (id: string, over: Partial<FeedbackRow>): FeedbackRow => ({
  id,
  number: 1,
  kind: "bug",
  status: "open",
  priority: "none",
  title: null,
  body: "x",
  assigneeIds: [],
  reporterGuest: null,
  createdAt: "2026-10-01T00:00:00Z",
  projectId: "p",
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
  ...over,
});

describe("bulk undo", () => {
  it("restores each item's own previous value", () => {
    const rows = [row("a", { status: "open" }), row("b", { status: "in_review", priority: "high" })];
    expect(undoChanges(rows, ["a", "b"], { status: "resolved" })).toEqual([
      { id: "a", patch: { status: "open" } },
      { id: "b", patch: { status: "in_review" } },
    ]);
    expect(undoChanges(rows, ["b"], { priority: "low", assigneeIds: ["u"] })).toEqual([
      { id: "b", patch: { priority: "high", assigneeIds: [] } },
    ]);
  });

  it("puts labels back with their names for the optimistic rows", () => {
    const labels = [{ id: "l1", name: "checkout", color: "#e5484d" }];
    expect(undoChanges([row("a", { labels })], ["a", "gone"], { labelIds: [] })).toEqual([
      { id: "a", patch: { labelIds: ["l1"] }, optimistic: { labels } },
    ]);
  });
});
