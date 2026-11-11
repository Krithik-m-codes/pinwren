import { z } from "zod";
import {
  CUSTOM_FIELD_KEY,
  customFieldKey,
  customFieldValues,
  FEEDBACK_KINDS,
  LOCALES,
  MAX_CUSTOM_FIELDS,
  MAX_CUSTOM_VALUES_BYTES,
} from "./schemas";

// The key, value-map and filter schemas live in schemas.ts (the wire schemas that mention them load first);
// they are re-exported from here so `custom-fields` reads as one module.
export { CUSTOM_FIELD_KEY, customFieldKey, customFieldValues, MAX_CUSTOM_FIELDS, MAX_CUSTOM_VALUES_BYTES };

// Custom fields (ADR 0032): extra questions a project asks on its report form. The definitions live in the
// `custom_field` table (one row per field), the answers on `feedback.custom_fields` as a `{ key: value }` map.
// This module is the single source of truth for what a field is and what a value may be: the dashboard
// builder, the API, the widget's lazy `fields` chunk (which re-implements the same rules in a few lines
// because it cannot import this package) and the automation engine all agree with it. The server never
// trusts a value because the widget validated it.

export const CUSTOM_FIELD_TYPES = [
  "text",
  "textarea",
  "select",
  "multiselect",
  "checkbox",
  "number",
  "date",
  "url",
  "email",
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

/** `reporter` fields are asked in the widget form; `internal` fields are filled in by the team in the dashboard. */
export const CUSTOM_FIELD_AUDIENCES = ["reporter", "internal"] as const;
export type CustomFieldAudience = (typeof CUSTOM_FIELD_AUDIENCES)[number];

export const MAX_FIELD_OPTIONS = 50;

/** Characters a text answer may have, by type (the builder can only lower a limit, never raise it). */
export const TEXT_LIMITS = { text: 500, textarea: 2000, url: 2000, email: 254, option: 100 } as const;

export const DEFAULT_FIELD_KINDS = ["bug", "idea", "question"] as const;

export const customFieldOption = z.object({
  value: z.string().trim().min(1).max(TEXT_LIMITS.option),
  label: z.string().trim().min(1).max(80),
});
export type CustomFieldOption = z.infer<typeof customFieldOption>;

/** Translations of a field's text, by widget locale (the project supplies them; labels are never machine-translated). */
export const customFieldStrings = z.partialRecord(
  z.enum(LOCALES),
  z.object({
    label: z.string().trim().max(80).optional(),
    helpText: z.string().trim().max(300).optional(),
    placeholder: z.string().trim().max(120).optional(),
    /** Option label by option value. */
    options: z.record(z.string().max(TEXT_LIMITS.option), z.string().trim().max(80)).optional(),
  }),
);
export type CustomFieldStrings = z.infer<typeof customFieldStrings>;

const num = z.number();
const isoDate = z.iso.date();

/** Rules beyond "required". Each applies to the types named; others are dropped on save. */
export const customFieldValidation = z.object({
  /** text, textarea */
  minLength: z.number().int().min(0).max(TEXT_LIMITS.textarea).optional(),
  maxLength: z.number().int().min(1).max(TEXT_LIMITS.textarea).optional(),
  /** number */
  min: num.optional(),
  max: num.optional(),
  integer: z.boolean().optional(),
  /** date, as `YYYY-MM-DD` */
  minDate: isoDate.optional(),
  maxDate: isoDate.optional(),
  /** multiselect */
  minSelected: z.number().int().min(0).max(MAX_FIELD_OPTIONS).optional(),
  maxSelected: z.number().int().min(1).max(MAX_FIELD_OPTIONS).optional(),
});
export type CustomFieldValidation = z.infer<typeof customFieldValidation>;

/** The rule keys that make sense for a type. */
const RULES: Record<CustomFieldType, readonly (keyof CustomFieldValidation)[]> = {
  text: ["minLength", "maxLength"],
  textarea: ["minLength", "maxLength"],
  select: [],
  multiselect: ["minSelected", "maxSelected"],
  checkbox: [],
  number: ["min", "max", "integer"],
  date: ["minDate", "maxDate"],
  url: [],
  email: [],
};

/** An answer: what a stored `custom_fields` map holds. Empty answers are not stored. */
export type CustomFieldValue = string | number | boolean | string[];
export type CustomFieldValues = Record<string, CustomFieldValue>;

const fieldShape = {
  key: customFieldKey,
  type: z.enum(CUSTOM_FIELD_TYPES),
  label: z.string().trim().min(1, "Give the field a label").max(80),
  helpText: z.string().trim().max(300).default(""),
  placeholder: z.string().trim().max(120).default(""),
  required: z.boolean().default(false),
  audience: z.enum(CUSTOM_FIELD_AUDIENCES).default("reporter"),
  /** Feedback kinds this field belongs to (an item of another kind neither shows nor asks it). */
  kinds: z
    .array(z.enum(FEEDBACK_KINDS))
    .min(1, "Pick at least one type")
    .max(FEEDBACK_KINDS.length)
    .default([...DEFAULT_FIELD_KINDS]),
  options: z.array(customFieldOption).max(MAX_FIELD_OPTIONS).default([]),
  defaultValue: z.unknown().default(null),
  validation: customFieldValidation.default({}),
  /** Holds personal data: masked from webhooks, exports, AI and agent briefs when the project is in privacy mode. */
  pii: z.boolean().default(false),
  strings: customFieldStrings.default({}),
};

type FieldBase = {
  key: string;
  type: CustomFieldType;
  label: string;
  helpText: string;
  placeholder: string;
  required: boolean;
  audience: CustomFieldAudience;
  kinds: (typeof FEEDBACK_KINDS)[number][];
  options: CustomFieldOption[];
  defaultValue: unknown;
  validation: CustomFieldValidation;
  pii: boolean;
  strings: CustomFieldStrings;
};

/** The plain shape of a field; `customFieldInput` adds the cross-field rules. */
export const customFieldBase = z.object(fieldShape);

/** A field with every default filled in: what the builder edits. */
export type CustomFieldBase = z.output<typeof customFieldBase>;

/** A field as the builder saves it (`PUT /api/projects/:id/custom-fields`). */
export const customFieldInput = customFieldBase.transform((f, ctx): FieldBase => {
  const out: FieldBase = {
    ...f,
    kinds: [...new Set(f.kinds)],
    options: [],
    validation: {},
    strings: f.strings,
  };
  const choice = f.type === "select" || f.type === "multiselect";
  if (choice) {
    if (!f.options.length) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Add at least one option" });
      return z.NEVER;
    }
    const seen = new Set<string>();
    for (const o of f.options) {
      if (seen.has(o.value)) {
        ctx.addIssue({ code: "custom", path: ["options"], message: `Option "${o.value}" is listed twice` });
        return z.NEVER;
      }
      seen.add(o.value);
    }
    out.options = f.options;
  }
  // Only the rules the type understands survive, so a type change never leaves a stray limit behind.
  for (const rule of RULES[f.type]) {
    const v = f.validation[rule];
    if (v !== undefined) Object.assign(out.validation, { [rule]: v });
  }
  const v = out.validation;
  const order: [keyof CustomFieldValidation, keyof CustomFieldValidation][] = [
    ["minLength", "maxLength"],
    ["min", "max"],
    ["minDate", "maxDate"],
    ["minSelected", "maxSelected"],
  ];
  for (const [lo, hi] of order) {
    const a = v[lo];
    const b = v[hi];
    if (a !== undefined && b !== undefined && a > b) {
      ctx.addIssue({ code: "custom", path: ["validation", lo], message: "The minimum is above the maximum" });
      return z.NEVER;
    }
  }
  if (v.maxLength !== undefined && v.maxLength > TEXT_LIMITS[f.type === "textarea" ? "textarea" : "text"]) {
    ctx.addIssue({
      code: "custom",
      path: ["validation", "maxLength"],
      message: `At most ${TEXT_LIMITS[f.type === "textarea" ? "textarea" : "text"]} characters`,
    });
    return z.NEVER;
  }
  if (v.maxSelected !== undefined && v.maxSelected > out.options.length) {
    ctx.addIssue({
      code: "custom",
      path: ["validation", "maxSelected"],
      message: "More than the number of options",
    });
    return z.NEVER;
  }
  if (f.audience === "internal" && f.required) {
    ctx.addIssue({
      code: "custom",
      path: ["required"],
      message: "Internal fields can't be required: reporters never see them",
    });
    return z.NEVER;
  }
  // Only options that exist may be translated; unknown option keys are dropped.
  const values = new Set(out.options.map((o) => o.value));
  const strings: CustomFieldStrings = {};
  for (const [loc, s] of Object.entries(f.strings) as [
    keyof CustomFieldStrings,
    NonNullable<CustomFieldStrings[keyof CustomFieldStrings]>,
  ][]) {
    const opts = Object.fromEntries(
      Object.entries(s.options ?? {}).filter(([k, label]) => values.has(k) && label),
    );
    const clean = {
      ...(s.label ? { label: s.label } : {}),
      ...(s.helpText ? { helpText: s.helpText } : {}),
      ...(s.placeholder ? { placeholder: s.placeholder } : {}),
      ...(Object.keys(opts).length ? { options: opts } : {}),
    };
    if (Object.keys(clean).length) strings[loc] = clean;
  }
  out.strings = strings;
  const dv = f.defaultValue;
  if (dv !== null && dv !== undefined) {
    const r = normalizeValue(out, dv);
    if (!r.ok) {
      ctx.addIssue({
        code: "custom",
        path: ["defaultValue"],
        message: `Default value: ${issueMessage(r.issue)}`,
      });
      return z.NEVER;
    }
    out.defaultValue = r.value ?? null;
  } else out.defaultValue = null;
  return out;
});
export type CustomFieldInput = z.infer<typeof customFieldInput>;
export type CustomFieldInputRaw = z.input<typeof customFieldInput>;

