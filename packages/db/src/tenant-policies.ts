import { PROFILE_PARTICIPANTS, isTenantProtected, type TenantTable } from "./tenant-inventory";

export type TenantPolicy = {
  name: string;
  command: "ALL" | "SELECT";
  role: string;
  using: string;
  check: string | null;
};

/** Canonical pg_get_expr forms; policy installation lives in versioned SQL migrations. */
export function tenantPolicyExpression(entry: TenantTable): string {
  if (entry.profileScope) {
    return `(${PROFILE_PARTICIPANTS.map(([table, column]) => `(EXISTS ( SELECT 1 FROM ${table} participant WHERE (participant.${column} = "user".id)))`).join(" OR ")})`;
  }
  const column = entry.scopeColumn ?? (entry.ownership === "direct" ? "org_id" : undefined);
  if (column) return `(${column} = NULLIF(current_setting('pinwren.org_id'::text, true), ''::text))`;
  const feedback = `(EXISTS ( SELECT 1 FROM feedback parent WHERE (parent.id = ${entry.table}.feedback_id)))`;
  return entry.table === "feedback_label"
    ? `(${feedback} AND (EXISTS ( SELECT 1 FROM label parent WHERE (parent.id = feedback_label.label_id))))`
    : feedback;
}

export function expectedTenantPolicies(entry: TenantTable, serviceRole: string): TenantPolicy[] {
  if (!isTenantProtected(entry)) return [];
  const expression = tenantPolicyExpression(entry);
  const policies: TenantPolicy[] = [
    { name: "pinwren_tenant", command: "ALL", role: "public", using: expression, check: expression },
  ];
  if (entry.ownership === "identity")
    policies.push({
      name: "pinwren_identity_service",
      command: "ALL",
      role: serviceRole,
      using: "true",
      check: "true",
    });
  if (entry.bootstrapColumns?.length)
    policies.push({
      name: "pinwren_bootstrap_service",
      command: "SELECT",
      role: serviceRole,
      using: "true",
      check: null,
    });
  return policies;
}
