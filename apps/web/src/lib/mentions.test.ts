import { describe, expect, it } from "vitest";
import { insertMention, matchMembers, mentionParts, mentionQuery, mentionsIn } from "./mentions";

describe("@mentions", () => {
  it("finds the query the caret is in", () => {
    expect(mentionQuery("hi @da")).toBe("da");
    expect(mentionQuery("@")).toBe("");
    expect(mentionQuery("mail me at a@b")).toBeNull();
    expect(mentionQuery("hi @dana ")).toBeNull();
  });

  it("inserts the name and moves the caret after it", () => {
    expect(insertMention("hi @da tail", 6, "Dana Lee")).toEqual({ text: "hi @Dana Lee  tail", caret: 13 });
  });

  it("sends only mentions still in the text", () => {
    const picked = new Map([
      ["u1", "Dana Lee"],
      ["u2", "Sam"],
    ]);
    expect(mentionsIn("thanks @Dana Lee!", picked)).toEqual(["u1"]);
  });

  it("matches members by word start first, then anywhere", () => {
    const m = [
      { id: "1", name: "Sam Ortiz", email: "sam@x.dev" },
      { id: "2", name: "Dana Lee", email: "dana@x.dev" },
      { id: "3", name: "Lisa", email: "lisa@x.dev" },
    ];
    expect(matchMembers(m, "le").map((x) => x.id)).toEqual(["2"]);
    expect(matchMembers(m, "sa").map((x) => x.id)).toEqual(["1", "3"]);
    expect(matchMembers(m, "")).toHaveLength(3);
  });

  it("splits out only the members a comment mentions, longest name first", () => {
    const parts = mentionParts("Thanks @Ann Lee and @Ann, ping @nobody or mail ann@x.io", ["Ann", "Ann Lee"]);
    expect(parts.filter((p) => p.mention).map((p) => p.text)).toEqual(["@Ann Lee", "@Ann"]);
    expect(parts.map((p) => p.text).join("")).toBe("Thanks @Ann Lee and @Ann, ping @nobody or mail ann@x.io");
    expect(mentionParts("no names", [])).toEqual([{ text: "no names", mention: false }]);
  });
});
