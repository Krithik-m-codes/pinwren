import { describe, expect, it } from "vitest";
import { customFieldMatches } from "./automation";
import {
  customFieldInput,
  customFieldsReplace,
  describeProblems,
  formatValue,
  MAX_CUSTOM_FIELDS,
  normalizeValue,
  outboundValues,
  publicFields,
  REDACTED,
  resolveNewValues,
  resolvePatchValues,
  type CustomFieldDef,
  type CustomFieldInputRaw,
} from "./custom-fields";
import { feedbackListQuery, feedbackUpdate, widgetFeedbackCreate } from "./schemas";

const field = (over: Partial<CustomFieldInputRaw> & Pick<CustomFieldInputRaw, "key" | "type">) =>
  customFieldInput.parse({ label: over.key, ...over });

const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
];

describe("customFieldInput", () => {
  it("fills defaults: reporter audience, bug/idea/question, optional", () => {
    const f = field({ key: "order", type: "text" });
    expect(f).toMatchObject({
      audience: "reporter",
      kinds: ["bug", "idea", "question"],
      required: false,
      helpText: "",
      defaultValue: null,
      pii: false,
    });
  });

  it("rejects bad keys, empty labels and unknown types", () => {
    for (const key of ["Order", "1st", "has-dash", "", "a".repeat(41)]) {
      expect(customFieldInput.safeParse({ key, type: "text", label: "x" }).success).toBe(false);
    }
    expect(customFieldInput.safeParse({ key: "k", type: "text", label: " " }).success).toBe(false);
    expect(customFieldInput.safeParse({ key: "k", type: "radio", label: "x" }).success).toBe(false);
  });

  it("needs unique options for choice types and drops them elsewhere", () => {
    expect(customFieldInput.safeParse({ key: "k", type: "select", label: "x" }).success).toBe(false);
    expect(
      customFieldInput.safeParse({
        key: "k",
        type: "select",
        label: "x",
        options: [options[0], options[0]],
      }).success,
    ).toBe(false);
    expect(field({ key: "k", type: "text", options }).options).toEqual([]);
    expect(field({ key: "k", type: "select", options }).options).toHaveLength(3);
  });

  it("keeps only the rules a type understands and orders min/max", () => {
    const f = field({
      key: "k",
      type: "text",
      validation: { maxLength: 10, min: 5, minSelected: 1 },
    });
    expect(f.validation).toEqual({ maxLength: 10 });
    expect(
      customFieldInput.safeParse({ key: "k", type: "number", label: "x", validation: { min: 5, max: 1 } })
        .success,
    ).toBe(false);
    expect(
      customFieldInput.safeParse({ key: "k", type: "text", label: "x", validation: { maxLength: 501 } })
        .success,
    ).toBe(false);
    expect(
      customFieldInput.safeParse({
        key: "k",
        type: "multiselect",
        label: "x",
        options,
        validation: { maxSelected: 4 },
      }).success,
    ).toBe(false);
  });

  it("refuses a required internal field", () => {
    expect(
      customFieldInput.safeParse({ key: "k", type: "text", label: "x", audience: "internal", required: true })
        .success,
    ).toBe(false);
  });

  it("validates the default against the field's own rules", () => {
    expect(field({ key: "k", type: "select", options, defaultValue: "b" }).defaultValue).toBe("b");
    expect(
      customFieldInput.safeParse({ key: "k", type: "select", label: "x", options, defaultValue: "zzz" })
        .success,
    ).toBe(false);
    expect(
      customFieldInput.safeParse({ key: "k", type: "number", label: "x", defaultValue: "nope" }).success,
    ).toBe(false);
  });

  it("drops translations of options that no longer exist and empty strings", () => {
    const f = field({
      key: "k",
      type: "select",
      options,
      strings: { fr: { label: "Étiquette", options: { a: "Alpha FR", gone: "x" } }, de: { label: "" } },
    });
    expect(f.strings).toEqual({ fr: { label: "Étiquette", options: { a: "Alpha FR" } } });
  });

  it("limits a form to 20 fields with unique keys", () => {
    const many = Array.from({ length: MAX_CUSTOM_FIELDS + 1 }, (_, i) => ({
      key: `f${i}`,
      type: "text",
      label: "x",
    }));
    expect(customFieldsReplace.safeParse({ fields: many }).success).toBe(false);
    expect(customFieldsReplace.safeParse({ fields: many.slice(0, MAX_CUSTOM_FIELDS) }).success).toBe(true);
    const dup = customFieldsReplace.safeParse({
      fields: [many[0], many[0]],
    });
    expect(dup.success).toBe(false);
  });
});