/** `PUT /api/projects/:id/custom-fields`: the whole ordered set; fields missing from it are deleted with their answers. */
export const customFieldsReplace = z.object({
  fields: z
    .array(customFieldInput)
    .max(MAX_CUSTOM_FIELDS, `At most ${MAX_CUSTOM_FIELDS} fields`)
    .superRefine((fields, ctx) => {
      const seen = new Set<string>();
      for (const [i, f] of fields.entries()) {
        if (seen.has(f.key))
          ctx.addIssue({ code: "custom", path: [i, "key"], message: `Key "${f.key}" is used twice` });
        seen.add(f.key);
      }
    }),
});
export type CustomFieldsReplace = z.infer<typeof customFieldsReplace>;

/** A stored field definition, as the API returns it (`GET /api/projects/:id/custom-fields`). */
export const apiCustomField = customFieldBase.extend({
  id: z.string(),
  projectId: z.string(),
  position: z.number().int(),
});
export type CustomFieldDef = CustomFieldInput & { id: string; projectId: string; position: number };

// --- Values -----------------------------------------------------------------------------------------------

export type FieldIssueCode =
  | "required"
  | "type"
  | "too_short"
  | "too_long"
  | "too_small"
  | "too_big"
  | "not_integer"
  | "bad_option"
  | "bad_email"
  | "bad_url"
  | "bad_date"
  | "too_few"
  | "too_many"
  | "unknown_field"
  | "too_large";
