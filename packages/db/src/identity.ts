import { createDb, getRuntimeDb, type Database } from "./connection";
import { deploymentMode } from "./deployment-mode";
import { parseCloudDatabaseUrl } from "./cloud-database-url";

const identityGlobal = globalThis as unknown as { __pinwrenIdentityDb?: Database };

/** Auth adapter/repositories only. Cloud grants permit identity/system work and fixed bootstrap columns. */
export function identityDatabase() {
  if (deploymentMode() === "selfhost") return getRuntimeDb();
  if (!identityGlobal.__pinwrenIdentityDb) {
    const url = process.env.PINWREN_SERVICE_DATABASE_URL;
    if (!url) throw new Error("Cloud authentication requires PINWREN_SERVICE_DATABASE_URL");
    parseCloudDatabaseUrl(url);
    identityGlobal.__pinwrenIdentityDb = createDb(url);
  }
  return identityGlobal.__pinwrenIdentityDb;
}

/** Close the separate pool when an integration fixture or process is disposed. */
export async function closeIdentityDatabase(): Promise<void> {
  await identityGlobal.__pinwrenIdentityDb?.$client.end();
  delete identityGlobal.__pinwrenIdentityDb;
}
