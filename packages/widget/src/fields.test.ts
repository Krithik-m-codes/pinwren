// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { resolveConfig } from "./config";
import { check, type Field, fieldSet, sanitizeFields } from "./fields";
import { setCatalog } from "./i18n";

const opts = [
  { value: "free", label: "Free" },
  { value: "pro", label: "Pro" },
  { value: "team", label: "Team" },
];
const raw = (over: Record<string, unknown>) => ({
  key: "plan",
  type: "text",
  label: "Plan",
  helpText: "",
  placeholder: "",
  required: false,
  kinds: ["bug"],
  options: [],
  defaultValue: null,
  validation: {},
  strings: {},
  ...over,
});
const field = (over: Record<string, unknown>): Field => {
  const f = sanitizeFields([raw(over)])[0];
  if (!f) throw new Error("field was dropped");
  return f;
};

/** An element that must exist (the tests would be meaningless otherwise). */
function q(root: ParentNode, selector: string): HTMLInputElement {
  const el = root.querySelector<HTMLInputElement>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
}

function mount(fields: unknown[], kind = "bug") {
  const root = document.createElement("div");
  document.body.append(root);
  const set = fieldSet(root, fields, kind);
  if (set.el) root.append(set.el);
  return { root, set };
}

beforeEach(() => {
  document.body.replaceChildren();
  setCatalog("en", {});
});

describe("config pass-through", () => {
  it("keeps the raw list for the lazy chunk and ignores anything else", () => {
    expect(resolveConfig({ customFields: [{ key: "a" }] }).customFields).toEqual([{ key: "a" }]);
    expect(resolveConfig({}).customFields).toEqual([]);
  });
});

describe("sanitizeFields", () => {
  it("drops malformed fields, duplicate keys and unknown types", () => {
    const out = sanitizeFields([
      raw({}),
      raw({ key: "Bad Key" }),
      raw({ key: "plan" }),
      raw({ key: "x", type: "radio" }),
      raw({ key: "y", label: "  " }),
      null,
      "str",
    ]);
    expect(out.map((f) => f.key)).toEqual(["plan"]);
    expect(sanitizeFields({ not: "a list" })).toEqual([]);
  });

  it("clamps lengths, list sizes and the field count", () => {
    const many = Array.from({ length: 30 }, (_, i) => raw({ key: `k${i}` }));
    expect(sanitizeFields(many)).toHaveLength(20);
    const f = field({
      type: "select",
      label: "x".repeat(200),
      options: Array.from({ length: 80 }, (_, i) => ({ value: `v${i}`, label: "l" })),
    });
    expect(f.label).toHaveLength(80);
    expect(f.options).toHaveLength(50);
  });
});

describe("check", () => {
  it("mirrors the server's rules", () => {
    expect(check(field({ required: true }), undefined)).toEqual({ key: "cfRequired" });
    expect(check(field({ type: "checkbox", required: true }), false)).toEqual({ key: "cfRequired" });
    expect(check(field({ validation: { minLength: 3 } }), "ab")).toEqual({ key: "cfTooShort", n: 3 });
    expect(check(field({ validation: { maxLength: 3 } }), "abcd")).toEqual({ key: "cfTooLong", n: 3 });
    expect(check(field({ type: "email" }), "nope")).toEqual({ key: "cfBadEmail" });
    expect(check(field({ type: "email" }), "a@b.co")).toBeNull();
    expect(check(field({ type: "url" }), "javascript:alert(1)")).toEqual({ key: "cfBadUrl" });
    expect(check(field({ type: "url" }), "https://x.test/a")).toBeNull();
    const n = field({ type: "number", validation: { min: 1, max: 5, integer: true } });
    expect(check(n, 0)).toEqual({ key: "cfMin", n: 1 });
    expect(check(n, 6)).toEqual({ key: "cfMax", n: 5 });
    expect(check(n, 2.5)).toEqual({ key: "cfNotInteger" });
    expect(check(n, 3)).toBeNull();
    const d = field({ type: "date", validation: { minDate: "2026-01-01" } });
    expect(check(d, "2025-12-31")).toEqual({ key: "cfMin", n: "2026-01-01" });
    expect(check(d, "nope")).toEqual({ key: "cfBadDate" });
    const m = field({ type: "multiselect", options: opts, validation: { minSelected: 2, maxSelected: 2 } });
    expect(check(m, ["free"])).toEqual({ key: "cfTooFew", n: 2 });
    expect(check(m, ["free", "pro", "team"])).toEqual({ key: "cfTooMany", n: 2 });
  });

  it("an empty optional answer is fine", () => {
    expect(check(field({ type: "email" }), undefined)).toBeNull();
    expect(check(field({ type: "multiselect", options: opts }), [])).toBeNull();
  });
});

