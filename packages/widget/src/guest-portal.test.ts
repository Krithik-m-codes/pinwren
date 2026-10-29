import { describe, expect, it } from "vitest";
import { guestPortalUrl } from "./guest-portal";

const token = "reporter_token_0123456789";
describe("guest portal URL", () => {
  it("encodes the project key and keeps tokens out of the query", () => {
    const url = new URL(
      guestPortalUrl("https://feedback.example/base///?old=1#old", "pk /?", [{ id: "a", token }]) ??
        "https://missing.example",
    );
    expect(url.pathname).toBe("/base/guest/pk%20%2F%3F");
    expect(url.search).toBe("");
    expect(JSON.parse(decodeURIComponent(url.hash.slice(8)))).toEqual({
      reporterTokens: [token],
      pageTokens: [],
    });
  });
  it("filters malformed, temporary and duplicate credentials before capping at 50", () => {
    const entries = [
      null,
      {},
      { id: "tmp:a", token },
      { id: "x", token: 123 },
      { id: "x", token: "short" },
      { id: "x", token: "a".repeat(129) },
      { id: "x", token: "bad token_0123456789" },
      { id: "a", token },
      { id: "b", token },
      ...Array.from({ length: 60 }, (_, i) => ({
        id: String(i),
        token: `reporter_token_${String(i).padStart(3, "0")}`,
      })),
    ];
    const url = new URL(guestPortalUrl("http://localhost:3100/", "pk", entries) ?? "https://missing.example");
    const access = JSON.parse(decodeURIComponent(url.hash.slice(8))) as {
      reporterTokens: string[];
      pageTokens: string[];
    };
    expect(access.reporterTokens).toHaveLength(50);
    expect(access.reporterTokens[0]).toBe(token);
    expect(access.reporterTokens[49]).toBe("reporter_token_048");
    expect(access.pageTokens).toEqual([]);
  });
  it("omits the entry for invalid endpoints and absent valid credentials", () => {
    for (const endpoint of [
      "javascript:alert(1)",
      "data:text/html,hello",
      "//external.example",
      "not a url",
      "https://user:password@feedback.example",
    ]) {
      expect(guestPortalUrl(endpoint, "pk", [{ id: "a", token }])).toBeNull();
    }
    expect(guestPortalUrl("https://feedback.example", "pk", [{ id: "a" }])).toBeNull();
  });
});
