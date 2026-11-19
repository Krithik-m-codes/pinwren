import postgres from "postgres";
import { QUEUES } from "./definitions";

type Catalog = postgres.Sql | postgres.TransactionSql;
export const CRON_QUEUE = "__pgboss__send-it";

/** Check direct, inherited and SET ROLE-accessible member privileges, including column ACLs. */
export async function validateQueueCatalog(db: Catalog, kind: "runtime" | "service") {
  const [functions] =
    await db`select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='pgboss' and pg_has_role(current_user,p.proowner,'MEMBER')) owns`;
  if (functions?.owns) throw new Error(`Cloud ${kind} owns queue functions`);
  const rows = await db<
    {
      name: string;
      owns: boolean;
      content: boolean;
      truncate: boolean;
      trigger: boolean;
      version_write: boolean;
    }[]
  >`select c.relname name,
    pg_has_role(current_user,c.relowner,'MEMBER') owns,
    (has_any_column_privilege(r.oid,c.oid,'SELECT') or has_any_column_privilege(r.oid,c.oid,'INSERT')
      or has_any_column_privilege(r.oid,c.oid,'UPDATE') or has_table_privilege(r.oid,c.oid,'DELETE')) content,
    has_table_privilege(r.oid,c.oid,'TRUNCATE') truncate,
    has_table_privilege(r.oid,c.oid,'TRIGGER') trigger,
    case when c.relname='version' then
      (has_column_privilege(r.oid,c.oid,'version','UPDATE') or has_any_column_privilege(r.oid,c.oid,'INSERT')
       or has_table_privilege(r.oid,c.oid,'DELETE')) else false end version_write
    from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join pg_roles r
    where n.nspname='pgboss' and c.relkind in ('r','p')
      and pg_has_role(current_user,r.oid,'MEMBER')`;
  if (
    rows.some(
      (r) =>
        r.owns ||
        r.truncate ||
        r.trigger ||
        (kind === "runtime" && r.content) ||
        (kind === "service" && ((r.name === "bam" && r.content) || r.version_write)),
    )
  ) {
    throw new Error(`Cloud ${kind} has unsafe effective queue privileges`);
  }
}

/** Owner migrations interpolate queue metadata. Refuse unsafe topology before any privileged startup. */
export async function protectQueueTopology(db: postgres.Sql) {
  const [exists] =
    await db`select exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='pgboss' and c.relname='queue') present`;
  if (!exists?.present) return;
  const allowed = [...Object.values(QUEUES), CRON_QUEUE];
  // These names come only from versioned source, never queue rows or operator input.
  const literals = allowed.map((name) => `'${name.replaceAll("'", "''")}'`).join(",");
  await db.unsafe(`create or replace function pgboss.pinwren_queue_guard() returns trigger language plpgsql as $$
    begin
      if new.name <> all(array[${literals}]::text[]) or new.table_name is distinct from 'job_common'
        or new.partition is distinct from false or new.policy is distinct from 'standard' then
        raise exception 'Unsafe Cloud queue topology';
      end if;
      return new;
    end $$`);
  await db`drop trigger if exists pinwren_queue_topology on pgboss.queue`;
  await db`create trigger pinwren_queue_topology before insert or update on pgboss.queue for each row execute function pgboss.pinwren_queue_guard()`;
  // Check after installing the guard, so a concurrent metadata update cannot race the preflight read.
  const rows = await db<
    { name: string; table_name: string; partition: boolean; policy: string }[]
  >`select name,table_name,partition,policy from pgboss.queue`;
  if (
    rows.some(
      (r) =>
        !allowed.includes(r.name) || r.table_name !== "job_common" || r.partition || r.policy !== "standard",
    )
  ) {
    throw new Error("Cloud queue topology is unsupported or unsafe; inspect it offline before migrating");
  }
}

export async function assertQueueSecurity(runtimeUrl: string, serviceUrl: string) {
  for (const [url, kind] of [
    [runtimeUrl, "runtime"],
    [serviceUrl, "service"],
  ] as const) {
    const db = postgres(url, { max: 1 });
    try {
      await validateQueueCatalog(db, kind);
    } finally {
      await db.end();
    }
  }
}
