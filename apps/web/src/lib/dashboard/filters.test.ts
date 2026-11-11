import { describe, expect, it } from "vitest";
import { dateToDay, dayToDate, filtersPatch, hasFilters, parseFilters, statsArgs } from "./filters";

const id = "b3c1b2c0-5d1e-4c3a-9a77-0f6b1f0d9a11";
const q = (s: string) => parseFilters(new URLSearchParams(s));

describe("dashboard filters", () => {
  it("reads project, label, assignee and range from the URL and ignores malformed values", () => {
    expect(q(`project=${id}&label=${id}&assignee=me&from=2026-03-01&to=2026-03-31`)).toEqual({
      projectId: id,
      labelId: id,
      assigneeId: "me",
      from: "2026-03-01",
      to: "2026-03-31",
    });
    expect(q("project=nope&label=1&from=yesterday&to=2026-03-01")).toEqual({});
    expect(q("from=2026-03-05&to=2026-03-01")).toEqual({ from: "2026-03-05" });
    expect(q("to=2026-03-01")).toEqual({});
    expect(hasFilters(q(""))).toBe(false);
  });

  it("builds URL patches: a new project clears the old label, no start clears the end", () => {
    expect(filtersPatch({ projectId: id })).toEqual({ project: id, label: null });
    expect(filtersPatch({ projectId: id, labelId: id })).toEqual({ project: id, label: id });
    expect(filtersPatch({ assigneeId: null })).toEqual({ assignee: null });
    expect(filtersPatch({ from: null })).toEqual({ from: null, to: null });
  });

  it("builds stats arguments; a screen's own project wins over the filter", () => {
    expect(statsArgs(30, {})).toEqual({ days: 30 });
    expect(
      statsArgs(14, { projectId: id, assigneeId: "none", from: "2026-03-01", to: "2026-03-02" }),
    ).toEqual({
      days: 14,
      projectId: id,
      assigneeId: "none",
      from: "2026-03-01",
      to: "2026-03-02",
    });
    expect(statsArgs(14, { projectId: id }, "other")).toMatchObject({ projectId: "other" });
  });

  it("converts between days and local dates", () => {
    expect(dateToDay(dayToDate("2026-03-09"))).toBe("2026-03-09");
  });
});
