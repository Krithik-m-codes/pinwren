export type TenantTable = {
  table: string;
  ownership: "direct" | "parent" | "identity" | "system";
  parents: readonly string[];
  scopeColumn?: string;
  profileScope?: boolean;
  runtimeColumns?: readonly string[];
  bootstrapColumns?: readonly string[];
  systemNull?: boolean;
};

export const PROFILE_PARTICIPANTS = [
  ["member", "user_id"],
  ["feedback", "reporter_id"],
  ["comment", "author_id"],
  ["activity", "actor_id"],
  ["feedback_watcher", "user_id"],
] as const;

export function isTenantProtected(entry: TenantTable): boolean {
  return (
    entry.ownership === "direct" ||
    entry.ownership === "parent" ||
    entry.scopeColumn !== undefined ||
    entry.profileScope === true
  );
}

export const tenantInventory: readonly TenantTable[] = [
  {
    table: "project",
    ownership: "direct",
    parents: [],
    bootstrapColumns: ["id", "org_id", "public_key", "allowed_origins", "archived_at"],
  },
  { table: "page", ownership: "direct", parents: ["project"] },
  { table: "project_release", ownership: "direct", parents: ["project"] },
  { table: "review_round", ownership: "direct", parents: ["project"] },
  {
    table: "feedback",
    ownership: "direct",
    parents: ["project", "page", "review_round", "feedback", "review_link", "project_release"],
  },
  { table: "diagnostics", ownership: "parent", parents: ["feedback"] },
  { table: "feedback_ai", ownership: "direct", parents: ["feedback"] },
  { table: "feedback_translation", ownership: "parent", parents: ["feedback"] },
  { table: "feedback_asset", ownership: "direct", parents: ["feedback"], bootstrapColumns: ["id", "org_id"] },
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
  { table: "email_delivery", ownership: "direct", parents: [], systemNull: true },
  { table: "webhook_endpoint", ownership: "direct", parents: ["project"] },
  {
    table: "webhook_delivery",
    ownership: "direct",
    parents: ["webhook_endpoint"],
    bootstrapColumns: ["id", "org_id"],
  },
  {
    table: "api_token",
    ownership: "direct",
    parents: [],
    bootstrapColumns: ["id", "org_id", "user_id", "prefix", "hash", "scopes", "expires_at", "last_used_at"],
  },
  { table: "org_setting", ownership: "direct", parents: [] },
  { table: "brand_asset", ownership: "direct", parents: [], bootstrapColumns: ["id", "org_id"] },
  { table: "email_template", ownership: "direct", parents: [] },
  {
    table: "issue_integration",
    ownership: "direct",
    parents: ["project"],
    bootstrapColumns: [
      "id",
      "org_id",
      "project_id",
      "provider",
      "repo",
      "webhook_secret",
      "active",
      "webhook_pending",
    ],
  },
  {
    table: "issue_link",
    ownership: "direct",
    parents: ["feedback", "issue_integration"],
    bootstrapColumns: ["id", "org_id"],
  },
  { table: "saved_view", ownership: "direct", parents: [] },
  { table: "email_suppression", ownership: "direct", parents: [] },
  { table: "license", ownership: "system", parents: [] },
  { table: "billing_subscription", ownership: "direct", parents: [] },
  { table: "billing_event", ownership: "direct", parents: [] },
  { table: "review_link", ownership: "direct", parents: ["project"] },
  { table: "label_suggestion", ownership: "direct", parents: ["feedback", "label"] },
  { table: "automation_rule", ownership: "direct", parents: ["project"] },
  { table: "custom_field", ownership: "direct", parents: ["project"] },
  { table: "automation_run", ownership: "direct", parents: ["automation_rule", "project", "feedback"] },
  {
    table: "slack_workspace",
    ownership: "direct",
    parents: [],
    bootstrapColumns: ["id", "org_id", "team_id", "signing_secret", "active"],
  },
  { table: "slack_route", ownership: "direct", parents: ["slack_workspace", "project"] },
  { table: "slack_user_link", ownership: "direct", parents: ["slack_workspace"] },
  { table: "slack_message", ownership: "direct", parents: ["slack_workspace", "feedback"] },
  { table: "share_link", ownership: "direct", parents: ["project", "feedback", "review_round"] },
  { table: "round_signoff", ownership: "direct", parents: ["review_round", "share_link"] },
  { table: "dashboard", ownership: "direct", parents: [] },
  { table: "workspace_preference", ownership: "direct", parents: [] },
  {
    table: "user",
    ownership: "identity",
    parents: PROFILE_PARTICIPANTS.map(([table]) => table),
    profileScope: true,
    runtimeColumns: ["id", "name", "email", "image"],
  },
  { table: "session", ownership: "identity", parents: [] },
  { table: "account", ownership: "identity", parents: [] },
  { table: "verification", ownership: "identity", parents: [] },
  { table: "organization", ownership: "identity", parents: [], scopeColumn: "id" },
  { table: "member", ownership: "identity", parents: [], scopeColumn: "organization_id" },
  { table: "invitation", ownership: "identity", parents: [], scopeColumn: "organization_id" },
  { table: "auth_rate_limit", ownership: "system", parents: [] },
  { table: "two_factor", ownership: "identity", parents: [] },
  { table: "passkey", ownership: "identity", parents: [] },
];
