import { ISSUE_PROVIDERS } from "@pinwren/core";
import { describe, expect, it } from "vitest";
import { issueRef, TRACKER_NAMES, trackerName } from "./tracker-icon";

describe("tracker names and references", () => {
  it("names every provider", () => {
    for (const p of ISSUE_PROVIDERS) expect(TRACKER_NAMES[p], p).toBeTruthy();
    expect(trackerName("clickup")).toBe("ClickUp");
    expect(trackerName("nope")).toBeNull();
  });

  it("refers to numbered items by number, keyed ones by key, and numberless ones by nothing", () => {
    expect(issueRef({ provider: "github", number: 12 })).toBe("#12");
    expect(issueRef({ provider: "trello", number: 42 })).toBe("#42");
    expect(issueRef({ provider: "jira", number: 7, url: "https://acme.atlassian.net/browse/WEB-7" })).toBe(
      "WEB-7",
    );
    expect(issueRef({ provider: "linear", number: 12, key: "ENG-12" })).toBe("ENG-12");
    for (const provider of ["asana", "clickup", "notion"]) {
      expect(issueRef({ provider, number: null, url: "https://example.test/x" })).toBe("");
    }
  });
});
