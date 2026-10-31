import type postgres from "postgres";
import { tenantInventory } from "../../../db/src/tenant-inventory";

const digest = (from: string, where: string) =>
  `select coalesce(md5(string_agg(t::text,'|' order by t::text)),'') h from ${from} t where ${where}`;

/**
 * A hash of every row that belongs to one workspace: all direct-owned tables, parent-owned rows reached
 * through their feedback, the workspace/member/invitation rows, and its members' accounts and preferences.
 * Read with the fixture's administrator connection, so row security never hides a change.
 */
export async function snapshotOrganization(db: postgres.Sql, org: string): Promise<string> {
  const statements: string[] = [];
  for (const entry of tenantInventory) {
    if (entry.ownership === "direct") statements.push(digest(`"${entry.table}"`, "org_id=$1"));
    else if (entry.ownership === "parent")
      statements.push(
        digest(`"${entry.table}"`, "t.feedback_id in (select id from feedback where org_id=$1)"),
      );
  }
  statements.push(
    digest("organization", "id=$1"),
    digest("member", "organization_id=$1"),
    digest("invitation", "organization_id=$1"),
    digest(`"user"`, "id in (select user_id from member where organization_id=$1)"),
    digest("user_preference", "user_id in (select user_id from member where organization_id=$1)"),
  );
  const parts: string[] = [];
  for (const statement of statements) {
    const [row] = await db.unsafe<{ h: string }[]>(statement, [org]);
    parts.push(row?.h ?? "");
  }
  return parts.join(":");
}