describe("fieldSet", () => {
  it("renders nothing when no field applies to the kind", () => {
    const { set, root } = mount([raw({ kinds: ["idea"] })]);
    expect(set.el).toBeNull();
    expect(root.children).toHaveLength(0);
    expect(set.read()).toBeUndefined();
    expect(set.invalid()).toBeNull();
  });

  it("renders every type with a label, help text and aria wiring", () => {
    const { root } = mount([
      raw({ key: "a", label: "Order", helpText: "On your receipt", required: true }),
      raw({ key: "b", type: "textarea", label: "Notes" }),
      raw({ key: "c", type: "select", label: "Plan", options: opts }),
      raw({ key: "d", type: "multiselect", label: "Areas", options: opts }),
      raw({ key: "e", type: "checkbox", label: "Can we contact you" }),
      raw({ key: "f", type: "number", label: "Seats" }),
      raw({ key: "g", type: "date", label: "When" }),
      raw({ key: "h", type: "url", label: "Link" }),
      raw({ key: "i", type: "email", label: "Mail" }),
    ]);
    expect(root.querySelectorAll("input, select, textarea").length).toBeGreaterThanOrEqual(9);
    const order = root.querySelector("#pwcf0");
    expect(order?.getAttribute("aria-required")).toBe("true");
    expect(order?.getAttribute("aria-describedby")).toContain("pwcf0-d");
    expect(root.querySelector("label[for=pwcf0]")?.textContent).toContain("Order");
    expect(root.querySelector("legend")?.textContent).toBe("More details");
    expect(root.querySelector("select")?.querySelectorAll("option")).toHaveLength(4);
    expect(root.querySelector("input[type=date]")).not.toBeNull();
    expect(root.querySelector("input[type=number]")).not.toBeNull();
  });

  it("collects only non-empty answers, with numbers as numbers", () => {
    const { root, set } = mount([
      raw({ key: "a", label: "Order" }),
      raw({ key: "b", label: "Skipped" }),
      raw({ key: "c", type: "select", label: "Plan", options: opts }),
      raw({ key: "d", type: "multiselect", label: "Areas", options: opts }),
      raw({ key: "e", type: "checkbox", label: "Contact" }),
      raw({ key: "f", type: "number", label: "Seats" }),
    ]);
    const input = (id: string) => q(root, `#${id}`);
    input("pwcf0").value = "  A-1 ";
    q(root, "#pwcf2").value = "pro";
    q(root, "#pwcf3-1").checked = true;
    q(root, "#pwcf3-2").checked = true;
    input("pwcf5").value = "12";
    expect(set.read()).toEqual({ a: "A-1", c: "pro", d: ["pro", "team"], e: false, f: 12 });
  });

  it("starts from defaults and restores a saved draft", () => {
    const { root, set } = mount([
      raw({ key: "a", label: "Order", defaultValue: "D-0" }),
      raw({ key: "c", type: "select", label: "Plan", options: opts, defaultValue: "free" }),
    ]);
    expect(set.read()).toEqual({ a: "D-0", c: "free" });
    set.fill({ a: "saved", c: "team", ghost: "ignored" });
    expect(set.read()).toEqual({ a: "saved", c: "team" });
    expect(q(root, "select").value).toBe("team");
  });

  it("marks and describes invalid answers, returns the first, and clears the message once fixed", () => {
    const { root, set } = mount([
      raw({ key: "a", label: "Order", required: true }),
      raw({ key: "b", type: "email", label: "Mail" }),
    ]);
    q(root, "#pwcf1").value = "nope";
    const bad = set.invalid();
    expect(bad?.el.id).toBe("pwcf0");
    expect(bad?.message).toBe("Check the highlighted answers");
    expect(root.querySelector("#pwcf0")?.getAttribute("aria-invalid")).toBe("true");
    expect(root.querySelector("#pwcf0-e")?.textContent).toBe("This answer is required");
    expect(root.querySelector("#pwcf1-e")?.textContent).toBe("Enter a valid email address");
    const a = q(root, "#pwcf0");
    a.value = "x";
    a.dispatchEvent(new Event("input", { bubbles: true }));
    expect(root.querySelector("#pwcf0")?.hasAttribute("aria-invalid")).toBe(false);
    expect(root.querySelector<HTMLElement>("#pwcf0-e")?.hidden).toBe(true);
    expect(root.querySelector("#pwcf1")?.getAttribute("aria-invalid")).toBe("true");
  });

  it("shows the project's translation for the active locale, and the base text otherwise", () => {
    const strings = {
      fr: { label: "Numéro de commande", helpText: "Sur votre reçu", options: { pro: "Pro (FR)" } },
    };
    const defs = [raw({ key: "a", label: "Order number", strings })];
    expect(mount(defs).root.querySelector("label")?.textContent).toBe("Order number");
    document.body.replaceChildren();
    setCatalog("fr", {});
    const fr = mount([
      ...defs,
      raw({ key: "c", type: "select", label: "Plan", options: opts, strings }),
    ]).root;
    expect(fr.querySelector("label")?.textContent).toBe("Numéro de commande");
    expect(fr.querySelector("small")?.textContent).toBe("Sur votre reçu");
    expect([...fr.querySelectorAll("option")].map((o) => o.textContent)).toContain("Pro (FR)");
  });

  it("never turns project text into markup", () => {
    const evil = '<img src=x onerror="window.__pwn=1"><script>window.__pwn=1</script>';
    const { root } = mount([
      raw({ key: "a", label: evil, helpText: evil, placeholder: evil }),
      raw({ key: "c", type: "select", label: "Plan", options: [{ value: "v", label: evil }] }),
      raw({ key: "d", type: "multiselect", label: "Areas", options: [{ value: "v", label: evil }] }),
    ]);
    expect(root.querySelector("img, script")).toBeNull();
    expect(root.textContent).toContain(evil);
    expect((window as unknown as { __pwn?: number }).__pwn).toBeUndefined();
  });

  it("only offers the fields of the report's kind", () => {
    const { root } = mount([
      raw({ key: "a", kinds: ["bug"] }),
      raw({ key: "b", label: "Idea only", kinds: ["idea"] }),
    ]);
    expect(root.textContent).toContain("Plan");
    expect(root.textContent).not.toContain("Idea only");
  });
});