describe("normalizeValue", () => {
  const f = (type: Parameters<typeof field>[0]["type"], extra: Partial<CustomFieldInputRaw> = {}) =>
    field({ key: "k", type, options, ...extra });

  it("trims text and treats blank as empty", () => {
    expect(normalizeValue(f("text"), "  hi ")).toEqual({ ok: true, value: "hi" });
    expect(normalizeValue(f("text"), "   ")).toEqual({ ok: true, value: undefined });
    expect(normalizeValue(f("text"), null)).toEqual({ ok: true, value: undefined });
    expect(normalizeValue(f("text"), 5)).toMatchObject({ ok: false, issue: { code: "type" } });
  });

  it("applies length rules and the hard cap", () => {
    const t = f("text", { validation: { minLength: 3, maxLength: 5 } });
    expect(normalizeValue(t, "ab")).toMatchObject({ ok: false, issue: { code: "too_short", limit: 3 } });
    expect(normalizeValue(t, "abcdef")).toMatchObject({ ok: false, issue: { code: "too_long", limit: 5 } });
    expect(normalizeValue(f("text"), "x".repeat(501))).toMatchObject({ ok: false });
    expect(normalizeValue(f("textarea"), "x".repeat(2000))).toMatchObject({ ok: true });
    expect(normalizeValue(f("textarea"), "x".repeat(2001))).toMatchObject({ ok: false });
  });

  it("accepts only http(s) links, so javascript: never reaches an href", () => {
    expect(normalizeValue(f("url"), "https://example.com/a?b=1")).toMatchObject({ ok: true });
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "ftp://x.test",
      "example.com",
      "//x.test",
    ]) {
      expect(normalizeValue(f("url"), bad)).toMatchObject({ ok: false, issue: { code: "bad_url" } });
    }
  });

  it("checks email, number and date", () => {
    expect(normalizeValue(f("email"), "a@b.co")).toMatchObject({ ok: true });
    expect(normalizeValue(f("email"), "nope")).toMatchObject({ ok: false, issue: { code: "bad_email" } });
    const n = f("number", { validation: { min: 1, max: 10, integer: true } });
    expect(normalizeValue(n, 5)).toEqual({ ok: true, value: 5 });
    expect(normalizeValue(n, 0)).toMatchObject({ ok: false, issue: { code: "too_small" } });
    expect(normalizeValue(n, 11)).toMatchObject({ ok: false, issue: { code: "too_big" } });
    expect(normalizeValue(n, 2.5)).toMatchObject({ ok: false, issue: { code: "not_integer" } });
    expect(normalizeValue(n, "5")).toMatchObject({ ok: false, issue: { code: "type" } });
    expect(normalizeValue(n, Number.NaN)).toMatchObject({ ok: false });
    const d = f("date", { validation: { minDate: "2026-01-01", maxDate: "2026-12-31" } });
    expect(normalizeValue(d, "2026-06-15")).toEqual({ ok: true, value: "2026-06-15" });
    expect(normalizeValue(d, "2026-02-30")).toMatchObject({ ok: false, issue: { code: "bad_date" } });
    expect(normalizeValue(d, "2025-12-31")).toMatchObject({ ok: false, issue: { code: "too_small" } });
    expect(normalizeValue(d, "2027-01-01")).toMatchObject({ ok: false, issue: { code: "too_big" } });
  });

  it("checks select and multiselect against the options", () => {
    expect(normalizeValue(f("select"), "a")).toEqual({ ok: true, value: "a" });
    expect(normalizeValue(f("select"), "zzz")).toMatchObject({ ok: false, issue: { code: "bad_option" } });
    const m = f("multiselect", { validation: { minSelected: 1, maxSelected: 2 } });
    expect(normalizeValue(m, ["c", "a", "a"])).toEqual({ ok: true, value: ["a", "c"] });
    expect(normalizeValue(m, [])).toEqual({ ok: true, value: undefined });
    expect(normalizeValue(m, ["a", "b", "c"])).toMatchObject({ ok: false, issue: { code: "too_many" } });
    expect(normalizeValue(m, ["a", "x"])).toMatchObject({ ok: false, issue: { code: "bad_option" } });
    expect(normalizeValue(m, "a")).toMatchObject({ ok: false, issue: { code: "type" } });
  });

  it("keeps an unticked checkbox as an answer", () => {
    expect(normalizeValue(f("checkbox"), false)).toEqual({ ok: true, value: false });
    expect(normalizeValue(f("checkbox"), "true")).toMatchObject({ ok: false });
  });
});

