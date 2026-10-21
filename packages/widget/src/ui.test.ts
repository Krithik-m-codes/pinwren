// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { ago, initials, isEditable, shortName } from "./ui";

describe("names", () => {
  it("builds initials and short names like the reference card", () => {
    expect(initials("Sarah Miller")).toBe("SM");
    expect(initials("  ada  ")).toBe("A");
    expect(initials(null)).toBe("");
    expect(shortName("Sarah Miller")).toBe("Sarah M.");
    expect(shortName("Mary Ann van Dyke")).toBe("Mary D.");
    expect(shortName(null)).toBe("Visitor");
  });
});

describe("ago", () => {
  const now = Date.parse("2026-10-21T12:00:00Z");
  it("formats relative times", () => {
    expect(ago("2026-10-21T11:59:30Z", now)).toBe("just now");
    expect(ago("2026-10-21T11:15:00Z", now)).toBe("45m ago");
    expect(ago("2026-10-21T07:00:00Z", now)).toBe("5h ago");
    expect(ago("2026-10-19T12:00:00Z", now)).toBe("2d ago");
    expect(ago("not a date", now)).toBe("");
  });
});

describe("isEditable", () => {
  it("treats form fields, links and contenteditable as the page's own", () => {
    document.body.innerHTML = `<input id="i"><a href="#" id="a"><span id="s">x</span></a>
      <div contenteditable="true" id="ce"><b id="b">x</b></div><div contenteditable="false" id="no"></div><p id="p"></p>`;
    for (const id of ["i", "a", "s", "b"]) expect(isEditable(document.getElementById(id))).toBe(true);
    for (const id of ["no", "p"]) expect(isEditable(document.getElementById(id))).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
});
