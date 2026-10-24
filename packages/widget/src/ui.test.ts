// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  ago,
  initials,
  isEditable,
  KIND_LIST,
  kindChips,
  kindOf,
  MARKER,
  markerEl,
  markerSpot,
  markersShown,
  paintMarker,
  setMarkersShown,
  shortName,
} from "./ui";

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

describe("kinds and markers", () => {
  it("maps SitePing's four types onto Pinwren's kinds", () => {
    expect(KIND_LIST).toEqual(["question", "idea", "bug", "comment"]);
    expect(KIND_LIST.map((k) => kindOf(k).label)).toEqual(["Question", "Change", "Bug", "Other"]);
    expect(kindOf("unknown").label).toBe("Other");
  });

  it("picks a type with the chips; nothing picked sends Other", () => {
    const onPick = vi.fn();
    const chips = kindChips(null, onPick);
    expect(chips.value()).toBe("comment");
    const [, change] = Array.from(chips.el.querySelectorAll<HTMLButtonElement>("[role=radio]"));
    change?.click();
    expect(chips.value()).toBe("idea");
    expect(change?.getAttribute("aria-checked")).toBe("true");
    expect(onPick).toHaveBeenCalled();
    change?.click(); // a second press clears it
    expect(chips.picked()).toBeNull();
    expect(kindChips("bug", onPick).value()).toBe("bug");
  });

  it("numbers markers, colours them by kind and checks resolved ones", () => {
    const m = markerEl({ kind: "bug", number: 4, status: "open" });
    expect(m.querySelector(".n")?.textContent).toBe("4");
    expect(m.style.getPropertyValue("--c")).toBe(kindOf("bug").color);
    paintMarker(m, { kind: "bug", number: 4, status: "resolved" });
    expect(m.classList.contains("resolved")).toBe(true);
    paintMarker(m, { kind: "question", number: 0, status: "open" });
    expect(m.querySelector(".n")?.textContent).toBe("…");
    expect(m.classList.contains("resolved")).toBe(false);
  });

  it("centres a marker on its point, or on a region's top-right corner", () => {
    expect(markerSpot({ left: 100, top: 50, width: 0, height: 0 })).toEqual({
      left: 100 - MARKER / 2,
      top: 50 - MARKER / 2,
    });
    expect(markerSpot({ left: 100, top: 50, width: 200, height: 80 })).toEqual({
      left: 300 - MARKER / 2,
      top: 50 - MARKER / 2,
    });
  });

  it("remembers per project whether the visitor hid the markers", () => {
    localStorage.clear();
    expect(markersShown("pk_a")).toBe(true);
    setMarkersShown("pk_a", false);
    expect(markersShown("pk_a")).toBe(false);
    expect(markersShown("pk_b")).toBe(true);
    setMarkersShown("pk_a", true);
    expect(markersShown("pk_a")).toBe(true);
  });
});
