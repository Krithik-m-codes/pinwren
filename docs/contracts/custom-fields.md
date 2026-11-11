# Custom fields and the form builder: contract

Design: `docs/adr/0032-custom-fields-and-form-builder.md`. Schemas and the validator live in
`packages/core/src/custom-fields.ts` (and the key/value/filter pieces in `schemas.ts`); the storage is migration
`0015` (`custom_field`, `feedback.custom_fields`). Every route below is in `tenant-route-inventory.json` (`tenant`,
`finite`) and has a `cloud-routes-db.test.ts` case; viewers get `403 READ_ONLY_ROLE` on writes.

## Field definition

```ts
type CustomFieldType =
  "text" | "textarea" | "select" | "multiselect" | "checkbox" | "number" | "date" | "url" | "email";

type CustomField = {
  id: string;
  projectId: string;
  position: number; // 0-based display order
  key: string; // ^[a-z][a-z0-9_]{0,39}$, unique per project, fixed once saved
  type: CustomFieldType;
  label: string; // 1..80
  helpText: string; // ≤ 300
  placeholder: string; // ≤ 120
  required: boolean; // never for audience "internal"; a checkbox must be ticked
  audience: "reporter" | "internal";
  kinds: ("comment" | "bug" | "idea" | "question")[]; // default ["bug","idea","question"]
  options: { value: string; label: string }[]; // select / multiselect only, 1..50, unique values
  defaultValue: unknown | null; // validated like an answer
  validation: {
    minLength?;
    maxLength?; // text, textarea (caps 500 / 2000)
    min?;
    max?;
    integer?; // number
    minDate?;
    maxDate?; // date, "YYYY-MM-DD"
    minSelected?;
    maxSelected?; // multiselect
  }; // rules a type doesn't understand are dropped on save
  pii: boolean; // redacted from outbound channels in a privacy-mode project
  strings: Partial<
    Record<Locale, { label?; helpText?; placeholder?; options?: Record<optionValue, string> }>
  >;
};
```

## Routes

| Method and path                          | Permission            | Body                             | Answer       |
| ---------------------------------------- | --------------------- | -------------------------------- | ------------ |
| `GET /api/projects/:id/custom-fields`    | read                  |                                  | `{ fields }` |
| `PUT /api/projects/:id/custom-fields`    | `projects.manage`     | `{ fields: CustomFieldInput[] }` | `{ fields }` |
| `GET /api/v1/projects/:id/custom-fields` | token `feedback:read` |                                  | `{ fields }` |

`PUT` replaces the whole ordered form (≤ 20 fields, unique keys) in one transaction. Fields missing from the body are
deleted; so are a field's answers when its key is removed or its type changes to an incompatible one (short ↔ long text
keeps them). Invalid definitions answer `400` with the validation issues.

## Answers

Stored on `feedback.custom_fields` as `{ [key]: string | number | boolean | string[] }`; empty answers are not stored.

- **Widget ingest** — `POST /w/feedback` takes `customFields: { [key]: unknown }` (≤ 64 KB of JSON before validation).
  The server keeps the fields with `audience: "reporter"` that list the report's kind; answers to any other key are
  ignored; missing answers get the default; invalid or missing required answers are `400 INVALID_CUSTOM_FIELDS` with
  the problems in the message (`Order number is required`). Stored answers are ≤ 32 KB. A project in
  `readOnly` still refuses reports first.
- **Team edit** — `PATCH /api/feedback/:id` (and `/api/v1/feedback/:id`, scope `feedback:write`) takes
  `customFields: { [key]: value | null }`: named keys are set (`null` clears), others keep their answer. Fields must
  belong to the item's kind (after any `kind` change in the same patch); required fields can't be cleared; `400
INVALID_CUSTOM_FIELDS` otherwise. Each changed key adds a `customField_changed` activity row
  `{ key, label, from, to, fromText, toText }` and the update event carries `changes.customFields`.
- **Read** — `feedback.customFields` on list rows, details and the token API.

## `GET /w/config`

`widget.customFields`: the reporter fields as `{ key, type, label, helpText, placeholder, required, kinds, options,
defaultValue, validation, strings }`, in order. Internal fields, `audience` and `pii` are never included.

## List filter and exports

- `GET /api/feedback?cf=key:value` (also `/api/v1/feedback`, `ViewFilters.cf`): `*` any answer, `!` none; otherwise
  text types match by case-insensitive substring (`%`/`_` literal), `select`/`multiselect`/`date` by membership /
  equality, `number` numerically, `checkbox` `true`/`false`. Unknown keys match nothing.
- `GET /api/feedback/export`: CSV gets a column per field key (header = the field's label, the first project's label
  for a shared key), JSON items get `customFields`, PDF items list `Label: value` lines. PII fields read
  `[redacted]` in privacy-mode projects.

## Webhooks and events

`data.feedback.customFields` (key → value) on every generic delivery; `feedback.updated` carries
`changes.customFields: { from, to }` when the team edits answers. PII fields are redacted in privacy mode.

## Automation

`Condition` gains `{ field: "customField", key, op, value? }` with `op` in `equals | not_equals | contains | gt | lt |
is_set | is_not_set` (`value` required except for `is_set` / `is_not_set`). `equals` / `contains` are
case-insensitive; arrays (multi-select) match any element; `gt` / `lt` compare numbers numerically and dates
(`YYYY-MM-DD`) by day; an unanswered field never matches a comparison except `not_equals` and `is_not_set`. Saving a
rule whose `key` isn't a field of the project is `400 INVALID_RULE`. The dry-run sample takes `customFields`.

## SDK, MCP, CLI

SDK: `customFields.list(projectId)`, `FeedbackUpdate.customFields`, `FeedbackListQuery.cf`, `CustomField` type. MCP:
`list_custom_fields`; `update_feedback` takes `customFields`; `search_feedback` takes `customField`; `get_feedback`
returns `customFields`.
