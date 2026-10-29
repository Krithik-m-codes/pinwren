import { createHash } from "node:crypto";
import { getTableName, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { deploymentMode } from "./deployment-mode";
import { parseCloudDatabaseUrl, sameDatabaseEndpoint } from "./cloud-database-url";
import * as schema from "./schema";
import { tenantInventory } from "./tenant-inventory";

type CatalogConnection = postgres.Sql | postgres.TransactionSql;
const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

function expectedPolicy(table: string, direct: boolean): string {
  if (direct) return "(org_id = NULLIF(current_setting('pinwren.org_id'::text, true), ''::text))";
  const feedback = `(EXISTS ( SELECT 1 FROM feedback parent WHERE (parent.id = ${table}.feedback_id)))`;
  return table === "feedback_label"
    ? `(${feedback} AND (EXISTS ( SELECT 1 FROM label parent WHERE (parent.id = feedback_label.label_id))))`
    : feedback;
}

/** Catalog-only access: usable before tenant context exists, without granting tenant content access. */
export async function validateCloudCatalog(
  db: CatalogConnection,
  kind: "runtime" | "service",
): Promise<void> {
  const [role] = await db<
    {
      name: string;
      unsafe: boolean;
      membership: boolean;
      owns: boolean;
      creates: boolean;
      disables_triggers: boolean;
      callable_definer: boolean;
    }[]
  >`select current_user as name,
    (r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolcreatedb or r.rolreplication) as unsafe,
    exists(select 1 from pg_roles p where p.oid <> r.oid and pg_has_role(current_user,p.oid,'MEMBER')
      and (p.rolsuper or p.rolbypassrls or p.rolcreaterole or p.rolcreatedb or p.rolreplication or p.rolname like 'pg_%')) as membership,
    (exists(select 1 from pg_class c where c.relnamespace='public'::regnamespace and pg_has_role(current_user,c.relowner,'MEMBER'))
      or exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and pg_has_role(current_user,p.proowner,'MEMBER'))) as owns,
    (has_database_privilege(current_user,current_database(),'CREATE') or exists (
      select 1 from pg_namespace n where n.nspname not like 'pg_temp_%' and n.nspname not like 'pg_toast_temp_%'
      and has_schema_privilege(current_user,n.oid,'CREATE'))) as creates,
    has_parameter_privilege(current_user,'session_replication_role','SET') as disables_triggers,
    exists(select 1 from pg_proc p where p.pronamespace <> 'pg_catalog'::regnamespace and p.prosecdef
      and has_function_privilege(current_user,p.oid,'EXECUTE')) as callable_definer
    from pg_roles r where r.rolname=current_user`;
  if (
    !role ||
    role.unsafe ||
    role.membership ||
    role.owns ||
    role.creates ||
    role.disables_triggers ||
    role.callable_definer
  ) {
    throw new Error(`Cloud ${kind} role has unsafe privileges, ownership or membership`);
  }

  const tables = await db<
    {
      name: string;
      enabled: boolean;
      forced: boolean;
      truncates: boolean;
      content: boolean;
      complete: boolean;
    }[]
  >`
    select c.relname as name,c.relrowsecurity as enabled,c.relforcerowsecurity as forced,
      has_table_privilege(current_user,c.oid,'TRUNCATE') as truncates,
      (has_any_column_privilege(current_user,c.oid,'SELECT') or has_any_column_privilege(current_user,c.oid,'INSERT')
       or has_any_column_privilege(current_user,c.oid,'UPDATE') or has_table_privilege(current_user,c.oid,'DELETE')) as content,
      (has_table_privilege(current_user,c.oid,'SELECT') and has_table_privilege(current_user,c.oid,'INSERT')
       and has_table_privilege(current_user,c.oid,'UPDATE') and has_table_privilege(current_user,c.oid,'DELETE')) as complete
    from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p')`;
  const expectedNames = new Set(tenantInventory.map((entry) => entry.table));
  if (tables.length !== expectedNames.size || tables.some((table) => !expectedNames.has(table.name))) {
    throw new Error("Cloud table inventory is incomplete or contains unclassified tables");
  }
  for (const table of tables) {
    if (table.truncates) throw new Error(`Cloud ${kind} has unsafe TRUNCATE privileges on ${table.name}`);
    const entry = tenantInventory.find((value) => value.table === table.name);
    if (
      kind === "runtime" &&
      table.content &&
      entry?.ownership !== "direct" &&
      entry?.ownership !== "parent"
    ) {
      throw new Error(`Cloud runtime has unrestricted identity/system privileges on ${table.name}`);
    }
  }
  const policies = await db<
    {
      tablename: string;
      policyname: string;
      permissive: string;
      roles: string[];
      cmd: string;
      qual: string | null;
      with_check: string | null;
    }[]
  >`
    select tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='public'`;
  for (const entry of tenantInventory.filter(
    (value) => value.ownership === "direct" || value.ownership === "parent",
  )) {
    const table = tables.find((value) => value.name === entry.table);
    if (!table?.enabled || !table.forced) throw new Error(`Cloud FORCE RLS is missing for ${entry.table}`);
    if (kind === "runtime" && !table.complete)
      throw new Error(`Cloud runtime CRUD grant privileges are missing for ${entry.table}`);
    if (table.truncates) throw new Error(`Cloud ${kind} has unsafe TRUNCATE privileges on ${entry.table}`);
    if (kind === "service" && table.content)
      throw new Error(`Cloud service role can access tenant table ${entry.table} directly`);
    const matches = policies.filter((value) => value.tablename === entry.table);
    const policy = matches[0];
    const expected = normalize(expectedPolicy(entry.table, entry.ownership === "direct"));
    if (
      matches.length !== 1 ||
      policy?.policyname !== "pinwren_tenant" ||
      policy.permissive !== "PERMISSIVE" ||
      policy.cmd !== "ALL" ||
      policy.roles.length !== 1 ||
      policy.roles[0] !== "public" ||
      normalize(policy.qual ?? "") !== expected ||
      normalize(policy.with_check ?? "") !== expected
    ) {
      throw new Error(`Cloud policy definition is invalid for ${entry.table}`);
    }
  }

  const constraints = await db<
    { name: string; valid: boolean; definition: string }[]
  >`select conname as name,convalidated as valid,
    pg_get_constraintdef(oid,true) as definition from pg_constraint where connamespace='public'::regnamespace and contype='f'`;
  for (const table of Object.values(schema).filter((value) => is(value, PgTable))) {
    for (const key of getTableConfig(table).foreignKeys.filter((value) =>
      value.getName().endsWith("_tenant_fk"),
    )) {
      const reference = key.reference();
      const expected = `FOREIGN KEY (${reference.columns.map((column) => column.name).join(", ")}) REFERENCES ${getTableName(reference.foreignTable)}(${reference.foreignColumns.map((column) => column.name).join(", ")})`;
      const actual = constraints.find((value) => value.name === key.getName());
      if (!actual?.valid || normalize(actual.definition) !== expected)
        throw new Error(`Cloud tenant integrity constraint is missing or changed: ${key.getName()}`);
    }
  }
  const triggers = await db<
    { name: string; table_name: string; enabled: string; function_name: string; definition: string }[]
  >`select t.tgname as name,c.relname as table_name,
    t.tgenabled as enabled,p.proname as function_name,pg_get_triggerdef(t.oid,true) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_proc p on p.oid=t.tgfoid where c.relnamespace='public'::regnamespace and not t.tgisinternal`;
  for (const [name, table, event] of [
    ["feedback_label_tenant_check", "feedback_label", "BEFORE INSERT OR UPDATE"],
    ["feedback_label_feedback_tenant_check", "feedback", "AFTER UPDATE OF org_id"],
    ["feedback_label_label_tenant_check", "label", "AFTER UPDATE OF org_id"],
  ] as const) {
    const trigger = triggers.find((value) => value.name === name && value.table_name === table);
    const expected = `CREATE TRIGGER ${name} ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION pinwren_check_feedback_label_tenant()`;
    if (
      !trigger ||
      !["O", "A"].includes(trigger.enabled) ||
      trigger.function_name !== "pinwren_check_feedback_label_tenant" ||
      normalize(trigger.definition) !== expected
    ) {
      throw new Error(`Cloud tenant integrity trigger is missing or disabled: ${name}`);
    }
  }
  const [fn] = await db<
    { body: string; definer: boolean; config: string[] | null; public_execute: boolean }[]
  >`select p.prosrc as body,p.prosecdef as definer,p.proconfig as config,
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute
    from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='pinwren_check_feedback_label_tenant' and p.pronargs=0`;
  // Hash of the whitespace-normalized function body installed by migration 0009.
  if (
    !fn ||
    fn.definer ||
    fn.public_execute ||
    fn.config?.join(",") !== "search_path=pg_catalog" ||
    createHash("sha256").update(normalize(fn.body)).digest("hex") !==
      "6111949d6e5ddf17b225f892036bb4f719073fe72e68b2c6ad4340c211700d91"
  ) {
    throw new Error("Cloud tenant integrity function definition is invalid");
  }
}

/** Fail startup before requests or workers can access an incompletely protected Cloud database. */
export async function assertCloudDatabaseSecurity(): Promise<void> {
  if (deploymentMode() !== "cloud") return;
  if (process.env.PINWREN_MIGRATION_DATABASE_URL)
    throw new Error("Remove migration credentials from the Cloud runtime environment");
  const runtimeUrl = process.env.DATABASE_URL,
    serviceUrl = process.env.PINWREN_SERVICE_DATABASE_URL;
  if (!runtimeUrl || !serviceUrl) throw new Error("Cloud requires runtime and service database credentials");
  const runtime = parseCloudDatabaseUrl(runtimeUrl),
    service = parseCloudDatabaseUrl(serviceUrl);
  if (decodeURIComponent(runtime.username) === decodeURIComponent(service.username))
    throw new Error("Cloud runtime and service roles must be distinct");
  if (!sameDatabaseEndpoint(runtime, service)) {
    throw new Error("Cloud runtime and service connections must use the same database endpoint");
  }
  for (const [url, kind] of [
    [runtimeUrl, "runtime"],
    [serviceUrl, "service"],
  ] as const) {
    const db = postgres(url, { max: 1 });
    try {
      await validateCloudCatalog(db, kind);
    } finally {
      await db.end();
    }
  }
}