export type FieldIssue = { code: FieldIssueCode; limit?: number | string };
export type FieldProblem = FieldIssue & { key: string; label: string };

export function issueMessage(i: FieldIssue): string {
  const limit = i.limit === undefined ? "" : String(i.limit);
  switch (i.code) {
    case "required":
      return "is required";
    case "type":
      return "has the wrong type of value";
    case "too_short":
      return `needs at least ${limit} characters`;
    case "too_long":
      return `allows at most ${limit} characters`;
    case "too_small":
      return `must be at least ${limit}`;
    case "too_big":
      return `must be at most ${limit}`;
    case "not_integer":
      return "must be a whole number";
    case "bad_option":
      return "is not one of the options";
    case "bad_email":
      return "is not a valid email address";
    case "bad_url":
      return "is not a valid http(s) link";
    case "bad_date":
      return "is not a valid date (YYYY-MM-DD)";
    case "too_few":
      return `needs at least ${limit} choices`;
    case "too_many":
      return `allows at most ${limit} choices`;
    case "unknown_field":
      return "is not a field of this item";
    case "too_large":
      return "answers are too large";
  }
}

type Normalized = { ok: true; value: CustomFieldValue | undefined } | { ok: false; issue: FieldIssue };
type Def = Pick<CustomFieldInput, "type" | "required" | "options" | "validation">;

const fail = (code: FieldIssueCode, limit?: number | string): Normalized => ({
  ok: false,
  issue: limit === undefined ? { code } : { code, limit },
});
const EMAIL = z.email();
const HTTP_URL = z.url({ protocol: /^https?$/ });

/** True for a real calendar date written `YYYY-MM-DD`. */
export const isCalendarDate = (s: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
};

/**
 * One answer against one field. `value: undefined` means "empty" (nothing to store) and is `ok` unless the
 * field is required (the caller decides about required: `normalizeValue` only judges what is present).
 */
