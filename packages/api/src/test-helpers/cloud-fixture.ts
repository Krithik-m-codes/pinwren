import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { runMigrations } from "../../../db/src/migrate";
import { provisionCloudDatabase } from "../../../db/src/provision-cloud";

/** Separate database and roles for each suite. No customer database is truncated or reused. */
export async function createCloudFixture() {
  const source = process.env.PINWREN_ISOLATION_ADMIN_URL;
  if (!source) throw new Error("Isolation administrator URL is required");
  const administrator = postgres(source, { max: 1, onnotice: () => undefined });
  const suffix = randomUUID().replaceAll("-", "");
  const database = `pinwren_isolation_request_${suffix}`;
  const runtimeRole = `runtime_${suffix}`,
    serviceRole = `service_${suffix}`;
  const fixtureUrl = new URL(source);
  fixtureUrl.pathname = `/${database}`;
  const db = postgres(fixtureUrl.toString(), { max: 1, onnotice: () => undefined });
  const runtimeUrl = new URL(fixtureUrl),
    serviceUrl = new URL(fixtureUrl);
  runtimeUrl.username = runtimeRole;
  runtimeUrl.password = randomUUID();
  serviceUrl.username = serviceRole;
  serviceUrl.password = randomUUID();
  const dispose = async () => {
    await db.end();
    await administrator.unsafe(`drop database if exists "${database}"`);
    await administrator.unsafe(`drop role if exists "${runtimeRole}"`);
    await administrator.unsafe(`drop role if exists "${serviceRole}"`);
    await administrator.end();
  };
  try {
    const [current] = await administrator<{ name: string }[]>`select current_database() as name`;
    if (!current?.name.includes("isolation")) throw new Error("Use a dedicated isolation test database");
    await administrator.unsafe(`create database "${database}"`);
    for (const [role, password] of [
      [runtimeRole, runtimeUrl.password],
      [serviceRole, serviceUrl.password],
    ] as const) {
      const [command] = await administrator<
        { statement: string }[]
      >`select format('create role %I login password %L',${role}::text,${password}::text) as statement`;
      if (!command) throw new Error("Cannot prepare fixture role");
      await administrator.unsafe(command.statement);
    }
    await runMigrations(
      fixtureUrl.toString(),
      fileURLToPath(new URL("../../../db/drizzle", import.meta.url)),
    );
    await provisionCloudDatabase(fixtureUrl.toString(), { runtimeRole, serviceRole });
    return { db, runtimeUrl: runtimeUrl.toString(), serviceUrl: serviceUrl.toString(), dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