describe("resolveNewValues", () => {
  const defs = [
    field({ key: "order", type: "text", required: true }),
    field({ key: "plan", type: "select", options, defaultValue: "b" }),
    field({ key: "note", type: "textarea", kinds: ["idea"] }),
    field({ key: "owner", type: "text", audience: "internal" }),
    field({ key: "agree", type: "checkbox", required: true }),
  ];

  it("takes reporter fields for the kind, applies defaults and ignores the rest", () => {
    const r = resolveNewValues(
      defs,
      { order: "A-1", agree: true, note: "ignored: wrong kind", owner: "ignored: internal", ghost: 1 },
      "bug",
    );
    expect(r.problems).toEqual([]);
    expect(r.values).toEqual({ order: "A-1", plan: "b", agree: true });
  });

  it("reports missing required fields and an unticked required checkbox", () => {
    const r = resolveNewValues(defs, { agree: false }, "bug");
    expect(r.problems.map((p) => [p.key, p.code])).toEqual([
      ["order", "required"],
      ["agree", "required"],
    ]);
    expect(describeProblems(r.problems)).toContain("order is required");
  });

  it("reports an invalid answer instead of storing it", () => {
    const r = resolveNewValues(defs, { order: "x", agree: true, plan: "zzz" }, "bug");
    expect(r.problems).toEqual([{ code: "bad_option", key: "plan", label: "plan" }]);
    expect(r.values).not.toHaveProperty("plan");
  });

  it("a field of another kind is neither asked nor required", () => {
    const only = [field({ key: "must", type: "text", required: true, kinds: ["idea"] })];
    expect(resolveNewValues(only, {}, "bug")).toEqual({ values: {}, problems: [] });
    expect(resolveNewValues(only, {}, "idea").problems).toHaveLength(1);
  });

  it("ignores prototype-ish keys", () => {
    const r = resolveNewValues(
      defs,
      JSON.parse('{"__proto__":{"x":1},"order":"A","agree":true}') as never,
      "bug",
    );
    expect(r.values.order).toBe("A");
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it("refuses answers over the total size", () => {
    const wide = Array.from({ length: 20 }, (_, i) => field({ key: `t${i}`, type: "textarea" }));
    const raw = Object.fromEntries(wide.map((w) => [w.key, "x".repeat(2000)]));
    expect(resolveNewValues(wide, raw, "bug").problems).toEqual([{ code: "too_large", key: "", label: "" }]);
  });
});

describe("resolvePatchValues", () => {
  const defs = [
    field({ key: "order", type: "text", required: true }),
    field({ key: "owner", type: "text", audience: "internal" }),
    field({ key: "note", type: "text", kinds: ["idea"] }),
  ];

  it("sets, clears and reports what changed; internal fields are editable", () => {
    const r = resolvePatchValues(defs, { order: "A" }, { owner: "Sam", order: "A" }, "bug");
    expect(r.values).toEqual({ order: "A", owner: "Sam" });
    expect(r.changed).toEqual(["owner"]);
    const clear = resolvePatchValues(defs, { owner: "Sam" }, { owner: null }, "bug");
    expect(clear.values).toEqual({});
    expect(clear.changed).toEqual(["owner"]);
  });

  it("will not clear a required field but leaves unnamed ones alone", () => {
    const r = resolvePatchValues(defs, {}, { owner: "x" }, "bug");
    expect(r.problems).toEqual([]);
    expect(resolvePatchValues(defs, { order: "A" }, { order: null }, "bug").problems[0]).toMatchObject({
      code: "required",
    });
  });

  it("refuses unknown fields and fields of another kind", () => {
    expect(resolvePatchValues(defs, {}, { ghost: "x" }, "bug").problems[0]?.code).toBe("unknown_field");
    expect(resolvePatchValues(defs, {}, { note: "x" }, "bug").problems[0]?.code).toBe("unknown_field");
    expect(resolvePatchValues(defs, {}, { note: "x" }, "idea").problems).toEqual([]);
  });
});

describe("presentation and privacy helpers", () => {
  const select = field({ key: "plan", type: "select", options });
  it("formats answers for people", () => {
    expect(formatValue(select, "a")).toBe("Alpha");
    expect(formatValue(field({ key: "m", type: "multiselect", options }), ["a", "c"])).toBe("Alpha, Gamma");
    expect(formatValue(field({ key: "c", type: "checkbox" }), true)).toBe("Yes");
    expect(formatValue(field({ key: "c", type: "checkbox" }), false, "Ja", "Nein")).toBe("Nein");
    expect(formatValue(select, undefined)).toBe("");
  });

  it("redacts PII answers only in privacy mode and drops keys without a field", () => {
    const fields = [
      field({ key: "email", type: "email", pii: true }),
      field({ key: "plan", type: "select", options }),
    ];
    const values = { email: "a@b.co", plan: "a", stale: "x" };
    expect(outboundValues(fields, values, false)).toEqual({ email: "a@b.co", plan: "a" });
    expect(outboundValues(fields, values, true)).toEqual({ email: REDACTED, plan: "a" });
    expect(outboundValues(fields, null, true)).toEqual({});
  });

  it("gives the widget reporter fields only, without internal flags", () => {
    const fields = [
      { ...field({ key: "a", type: "text" }), id: "1", projectId: "p", position: 0 },
      { ...field({ key: "b", type: "text", audience: "internal" }), id: "2", projectId: "p", position: 1 },
    ] satisfies CustomFieldDef[];
    const pub = publicFields(fields);
    expect(pub.map((x) => x.key)).toEqual(["a"]);
    expect(pub[0]).not.toHaveProperty("audience");
    expect(pub[0]).not.toHaveProperty("pii");
  });
});

describe("wire schemas", () => {
  it("accepts custom fields on a widget report and an update, and a cf filter on the list", () => {
    expect(feedbackUpdate.safeParse({ customFields: { order: "A", plan: null } }).success).toBe(true);
    expect(feedbackUpdate.safeParse({ customFields: { "Bad Key": "A" } }).success).toBe(false);
    expect(feedbackListQuery.safeParse({ cf: "plan:pro" }).success).toBe(true);
    expect(feedbackListQuery.safeParse({ cf: "plan" }).success).toBe(false);
    const base = {
      clientId: "6f1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c",
      kind: "bug",
      body: "x",
      page: { url: "https://example.com/" },
      environment: { userAgent: "x", viewport: { w: 1, h: 1 }, dpr: 1 },
      customFields: { order: "A-1" },
    };
    expect(widgetFeedbackCreate.safeParse(base).success).toBe(true);
    expect(
      widgetFeedbackCreate.safeParse({ ...base, customFields: { order: "x".repeat(70_000) } }).success,
    ).toBe(false);
  });
});

describe("automation custom-field conditions", () => {
  it("compares by the answer's type", () => {
    expect(customFieldMatches("equals", "pro", "Pro")).toBe(true);
    expect(customFieldMatches("equals", ["a", "b"], "b")).toBe(true);
    expect(customFieldMatches("equals", true, "true")).toBe(true);
    expect(customFieldMatches("not_equals", "pro", "free")).toBe(true);
    expect(customFieldMatches("not_equals", undefined, "free")).toBe(true);
    expect(customFieldMatches("contains", "Acme Corp", "acme")).toBe(true);
    expect(customFieldMatches("gt", 12, "10")).toBe(true);
    expect(customFieldMatches("lt", 12, "10")).toBe(false);
    expect(customFieldMatches("gt", "2026-06-01", "2026-01-01")).toBe(true);
    expect(customFieldMatches("lt", "2026-06-01", "2026-12-01")).toBe(true);
    expect(customFieldMatches("is_set", "x", undefined)).toBe(true);
    expect(customFieldMatches("is_set", [], undefined)).toBe(false);
    expect(customFieldMatches("is_not_set", undefined, undefined)).toBe(true);
    expect(customFieldMatches("equals", undefined, "x")).toBe(false);
    expect(customFieldMatches("gt", "abc", "x")).toBe(false);
  });
});