export function normalizeValue(def: Def, raw: unknown): Normalized {
  if (raw === null || raw === undefined) return { ok: true, value: undefined };
  const v = def.validation;
  switch (def.type) {
    case "text":
    case "textarea":
    case "url":
    case "email": {
      if (typeof raw !== "string") return fail("type");
      const s = raw.trim();
      if (!s) return { ok: true, value: undefined };
      const cap = def.type === "textarea" ? TEXT_LIMITS.textarea : TEXT_LIMITS[def.type];
      const max = Math.min(cap, v.maxLength ?? cap);
      if (s.length > max) return fail("too_long", max);
      if (v.minLength !== undefined && s.length < v.minLength) return fail("too_short", v.minLength);
      if (def.type === "email" && !EMAIL.safeParse(s).success) return fail("bad_email");
      if (def.type === "url" && !HTTP_URL.safeParse(s).success) return fail("bad_url");
      return { ok: true, value: s };
    }
    case "number": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return fail("type");
      if (v.integer && !Number.isInteger(raw)) return fail("not_integer");
      if (v.min !== undefined && raw < v.min) return fail("too_small", v.min);
      if (v.max !== undefined && raw > v.max) return fail("too_big", v.max);
      return { ok: true, value: raw };
    }
    case "checkbox":
      return typeof raw === "boolean" ? { ok: true, value: raw } : fail("type");
    case "date": {
      if (typeof raw !== "string") return fail("type");
      const s = raw.trim();
      if (!s) return { ok: true, value: undefined };
      if (!isCalendarDate(s)) return fail("bad_date");
      if (v.minDate !== undefined && s < v.minDate) return fail("too_small", v.minDate);
      if (v.maxDate !== undefined && s > v.maxDate) return fail("too_big", v.maxDate);
      return { ok: true, value: s };
    }
    case "select": {
      if (typeof raw !== "string") return fail("type");
      if (!raw) return { ok: true, value: undefined };
      return def.options.some((o) => o.value === raw) ? { ok: true, value: raw } : fail("bad_option");
    }
    case "multiselect": {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) return fail("type");
      const list = [...new Set(raw as string[])];
      if (!list.length) return { ok: true, value: undefined };
      if (list.some((x) => !def.options.some((o) => o.value === x))) return fail("bad_option");
      if (v.minSelected !== undefined && list.length < v.minSelected) return fail("too_few", v.minSelected);
      if (v.maxSelected !== undefined && list.length > v.maxSelected) return fail("too_many", v.maxSelected);
      // Stored in the order the options are listed, so equal answers compare equal.
      return { ok: true, value: def.options.map((o) => o.value).filter((x) => list.includes(x)) };
    }
  }
}

type Keyed = Def & {
  key: string;
  label: string;
  audience: CustomFieldAudience;
  kinds: readonly string[];
  defaultValue: unknown;
};

/** "Required" means present; for a checkbox, ticked. */
const present = (def: Def, v: CustomFieldValue | undefined): boolean =>
  v !== undefined && (def.type === "checkbox" ? v === true : true);

export type ResolvedValues = {
  values: CustomFieldValues;
  problems: FieldProblem[];
};

/**
 * A new item's answers (widget or API ingest). Only fields that apply (the reporter's own, for this kind) are read:
 * answers to internal, other-kind or unknown fields are dropped silently, so a stale widget config never
 * fails a report. Present answers are validated; missing ones get the field's default, and a missing
 * required one is a problem.
 */
export function resolveNewValues(
  fields: readonly Keyed[],
  raw: Record<string, unknown> | undefined,
  kind: string,
): ResolvedValues {
  const values: CustomFieldValues = {};
  const problems: FieldProblem[] = [];
  for (const f of fields) {
    if (f.audience !== "reporter" || !f.kinds.includes(kind)) continue;
    const given = raw && Object.hasOwn(raw, f.key) ? normalizeValue(f, raw[f.key]) : null;
    if (given && !given.ok) {
      problems.push({ ...given.issue, key: f.key, label: f.label });
      continue;
    }
    let v = given?.ok ? given.value : undefined;
    if (v === undefined && f.defaultValue !== null && f.defaultValue !== undefined) {
      const d = normalizeValue(f, f.defaultValue);
      if (d.ok) v = d.value;
    }
    if (f.required && !present(f, v)) problems.push({ code: "required", key: f.key, label: f.label });
    else if (v !== undefined) values[f.key] = v;
  }
  return capped(values, problems);
}

