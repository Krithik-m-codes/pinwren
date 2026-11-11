import {
  type CustomFieldDef,
  type CustomFieldInput,
  describeProblems,
  type FieldProblem,
  formatValue,
  MAX_CUSTOM_FIELDS,
  outboundValues,
  parseWidgetConfig,
  publicFields,
  REDACTED,
  resolveNewValues,
  type CustomFieldValues,
} from "@pinwren/core";
import { customField, feedback, getDb, project } from "@pinwren/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { ApiError, notFound } from "../errors";

// Custom fields (ADR 0029): project-level definitions and the checks every answer goes through. Definitions are
// tenant rows (`custom_field`, RLS `pinwren_tenant`); answers are a JSONB map on `feedback`.

type Row = typeof customField.$inferSelect;

const KINDS = ["comment", "bug", "idea", "question"] as const;

export function fieldOut(r: Row): CustomFieldDef {
  return {
    id: r.id,
    projectId: r.projectId,
    position: r.position,
    key: r.key,
    type: r.type,
    label: r.label,
    helpText: r.helpText,
    placeholder: r.placeholder,
    required: r.required,
    audience: r.audience,
    kinds: r.kinds.filter((k): k is (typeof KINDS)[number] => (KINDS as readonly string[]).includes(k)),
    options: r.options,
    defaultValue: r.defaultValue ?? null,
    validation: r.validation,
    pii: r.pii,
    strings: r.strings,
  };
}

/** A project's fields, in the order the form shows them. */
export async function listFields(orgId: string, projectId: string): Promise<CustomFieldDef[]> {
  const rows = await getDb()
    .select()
    .from(customField)
    .where(and(eq(customField.orgId, orgId), eq(customField.projectId, projectId)))
    .orderBy(asc(customField.position), asc(customField.key));
  return rows.map(fieldOut);
}

/** The fields of one project, only if the project belongs to the organisation (404 otherwise). */
export async function listFieldsOfProject(orgId: string, projectId: string): Promise<CustomFieldDef[]> {
  const [p] = await getDb()
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.orgId, orgId)));
  if (!p) throw notFound("Project");
  return listFields(orgId, projectId);
}

/** Fields of several projects at once (exports), by project id. */
export async function listFieldsByProject(
  orgId: string,
  projectIds: readonly string[],
): Promise<Map<string, CustomFieldDef[]>> {
  const out = new Map<string, CustomFieldDef[]>();
  if (!projectIds.length) return out;
  const rows = await getDb()
    .select()
    .from(customField)
    .where(and(eq(customField.orgId, orgId), inArray(customField.projectId, [...projectIds])))
    .orderBy(asc(customField.position), asc(customField.key));
  for (const r of rows) {
    const list = out.get(r.projectId) ?? [];
    list.push(fieldOut(r));
    out.set(r.projectId, list);
  }
  return out;
}

/** Two types keep each other's answers when one is changed into the other. */
const compatible = (a: string, b: string) =>
  a === b || (["text", "textarea"].includes(a) && ["text", "textarea"].includes(b));

/**
 * Replace a project's whole form. Fields are matched by key: a changed definition is updated in place, a key
 * that is gone is deleted together with every answer to it (so no orphan answers linger), and so is a key whose
 * type changed incompatibly (its old answers no longer fit). Runs in one transaction under a lock on the project
 * row, so two admins saving at once serialise instead of interleaving.
 */
