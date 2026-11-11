import { adoptStyle, h } from "./dom";
import { FIELDS_CSS } from "./fields-styles";
import { addEnglish, type Key, locale, t } from "./i18n";
import { enFields } from "./locales/en-fields";

// The project's custom questions (ADR 0032): the lazy widget-fields.js chunk. The report form asks for them
// (`customFields` of `GET /w/config`), checks the answers and hands them to the report. Nothing here is trusted
// beyond what it can render safely: every string goes in through textContent or an attribute, every list and
// length is clamped, and the server re-validates all of it (`resolveNewValues` in @pinwren/core is the gate).

addEnglish(enFields);

type Opt = { value: string; label: string };
type Rules = {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  minDate?: string;
  maxDate?: string;
  minSelected?: number;
  maxSelected?: number;
};
type Local = { label?: string; helpText?: string; placeholder?: string; options?: Record<string, string> };
export type Field = {
  key: string;
  type: string;
  label: string;
  help: string;
  ph: string;
  required: boolean;
  kinds: string[];
  options: Opt[];
  def: unknown;
  rules: Rules;
  strings: Record<string, Local>;
};
export type Answer = string | number | boolean | string[];

const TYPES = ["text", "textarea", "select", "multiselect", "checkbox", "number", "date", "url", "email"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/\S+$/i;
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** The fields from `/w/config`, whatever shape they arrived in: malformed ones are dropped, lists clamped. */
export function sanitizeFields(raw: unknown): Field[] {
  const out: Field[] = [];
  for (const f of Array.isArray(raw) ? (raw as unknown[]) : []) {
    if (!isObj(f) || typeof f.key !== "string" || !KEY.test(f.key) || !TYPES.includes(f.type as string))
      continue;
    const label = str(f.label, 80).trim();
    if (!label || out.some((x) => x.key === f.key)) continue;
    const options: Opt[] = [];
    for (const o of Array.isArray(f.options) ? (f.options as unknown[]) : []) {
      if (isObj(o) && typeof o.value === "string" && o.value && typeof o.label === "string")
        options.push({ value: o.value.slice(0, 100), label: o.label.slice(0, 80) });
      if (options.length === 50) break;
    }
    const v = isObj(f.validation) ? f.validation : {};
    const rules: Rules = {};
    for (const k of ["minLength", "maxLength", "min", "max", "minSelected", "maxSelected"] as const) {
      const n = num(v[k]);
      if (n !== undefined) rules[k] = n;
    }
    if (v.integer === true) rules.integer = true;
    for (const k of ["minDate", "maxDate"] as const) {
      const d = v[k];
      if (typeof d === "string" && DATE.test(d)) rules[k] = d;
    }
    const strings: Record<string, Local> = {};
    if (isObj(f.strings))
      for (const [code, s] of Object.entries(f.strings))
        if (isObj(s))
          strings[code] = {
            label: str(s.label, 80),
            helpText: str(s.helpText, 300),
            placeholder: str(s.placeholder, 120),
            options: isObj(s.options)
              ? Object.fromEntries(Object.entries(s.options).map(([k, l]) => [k, str(l, 80)]))
              : {},
          };
    out.push({
      key: f.key,
      type: f.type as string,
      label,
      help: str(f.helpText, 300),
      ph: str(f.placeholder, 120),
      required: f.required === true,
      kinds: Array.isArray(f.kinds) ? f.kinds.filter((k): k is string => typeof k === "string") : [],
      options,
      def: f.defaultValue ?? null,
      rules,
      strings,
    });
    if (out.length === 20) break;
  }
  return out;
}

type Problem = { key: Key; n?: number | string };

/** One answer, checked like the server does; the first problem, or null. */
export function check(f: Field, v: Answer | undefined): Problem | null {
  const r = f.rules;
  const empty = v === undefined || v === "" || (Array.isArray(v) && !v.length);
  if (f.required && (empty || (f.type === "checkbox" && v !== true))) return { key: "cfRequired" };
  if (empty) return null;
  if (typeof v === "string" && (f.type === "text" || f.type === "textarea")) {
    if (r.minLength !== undefined && v.length < r.minLength) return { key: "cfTooShort", n: r.minLength };
    if (r.maxLength !== undefined && v.length > r.maxLength) return { key: "cfTooLong", n: r.maxLength };
  }
  if (f.type === "email" && !EMAIL.test(String(v))) return { key: "cfBadEmail" };
  if (f.type === "url" && !URL_RE.test(String(v))) return { key: "cfBadUrl" };
  if (f.type === "number") {
    if (typeof v !== "number") return { key: "cfBadNumber" };
    if (r.integer && !Number.isInteger(v)) return { key: "cfNotInteger" };
    if (r.min !== undefined && v < r.min) return { key: "cfMin", n: r.min };
    if (r.max !== undefined && v > r.max) return { key: "cfMax", n: r.max };
  }
  if (f.type === "date") {
    const d = String(v);
    if (!DATE.test(d) || Number.isNaN(Date.parse(d))) return { key: "cfBadDate" };
    if (r.minDate !== undefined && d < r.minDate) return { key: "cfMin", n: r.minDate };
    if (r.maxDate !== undefined && d > r.maxDate) return { key: "cfMax", n: r.maxDate };
  }
  if (Array.isArray(v)) {
    if (r.minSelected !== undefined && v.length < r.minSelected) return { key: "cfTooFew", n: r.minSelected };
    if (r.maxSelected !== undefined && v.length > r.maxSelected)
      return { key: "cfTooMany", n: r.maxSelected };
  }
  return null;
}

type Control = {
  f: Field;
  el: HTMLElement;
  err: HTMLElement;
  focus: HTMLElement;
  get: () => Answer | undefined;
  set: (v: unknown) => void;
};

export type FieldSet = {
  el: HTMLElement | null;
  /** The first unanswered or invalid question (marked and described), or null when every answer is fine. */
  invalid(): { el: HTMLElement; message: string } | null;
  /** The answers to send: only non-empty ones (a checkbox always answers). */
  read(): Record<string, Answer> | undefined;
  /** Put saved answers back (a restored draft). */
  fill(v: Record<string, unknown> | undefined): void;
};

/** The questions that apply to `kind`, as a form section. */
export function fieldSet(root: HTMLElement, raw: unknown, kind: string): FieldSet {
  const lang = locale();
  const controls = sanitizeFields(raw)
    .filter((f) => f.kinds.includes(kind))
    .map((f, i) => control(f, `pwcf${i}`, lang));
  if (!controls.length)
    return { el: null, invalid: () => null, read: () => undefined, fill: () => undefined };
  adoptStyle(root, "fields", FIELDS_CSS);
  const show = (c: Control, bad: Problem | null) => {
    const text = bad ? t(bad.key, { n: bad.n ?? "" }) : "";
    c.err.textContent = text;
    c.err.hidden = !text;
    for (const m of c.el.querySelectorAll("input, select, textarea")) {
      if (text) m.setAttribute("aria-invalid", "true");
      else m.removeAttribute("aria-invalid");
    }
  };
  for (const c of controls) {
    // A mistake fixed is a message gone, without waiting for the next send.
    c.el.addEventListener("input", () => {
      if (!c.err.hidden && !check(c.f, c.get())) show(c, null);
    });
  }
  return {
    el: h("fieldset", { class: "cf" }, h("legend", {}, t("cfHeading")), ...controls.map((c) => c.el)),
    invalid() {
      let first: { el: HTMLElement; message: string } | null = null;
      for (const c of controls) {
        const bad = check(c.f, c.get());
        show(c, bad);
        if (bad && !first) first = { el: c.focus, message: t("cfFix") };
      }
      return first;
    },
    read() {
      const out: Record<string, Answer> = {};
      for (const c of controls) {
        const v = c.get();
        if (v !== undefined) out[c.f.key] = v;
      }
      return Object.keys(out).length ? out : undefined;
    },
    fill(v) {
      if (v) for (const c of controls) if (Object.hasOwn(v, c.f.key)) c.set(v[c.f.key]);
    },
  };
}

function control(f: Field, id: string, lang: string): Control {
  const s = f.strings[lang];
  const label = s?.label || f.label;
  const help = s?.helpText || f.help;
  const ph = s?.placeholder || f.ph;
  const optLabel = (o: Opt) => s?.options?.[o.value] || o.label;
  const err = h("small", { class: "cf-e", id: `${id}-e`, role: "alert", hidden: true });
  const hint = help ? h("small", { id: `${id}-d` }, help) : null;
  const described = [hint ? `${id}-d` : "", `${id}-e`].filter(Boolean).join(" ");
  const mark = f.required ? h("i", { "aria-hidden": "true" }, "*") : null;
  const common = { id, "aria-describedby": described, "aria-required": f.required ? "true" : undefined };

  if (f.type === "multiselect") {
    const boxes = f.options.map((o, i) => ({
      o,
      box: h("input", { type: "checkbox", value: o.value, id: `${id}-${i}` }),
    }));
    const set = (v: unknown) => {
      const on = Array.isArray(v) ? v.map(String) : [];
      for (const b of boxes) b.box.checked = on.includes(b.o.value);
    };
    set(f.def);
    return {
      f,
      err,
      set,
      get: () => {
        const on = boxes.filter((b) => b.box.checked).map((b) => b.o.value);
        return on.length ? on : undefined;
      },
      focus: boxes[0]?.box ?? err,
      el: h(
        "fieldset",
        { class: "cf-q", "aria-describedby": described },
        h("legend", {}, label, mark),
        hint,
        h(
          "div",
          { class: "cf-g" },
          ...boxes.map(({ o, box }) => h("label", { class: "cf-c", for: box.id }, box, optLabel(o))),
        ),
        err,
      ),
    };
  }

  if (f.type === "checkbox") {
    const box = h("input", { type: "checkbox", ...common });
    const set = (v: unknown) => {
      box.checked = v === true;
    };
    set(f.def);
    return {
      f,
      err,
      set,
      get: () => box.checked,
      focus: box,
      el: h(
        "div",
        { class: "cf-q" },
        h("label", { class: "cf-c", for: id }, box, h("span", {}, label, mark)),
        hint,
        err,
      ),
    };
  }

  let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  let get: Control["get"];
  let set: Control["set"];
  if (f.type === "select") {
    const sel = h("select", common);
    sel.append(h("option", { value: "" }, ph || t("cfChoose")));
    for (const o of f.options) sel.append(h("option", { value: o.value }, optLabel(o)));
    input = sel;
    set = (v) => {
      sel.value = typeof v === "string" && f.options.some((o) => o.value === v) ? v : "";
    };
    get = () => sel.value || undefined;
  } else if (f.type === "textarea") {
    const ta = h("textarea", { ...common, placeholder: ph, maxlength: f.rules.maxLength ?? 2000, rows: 3 });
    input = ta;
    set = (v) => {
      ta.value = typeof v === "string" ? v : "";
    };
    get = () => ta.value.trim() || undefined;
  } else if (f.type === "number") {
    const n = h("input", {
      ...common,
      type: "number",
      inputmode: f.rules.integer ? "numeric" : "decimal",
      step: f.rules.integer ? 1 : "any",
      placeholder: ph,
      min: f.rules.min,
      max: f.rules.max,
    });
    input = n;
    set = (v) => {
      n.value = typeof v === "number" ? String(v) : "";
    };
    get = () => (n.value.trim() && Number.isFinite(n.valueAsNumber) ? n.valueAsNumber : undefined);
  } else {
    // text, email, url, date: the browser's own keyboard or picker.
    const date = f.type === "date";
    const i = h("input", {
      ...common,
      type: f.type,
      placeholder: ph,
      maxlength: date ? undefined : (f.rules.maxLength ?? (f.type === "email" ? 254 : 500)),
      min: date ? f.rules.minDate : undefined,
      max: date ? f.rules.maxDate : undefined,
      autocomplete: f.type === "email" ? "email" : undefined,
    });
    input = i;
    set = (v) => {
      i.value = typeof v === "string" ? v : "";
    };
    get = () => i.value.trim() || undefined;
  }
  set(f.def);
  return {
    f,
    err,
    set,
    get,
    focus: input,
    el: h("div", { class: "cf-q" }, h("label", { class: "cf-l", for: id }, label, mark), hint, input, err),
  };
}

export type FieldsModule = { fieldSet: typeof fieldSet };
(window as unknown as { __pinwrenFields: FieldsModule }).__pinwrenFields = { fieldSet };
