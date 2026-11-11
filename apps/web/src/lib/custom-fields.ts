import type { CustomFieldBase, CustomFieldType, CustomFieldValue, FieldIssueCode } from "@pinwren/core";
import {
  AtSign,
  Calendar,
  CheckSquare,
  Hash,
  Link2,
  type LucideIcon,
  ListChecks,
  ListTodo,
  Text,
  TextCursorInput,
} from "lucide-react";
import type { Key } from "@/lib/i18n/en";

// Client helpers of the form builder and of the item's custom field card (ADR 0029).

export const FIELD_TYPE_META: Record<CustomFieldType, { labelKey: Key; icon: LucideIcon }> = {
  text: { labelKey: "cfields.typeText", icon: TextCursorInput },
  textarea: { labelKey: "cfields.typeTextarea", icon: Text },
  select: { labelKey: "cfields.typeSelect", icon: ListTodo },
  multiselect: { labelKey: "cfields.typeMultiselect", icon: ListChecks },
  checkbox: { labelKey: "cfields.typeCheckbox", icon: CheckSquare },
  number: { labelKey: "cfields.typeNumber", icon: Hash },
  date: { labelKey: "cfields.typeDate", icon: Calendar },
  url: { labelKey: "cfields.typeUrl", icon: Link2 },
  email: { labelKey: "cfields.typeEmail", icon: AtSign },
};

/** The message for a problem code (the same codes the API reports), worded in the dashboard's language. */
export const ISSUE_KEY: Record<FieldIssueCode, Key> = {
  required: "cfields.errRequired",
  type: "cfields.errType",
  too_short: "cfields.errTooShort",
  too_long: "cfields.errTooLong",
  too_small: "cfields.errTooSmall",
  too_big: "cfields.errTooBig",
  not_integer: "cfields.errNotInteger",
  bad_option: "cfields.errBadOption",
  bad_email: "cfields.errBadEmail",
  bad_url: "cfields.errBadUrl",
  bad_date: "cfields.errBadDate",
  too_few: "cfields.errTooFew",
  too_many: "cfields.errTooMany",
  unknown_field: "cfields.errUnknown",
  too_large: "cfields.errTooLarge",
};

/** A field key from a label: `Order number` → `order_number`, unique among `taken` (`order_number_2`). */
export function keyFromLabel(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^[0-9_]+/, "")
      .slice(0, 34) || "field";
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
  return `${base}_${Date.now() % 10_000}`;
}

/** An option's value from its label (lower-case words joined by `-`), unique among `taken`. */
export function optionValue(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "option";
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now() % 10_000}`;
}

/** `YYYY-MM-DD` ⇄ a local calendar date (the date picker works in local time; answers are plain days). */
export function dayToDate(day: unknown): Date | null {
  const m = typeof day === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
export function dateToDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A new field with the defaults the API would fill in. */
export function blankField(taken: ReadonlySet<string>, type: CustomFieldType = "text"): CustomFieldBase {
  return {
    key: keyFromLabel("", taken),
    type,
    label: "",
    helpText: "",
    placeholder: "",
    required: false,
    audience: "reporter",
    kinds: ["bug", "idea", "question"],
    options: type === "select" || type === "multiselect" ? [{ value: "option-1", label: "" }] : [],
    defaultValue: null,
    validation: {},
    pii: type === "email",
    strings: {},
  };
}

/** The empty-looking answer of a type (so a control is always controlled). */
export const isEmptyAnswer = (v: unknown): boolean =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** Narrow an API answer to what a control of `type` shows. */
export function answerFor(type: CustomFieldType, v: unknown): CustomFieldValue | null {
  if (isEmptyAnswer(v)) return null;
  if (type === "checkbox") return typeof v === "boolean" ? v : null;
  if (type === "number") return typeof v === "number" ? v : null;
  if (type === "multiselect") return Array.isArray(v) ? v.map(String) : null;
  return typeof v === "string" ? v : null;
}
