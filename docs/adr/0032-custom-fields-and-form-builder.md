# ADR 0032 — Custom fields and the form builder

**Status:** accepted

## Context

Usersnap and Userback let a project add its own questions to the report form. Pinwren's report carried only a title,
a description and a severity, so teams had no place for an order number, a plan or an account id, and nothing to
filter, export or automate on. The widget has hard size budgets (core 35 KB gzip, with only a few bytes of headroom;
report chunk 15 KB), the Cloud tenant boundary (`docs/security/cloud-tenant-isolation.md`) applies to every new table,
and the server must never trust the widget.

## Decision

1. **Definitions are a tenant table, answers are a JSONB column.** Migration `0015` adds `custom_field` (one row per
   field of a project: key, type, label, help text, placeholder, required, audience, kinds, options, default,
   validation, `pii`, per-locale strings, position) with a direct `org_id`, the `pinwren_tenant` policy, a composite
   `(project_id, org_id)` foreign key and a unique `(project_id, key)`; and `feedback.custom_fields jsonb` (`{ key:
value }`, empty answers not stored) with a `jsonb_path_ops` GIN index. The table is in the tenant inventory.
2. **The key is the identity.** Answers, the API, exports, webhooks and automation conditions refer to a field by its
   key (`^[a-z][a-z0-9_]{0,39}$`), which is fixed once saved. Deleting a field, or changing its type to an
   incompatible one (anything but short ↔ long text), strips the key from every item of the project in the same
   transaction, so there are no orphan answers and no re-typed leftovers.
3. **The form is saved as a whole.** `PUT /api/projects/:id/custom-fields` replaces the ordered set under a lock on the
   project row (admins, `projects.manage`); at most 20 fields, 50 options per choice field. The builder, import/export
   and ordering all use this one endpoint. Reads are open to anyone who sees the project; the token API only reads
   (`GET /api/v1/projects/:id/custom-fields`).
4. **One validator, in `@pinwren/core`.** `normalizeValue`, `resolveNewValues` (widget ingest) and `resolvePatchValues`
   (team edits) define what a value may be per type (text and long text with length rules, select and multi-select
   against the options, checkbox, finite numbers with range and integer rules, calendar dates, `http(s)` links only,
   emails). The server runs it on every ingest and edit. Ingest keeps only fields that are for the reporter and the
   report's kind; answers to internal, other-kind or unknown fields are dropped silently (a stale widget config never
   fails a report), invalid or missing required ones are a `400` with the field named. Defaults apply when an answer
   is missing. A set of answers is capped at 32 KB; a text field at 500 characters, long text at 2,000.
5. **Audience and kinds.** `reporter` fields are asked in the widget; `internal` fields are never put in `/w/config` or
   any public response and cannot be required. `kinds` limits a field to report types. The widget's report form is
   the bug report, so only `bug` fields render there; other types are filled in by the team in the dashboard. (Asking
   questions in the pin comment composer needs core code the size budget doesn't allow today; it is a follow-up.)
6. **Widget: a lazy `fields` chunk.** `GET /w/config` carries `widget.customFields` (reporter fields, no `audience` or
   `pii`). `widget.js` only passes the raw list on (`customFields: []` in the config defaults); the report chunk loads
   `widget-fields.<hash>.js` (budget 5 KB gzip, ~3.4 KB) when the list is non-empty. The chunk sanitises the list,
   renders each type with labels, help text and `aria-describedby`/`aria-invalid`/`role=alert` wiring, validates
   before sending, uses the project's per-locale strings (fallback to the base text), and writes everything through
   `textContent` or attributes. Its own messages are widget i18n keys in all ten locales. Drafts keep the answers and
   the offline outbox sends them like the rest of the report.
   To make room for the chunk's manifest entry, the manifest compiled into `widget.js` now maps chunk name to its
   content hash only (`chunkUrl` rebuilds `widget-<name>.<hash>.js`); the core is smaller than before (35,792 against
   35,834 bytes gzip).
7. **Where answers go.** Item detail and list rows (`customFields`), CSV/JSON/PDF exports (a column per field key; JSON
   `customFields` object), the project export zip (`custom-fields.json`), webhook payloads
   (`data.feedback.customFields`, and `changes.customFields` for team edits), the agent brief and reproduction context
   (reporter fields only), the SDK (`customFields.list`, `FeedbackUpdate.customFields`), MCP (`list_custom_fields`,
   `update_feedback`, `search_feedback`'s `customField`). Team edits are logged per field on the timeline
   (`customField_changed`). The inbox filter is `cf=key:value` (`*` any answer, `!` none): text fields match by
   substring, choices by membership, numbers and checkboxes exactly, dates by day, resolved per item from the field's
   own type.
8. **Privacy.** A field flagged `pii` (default for email fields) is replaced by `[redacted]` in exports, webhooks,
   event payloads and agent briefs when the project is in privacy mode. It stays stored and visible to the team. AI
   triage never receives custom field answers.
9. **Automation.** A ninth condition, `customField` (`key`, `op`: equals, not equals, contains, greater, less, is set,
   is not set, `value`), is evaluated from the stored answers; saving a rule that names a field the project doesn't
   have is refused. Several can be combined (AND), like the other conditions.

## Consequences

- Retyping or removing a field deletes data; the builder asks for confirmation naming the fields, and the API treats
  the PUT as the confirmation.
- Webhook payloads gain an optional `customFields` object (additive; `apiVersion` is unchanged).
- A `cf` filter on a key that exists in several projects with different types is evaluated per item against its own
  project's definition.
- Select/multi-select answers keep the option value even when the option is later removed or renamed (the label is
  looked up at display time and falls back to the value).
- Idea/question/comment reports get no custom questions in the widget until the composer can host them.
