import { describe, expect, it } from "vitest";
import {
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
    expect(inboxArgsFromParams(sp(""))).toEqual({ status: "active", limit: 100 });
    expect(inboxArgsFromParams(sp("layout=board&status=resolved")).status).toBe("all");
    expect(layoutFromParams(sp("view=board"))).toBe("board");
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
