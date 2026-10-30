import { createHash } from "node:crypto";
import { getTableName, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { deploymentMode } from "./deployment-mode";
import { parseCloudDatabaseUrl, sameDatabaseEndpoint } from "./cloud-database-url";
import * as schema from "./schema";
import { tenantInventory, isTenantProtected } from "./tenant-inventory";
import { expectedTenantPolicies } from "./tenant-policies";

type CatalogConnection = postgres.Sql | postgres.TransactionSql;
const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

/** Catalog-only access: usable before tenant context exists, without granting tenant content access. */
export async function validateCloudCatalog(
  db: CatalogConnection,
  kind: "runtime" | "service",
  serviceRole: string,
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
      and (p.rolsuper or p.rolbypassrls or p.rolcreaterole or p.rolcreatedb or p.rolreplication or p.rolname like 'pg_%'
        or (${kind}::text='runtime' and p.rolname=${serviceRole}))) as membership,
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
      deletes: boolean;
    }[]
  >`
    select c.relname as name,c.relrowsecurity as enabled,c.relforcerowsecurity as forced,
      has_table_privilege(current_user,c.oid,'TRUNCATE') as truncates,
      (has_any_column_privilege(current_user,c.oid,'SELECT') or has_any_column_privilege(current_user,c.oid,'INSERT')
       or has_any_column_privilege(current_user,c.oid,'UPDATE') or has_table_privilege(current_user,c.oid,'DELETE')) as content,
      (has_table_privilege(current_user,c.oid,'SELECT') and has_table_privilege(current_user,c.oid,'INSERT')
       and has_table_privilege(current_user,c.oid,'UPDATE') and has_table_privilege(current_user,c.oid,'DELETE')) as complete,
      has_table_privilege(current_user,c.oid,'DELETE') as deletes
    from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p')`;
  const expectedNames = new Set(tenantInventory.map((entry) => entry.table));
  if (tables.length !== expectedNames.size || tables.some((table) => !expectedNames.has(table.name))) {
    throw new Error("Cloud table inventory is incomplete or contains unclassified tables");
  }
  for (const table of tables) {
    if (table.truncates) throw new Error(`Cloud ${kind} has unsafe TRUNCATE privileges on ${table.name}`);
    const entry = tenantInventory.find((value) => value.table === table.name);
    if (kind === "runtime" && table.content && (!entry || !isTenantProtected(entry))) {
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
  const columns = await db<
    { table_name: string; column_name: string; reads: boolean; inserts: boolean; updates: boolean }[]
  >`
    select c.relname as table_name,a.attname as column_name,
      has_column_privilege(current_user,c.oid,a.attnum,'SELECT') as reads,
      has_column_privilege(current_user,c.oid,a.attnum,'INSERT') as inserts,
      has_column_privilege(current_user,c.oid,a.attnum,'UPDATE') as updates
    from pg_class c join pg_attribute a on a.attrelid=c.oid
    where c.relnamespace='public'::regnamespace and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped`;
  for (const entry of tenantInventory.filter(isTenantProtected)) {
    const table = tables.find((value) => value.name === entry.table);
    if (!table?.enabled || !table.forced) throw new Error(`Cloud FORCE RLS is missing for ${entry.table}`);
    if (kind === "runtime" && !entry.runtimeColumns && !table.complete)
      throw new Error(`Cloud runtime CRUD grant privileges are missing for ${entry.table}`);
    if (table.truncates) throw new Error(`Cloud ${kind} has unsafe TRUNCATE privileges on ${entry.table}`);
    if (kind === "service" && entry.ownership !== "identity" && !entry.bootstrapColumns && table.content)
      throw new Error(`Cloud service role can access tenant table ${entry.table} directly`);
    const projection =
      kind === "runtime"
        ? entry.runtimeColumns
        : entry.ownership === "identity"
          ? undefined
          : entry.bootstrapColumns;
    if (projection) {
      const actual = columns.filter((value) => value.table_name === entry.table);
      const readable = actual
        .filter((value) => value.reads)
        .map((value) => value.column_name)
        .sort();
      if (
        table.deletes ||
        actual.some((value) => value.inserts || value.updates) ||
        JSON.stringify(readable) !== JSON.stringify([...projection].sort())
      ) {
        throw new Error(`Cloud ${kind} column projection privileges are invalid for ${entry.table}`);
      }
    }
    const matches = policies.filter((value) => value.tablename === entry.table);
    const expected = expectedTenantPolicies(entry, serviceRole);
    if (
      matches.length !== expected.length ||
      expected.some((definition) => {
        const policy = matches.find((value) => value.policyname === definition.name);
        return (
          policy?.permissive !== "PERMISSIVE" ||
          policy.cmd !== definition.command ||
          policy.roles.length !== 1 ||
          policy.roles[0] !== definition.role ||
          normalize(policy.qual ?? "") !== normalize(definition.using) ||
          normalize(policy.with_check ?? "") !== normalize(definition.check ?? "")
        );
      })
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
      await validateCloudCatalog(db, kind, decodeURIComponent(service.username));
    } finally {
      await db.end();
    }
  }
}
