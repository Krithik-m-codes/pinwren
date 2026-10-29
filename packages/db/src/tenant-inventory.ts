export type TenantTable = {
  table: string;
  ownership: "direct" | "parent" | "identity" | "system";
  parents: readonly string[];
};

export const tenantInventory: readonly TenantTable[] = [
  { table: "project", ownership: "direct", parents: [] },
  { table: "page", ownership: "direct", parents: ["project"] },
  { table: "review_round", ownership: "direct", parents: ["project"] },
  {
    table: "feedback",
    ownership: "direct",
    parents: ["project", "page", "review_round", "feedback", "review_link"],
  },
  { table: "diagnostics", ownership: "parent", parents: ["feedback"] },
  { table: "feedback_ai", ownership: "direct", parents: ["feedback"] },
  { table: "feedback_translation", ownership: "parent", parents: ["feedback"] },
  { table: "feedback_asset", ownership: "direct", parents: ["feedback"] },
  { table: "comment", ownership: "direct", parents: ["feedback"] },
  { table: "activity", ownership: "direct", parents: ["feedback"] },
  { table: "rate_limit", ownership: "system", parents: [] },
  { table: "setting", ownership: "system", parents: [] },
  { table: "notification_preference", ownership: "direct", parents: ["project"] },
  { table: "notification", ownership: "direct", parents: ["feedback"] },
  { table: "user_preference", ownership: "identity", parents: [] },
  { table: "feedback_watcher", ownership: "parent", parents: ["feedback"] },
  { table: "label", ownership: "direct", parents: ["project"] },
  { table: "feedback_label", ownership: "parent", parents: ["feedback", "label"] },
  // Nullable org_id is protected as direct ownership; NULL rows are system-only.
  { table: "email_delivery", ownership: "direct", parents: [] },
  { table: "webhook_endpoint", ownership: "direct", parents: ["project"] },
  { table: "webhook_delivery", ownership: "direct", parents: ["webhook_endpoint"] },
  { table: "api_token", ownership: "direct", parents: [] },
  { table: "org_setting", ownership: "direct", parents: [] },
  { table: "brand_asset", ownership: "direct", parents: [] },
  { table: "email_template", ownership: "direct", parents: [] },
  { table: "issue_integration", ownership: "direct", parents: ["project"] },
  { table: "issue_link", ownership: "direct", parents: ["feedback", "issue_integration"] },
  { table: "saved_view", ownership: "direct", parents: [] },
  { table: "email_suppression", ownership: "direct", parents: [] },
  { table: "license", ownership: "system", parents: [] },
  { table: "review_link", ownership: "direct", parents: ["project"] },
  { table: "user", ownership: "identity", parents: [] },
  { table: "session", ownership: "identity", parents: [] },
  { table: "account", ownership: "identity", parents: [] },
  { table: "verification", ownership: "identity", parents: [] },
  { table: "organization", ownership: "identity", parents: [] },
  { table: "member", ownership: "identity", parents: [] },
  { table: "invitation", ownership: "identity", parents: [] },
  { table: "auth_rate_limit", ownership: "system", parents: [] },
  { table: "two_factor", ownership: "identity", parents: [] },
  { table: "passkey", ownership: "identity", parents: [] },
];