/**
 * The team's edit (dashboard or token API): `patch` names the fields to set; `null` clears one. Any audience
 * may be edited, but only fields that belong to the item's kind. Fields not named are left alone, so a
 * required field added after the item was filed doesn't block unrelated edits.
 */
export function resolvePatchValues(
  fields: readonly Keyed[],
  current: CustomFieldValues,
  patch: Record<string, unknown>,
  kind: string,
): ResolvedValues & { changed: string[] } {
  let values: CustomFieldValues = { ...current };
  const problems: FieldProblem[] = [];
  const changed: string[] = [];
  for (const [key, raw] of Object.entries(patch)) {
    const f = fields.find((x) => x.key === key);
    if (!f?.kinds.includes(kind)) {
      problems.push({ code: "unknown_field", key, label: f?.label ?? key });
      continue;
    }
    const r = normalizeValue(f, raw);
    if (!r.ok) {
      problems.push({ ...r.issue, key, label: f.label });
      continue;
    }
    if (f.required && !present(f, r.value)) {
      problems.push({ code: "required", key, label: f.label });
      continue;
    }
    if (JSON.stringify(values[key] ?? null) === JSON.stringify(r.value ?? null)) continue;
    if (r.value === undefined) values = omit(values, key);
    else values[key] = r.value;
    changed.push(key);
  }
  return { ...capped(values, problems), changed };
}

const omit = (values: CustomFieldValues, key: string): CustomFieldValues =>
  Object.fromEntries(Object.entries(values).filter(([k]) => k !== key));

function capped(values: CustomFieldValues, problems: FieldProblem[]): ResolvedValues {
  if (JSON.stringify(values).length > MAX_CUSTOM_VALUES_BYTES) {
    problems.push({ code: "too_large", key: "", label: "" });
  }
  return { values, problems };
}

export const describeProblems = (problems: readonly FieldProblem[]): string =>
  problems.map((p) => (p.label ? `${p.label} ${issueMessage(p)}` : issueMessage(p))).join("; ");

// --- Presentation helpers -------------------------------------------------------------------------------

/** The text to show for a stored answer ("Yes", "A, B", the option's label), for lists, exports and messages. */
export function formatValue(
  def: Pick<CustomFieldInput, "type" | "options">,
  value: unknown,
  yes = "Yes",
  no = "No",
): string {
  if (value === undefined || value === null) return "";
  const label = (v: string) => def.options.find((o) => o.value === v)?.label ?? v;
  if (typeof value === "boolean") return value ? yes : no;
  if (Array.isArray(value)) return value.map((x) => label(String(x))).join(", ");
  if (def.type === "select" && typeof value === "string") return label(value);
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** Replacement shown where a PII answer is withheld. */
export const REDACTED = "[redacted]";

/**
 * The answers for an outbound channel (webhooks, exports, AI, agent briefs). In a project's privacy mode,
 * answers of fields flagged `pii` are replaced by `[redacted]`. Keys without a field are dropped.
 */
export function outboundValues(
  fields: readonly Pick<CustomFieldInput, "key" | "pii">[],
  values: Record<string, unknown> | null | undefined,
  privacyMode: boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!values) return out;
  for (const f of fields) {
    if (!Object.hasOwn(values, f.key)) continue;
    out[f.key] = privacyMode && f.pii ? REDACTED : values[f.key];
  }
  return out;
}

/** What `GET /w/config` hands the widget: reporter fields only, with nothing internal (`pii`, `audience`). */
export type PublicCustomField = Pick<
  CustomFieldInput,
  | "key"
  | "type"
  | "label"
  | "helpText"
  | "placeholder"
  | "required"
  | "kinds"
  | "options"
  | "defaultValue"
  | "validation"
  | "strings"
>;

export function publicFields(
  fields: readonly (CustomFieldInput & { position?: number })[],
): PublicCustomField[] {
  return fields
    .filter((f) => f.audience === "reporter")
    .map((f) => ({
      key: f.key,
      type: f.type,
      label: f.label,
      helpText: f.helpText,
      placeholder: f.placeholder,
      required: f.required,
      kinds: f.kinds,
      options: f.options,
      defaultValue: f.defaultValue,
      validation: f.validation,
      strings: f.strings,
    }));
}

export function parseCustomFieldFilter(cf: string): { key: string; value: string } {
  const i = cf.indexOf(":");
  return { key: cf.slice(0, i), value: cf.slice(i + 1) };
}
