import { describe, expect, it } from "vitest";
import {
  exportUrl,
  extraFilterCount,
  filtersFromParams,
  inboxArgsFromParams,
  layoutFromParams,
  listQueryString,
  paramsForFilters,
  sameFilters,
} from "./inbox-filters";

const P = "11111111-1111-4111-8111-111111111111";
const sp = (s: string) => new URLSearchParams(s);

describe("inbox filters in the URL", () => {
  it("parses known filters and drops invalid ones", () => {
    expect(
      filtersFromParams(sp(`project=${P}&priority=high&kind=nope&round=x&q=checkout&status=all`)),
    ).toEqual({
      projectId: P,
      priority: "high",
      q: "checkout",
      status: "all",
    });
  });

  it("defaults the status tab and shows every status on the board", () => {
    expect(inboxArgsFromParams(sp(""))).toEqual({ status: "active", limit: 50 });
    expect(inboxArgsFromParams(sp("layout=board&status=resolved"))).toMatchObject({
      status: "all",
      limit: 100,
    });
    expect(layoutFromParams(sp("view=board"))).toBe("board");
  });

  it("reads labels, reporter, order and the trash", () => {
    const L = "22222222-2222-4222-8222-222222222222";
    expect(filtersFromParams(sp(`label=${L}&reporter=dana&sort=priority&order=asc&sort2=x`))).toEqual({
      labelId: L,
      reporter: "dana",
      sort: "priority",
      order: "asc",
    });
    expect(filtersFromParams(sp("sort=random&label=nope"))).toEqual({});
    expect(inboxArgsFromParams(sp("trash=1&status=open"))).toEqual({ status: "all", limit: 50, trash: true });
    expect(extraFilterCount({ labelId: L, reporter: "x", sort: "updated" })).toBe(2);
  });

  it("builds export URLs from the list query, or for a selection", () => {
    const args = inboxArgsFromParams(sp(`project=${P}&priority=high`));
    expect(exportUrl(args, "csv")).toBe(
      `/api/feedback/export?format=csv&priority=high&projectId=${P}&status=active`,
    );
    expect(exportUrl(args, "json", ["a", "b"])).toBe(
      `/api/feedback/export?format=json&ids=a%2Cb&priority=high&projectId=${P}&status=all`,
    );
  });

  it("round-trips through search params and compares filter sets", () => {
    const f = { projectId: P, assigneeId: "u1", page: "/pricing" };
    const back = paramsForFilters(f, "board");
    expect(back.get("layout")).toBe("board");
    expect(sameFilters(filtersFromParams(back), f)).toBe(true);
    expect(sameFilters(f, { ...f, page: "/" })).toBe(false);
    expect(extraFilterCount(f)).toBe(2);
  });

  it("serialises list queries with sorted keys", () => {
    expect(listQueryString({ status: "active", limit: 100, projectId: undefined, q: "" })).toBe(
      "limit=100&status=active",
    );
  });
});

describe("review link filter (wave 5)", () => {
  it("reads `review`, counts it as a narrowing filter and round-trips it", () => {
    const f = filtersFromParams(sp(`project=${P}&review=${P}`));
    expect(f).toEqual({ projectId: P, reviewLinkId: P });
    expect(extraFilterCount(f)).toBe(1);
    expect(paramsForFilters(f).get("review")).toBe(P);
    expect(filtersFromParams(sp("review=not-a-uuid"))).toEqual({});
    expect(inboxArgsFromParams(sp(`review=${P}`)).reviewLinkId).toBe(P);
  });
});
