// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { consentBlock, consentVersion } from "./form";
import { store } from "./store";

const NOTICE = {
  enabled: true,
  text: "We send your comment and browser details.",
  privacyUrl: "https://x.example/p",
};

beforeEach(() => {
  localStorage.clear();
});

describe("consent record (wave-4 §6)", () => {
  it("versions the notice by its text and link", () => {
    const v = consentVersion(NOTICE);
    expect(v).toMatch(/^1-[0-9a-f]{8}$/);
    expect(consentVersion({ ...NOTICE })).toBe(v);
    expect(consentVersion({ ...NOTICE, text: "Changed." })).not.toBe(v);
    expect(consentVersion({ ...NOTICE, privacyUrl: null })).not.toBe(v);
    expect(consentVersion({ ...NOTICE, text: null })).not.toBe(v);
  });

  it("records version + time on accept and returns it for the payload", () => {
    const c = consentBlock(NOTICE, "pk_1");
    expect(c.need).toBe(true);
    expect(c.record()).toBeUndefined();
    const before = Date.now();
    c.accept();
    const r = c.record();
    expect(r?.version).toBe(consentVersion(NOTICE));
    expect(Date.parse(r?.acceptedAt ?? "")).toBeGreaterThanOrEqual(before - 1000);
    // Accepted once: the next form doesn't ask, but still sends the record.
    const next = consentBlock(NOTICE, "pk_1");
    expect(next.need).toBe(false);
    expect(next.record()).toEqual(r);
  });

  it("asks again when the notice changes, and for records from older widgets", () => {
    consentBlock(NOTICE, "pk_1").accept();
    expect(consentBlock({ ...NOTICE, text: "New wording" }, "pk_1").need).toBe(true);
    localStorage.setItem("pinwren:consent:pk_2", "true");
    expect(consentBlock(NOTICE, "pk_2").need).toBe(true);
    localStorage.setItem(
      "pinwren:consent:pk_3",
      JSON.stringify({ version: consentVersion(NOTICE), acceptedAt: "x" }),
    );
    expect(store.consent("pk_3", consentVersion(NOTICE))).toBeNull();
  });

  it("sends nothing when the project has no notice", () => {
    const off = { ...NOTICE, enabled: false };
    const c = consentBlock(off, "pk_1");
    expect(c.need).toBe(false);
    c.accept();
    expect(c.record()).toBeUndefined();
  });
});