export async function replaceFields(
  orgId: string,
  projectId: string,
  next: readonly CustomFieldInput[],
): Promise<CustomFieldDef[]> {
  if (next.length > MAX_CUSTOM_FIELDS) {
    throw new ApiError(400, "TOO_MANY_FIELDS", `At most ${MAX_CUSTOM_FIELDS} fields per project`);
  }
  await getDb().transaction(async (tx) => {
    const [p] = await tx
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, projectId), eq(project.orgId, orgId)))
      .for("update");
    if (!p) throw notFound("Project");
    const existing = await tx
      .select()
      .from(customField)
      .where(and(eq(customField.orgId, orgId), eq(customField.projectId, projectId)));
    const byKey = new Map(existing.map((r) => [r.key, r]));
    const keep = new Set(next.map((f) => f.key));

    const drop = existing.filter((r) => !keep.has(r.key));
    const retyped = next.filter((f) => {
      const old = byKey.get(f.key);
      return old && !compatible(old.type, f.type);
    });
    const strip = [...drop.map((r) => r.key), ...retyped.map((f) => f.key)];
    if (drop.length) {
      await tx.delete(customField).where(
        and(
          eq(customField.projectId, projectId),
          inArray(
            customField.id,
            drop.map((r) => r.id),
          ),
        ),
      );
    }
    if (strip.length) {
      await tx
        .update(feedback)
        .set({
          customFields: sql`${feedback.customFields} - array[${sql.join(
            strip.map((k) => sql`${k}`),
            sql`, `,
          )}]::text[]`,
        })
        .where(and(eq(feedback.orgId, orgId), eq(feedback.projectId, projectId)));
    }
    for (const [position, f] of next.entries()) {
      const values = {
        key: f.key,
        type: f.type,
        label: f.label,
        helpText: f.helpText,
        placeholder: f.placeholder,
        required: f.required,
        audience: f.audience,
        kinds: f.kinds,
        options: f.options,
        defaultValue: f.defaultValue ?? null,
        validation: f.validation,
        pii: f.pii,
        strings: f.strings,
        position,
      };
      if (byKey.has(f.key)) {
        await tx
          .update(customField)
          .set({ ...values, updatedAt: new Date() })
          .where(and(eq(customField.projectId, projectId), eq(customField.key, f.key)));
      } else {
        await tx.insert(customField).values({ orgId, projectId, ...values });
      }
    }
  });
  return listFields(orgId, projectId);
}

/** 400 with the problems in plain words; the widget shows the message under its fields. */
export function invalidFields(problems: readonly FieldProblem[]): ApiError {
  return new ApiError(400, "INVALID_CUSTOM_FIELDS", describeProblems(problems));
}

/** The answers a new report carries, validated against the project's fields (never trust the widget). */
export async function answersForNewReport(
  orgId: string,
  projectId: string,
  raw: Record<string, unknown> | undefined,
  kind: string,
): Promise<CustomFieldValues> {
  const fields = await listFields(orgId, projectId);
  if (!fields.length) return {};
  const { values, problems } = resolveNewValues(fields, raw, kind);
  if (problems.length) throw invalidFields(problems);
  return values;
}

/** The widget's slice of the form (`GET /w/config`): reporter fields only. */
export async function widgetFields(orgId: string, projectId: string) {
  return publicFields(await listFields(orgId, projectId));
}

/** Is the project in privacy mode (answers of PII fields are masked on outbound channels)? */
export const privacyModeOf = (widgetConfig: unknown): boolean => parseWidgetConfig(widgetConfig).privacyMode;

/** The answers as an outbound channel (webhook, export, brief) may carry them. */
export async function outboundAnswers(
  orgId: string,
  projectId: string,
  values: Record<string, unknown> | null | undefined,
  widgetConfig: unknown,
): Promise<Record<string, unknown>> {
  if (!values || !Object.keys(values).length) return {};
  return outboundValues(await listFields(orgId, projectId), values, privacyModeOf(widgetConfig));
}

/** Same, loading the project's privacy setting itself (event payloads built from a stored row). */
export async function outboundAnswersOf(
  orgId: string,
  projectId: string,
  values: Record<string, unknown> | null | undefined,
): Promise<Record<string, unknown>> {
  if (!values || !Object.keys(values).length) return {};
  const [p] = await getDb()
    .select({ widgetConfig: project.widgetConfig })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.orgId, orgId)));
  return outboundAnswers(orgId, projectId, values, p?.widgetConfig);
}

/**
 * The reporter's answers as labelled lines for text outputs (the agent brief, the reproduction context): only
 * fields the reporter was asked, options by label, PII redacted in privacy mode. Internal notes stay out.
 */
export async function answerLines(
  orgId: string,
  projectId: string,
  values: Record<string, unknown> | null | undefined,
  widgetConfig: unknown,
): Promise<{ label: string; text: string }[]> {
  if (!values || !Object.keys(values).length) return [];
  const fields = (await listFields(orgId, projectId)).filter((f) => f.audience === "reporter");
  const out = outboundValues(fields, values, privacyModeOf(widgetConfig));
  return fields
    .filter((f) => Object.hasOwn(out, f.key))
    .map((f) => ({ label: f.label, text: out[f.key] === REDACTED ? REDACTED : formatValue(f, out[f.key]) }));
}
