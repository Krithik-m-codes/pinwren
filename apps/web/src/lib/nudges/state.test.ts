import { describe, expect, it } from "vitest";
import {
  emptyNudgeState,
  parseNudgeState,
  snoozeUntil,
  SUPPORT_AFTER_DAYS,
  SUPPORT_SNOOZE_DAYS,
  supportCardVisible,
  updateStripVisible,
  versionNumber,
} from "./state";

const DAY = 86_400_000;
const now = Date.parse("2026-06-01T00:00:00Z");
const seen = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString();

describe("update strip", () => {
  it("shows for a release that was not dismissed", () => {
    expect(updateStripVisible(emptyNudgeState, "v1.2.0")).toBe(true);
  });
  it("hides once that release is dismissed and returns for the next one", () => {
    const s = { ...emptyNudgeState, dismissedUpdate: "v1.2.0" };
    expect(updateStripVisible(s, "v1.2.0")).toBe(false);
    expect(updateStripVisible(s, "v1.3.0")).toBe(true);
  });
  it("needs a known release", () => {
    expect(updateStripVisible(emptyNudgeState, null)).toBe(false);
  });
});

describe("support card", () => {
  it("waits until the person has used Pinwren for a while", () => {
    expect(supportCardVisible({ ...emptyNudgeState, firstSeen: null }, now)).toBe(false);
    expect(supportCardVisible({ ...emptyNudgeState, firstSeen: seen(SUPPORT_AFTER_DAYS - 1) }, now)).toBe(
      false,
    );
    expect(supportCardVisible({ ...emptyNudgeState, firstSeen: seen(SUPPORT_AFTER_DAYS) }, now)).toBe(true);
  });
  it("stays quiet during a snooze and returns after it", () => {
    const base = { ...emptyNudgeState, firstSeen: seen(60) };
    const snoozed = { ...base, supportSnoozedUntil: snoozeUntil(now, SUPPORT_SNOOZE_DAYS) };
    expect(supportCardVisible(snoozed, now + 29 * DAY)).toBe(false);
    expect(supportCardVisible(snoozed, now + 31 * DAY)).toBe(true);
  });
  it("never returns after 'don't ask again'", () => {
    expect(supportCardVisible({ ...emptyNudgeState, firstSeen: seen(900), supportOptOut: true }, now)).toBe(
      false,
    );
  });
});

describe("stored state", () => {
  it("reads garbage as the empty state", () => {
    expect(parseNudgeState(null)).toEqual(emptyNudgeState);
    expect(parseNudgeState("{nope")).toEqual(emptyNudgeState);
    expect(parseNudgeState(JSON.stringify({ firstSeen: 5, supportOptOut: "yes" }))).toEqual(emptyNudgeState);
  });
  it("round-trips valid fields", () => {
    const s = { firstSeen: seen(3), dismissedUpdate: "v2", supportSnoozedUntil: null, supportOptOut: true };
    expect(parseNudgeState(JSON.stringify(s))).toEqual(s);
  });
});

describe("versionNumber", () => {
  it("drops the leading v", () => {
    expect(versionNumber("v1.2.3")).toBe("1.2.3");
    expect(versionNumber("1.2.3")).toBe("1.2.3");
  });
});
