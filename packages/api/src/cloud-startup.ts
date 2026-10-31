import { assertCloudDatabaseSecurity } from "@pinwren/db/cloud-security";

let ready: Promise<void> | undefined;

/** Standalone API/worker entry points share the startup gate; a failed deployment can be retried. */
export function ensureCloudDatabaseSecurity(): Promise<void> {
  ready ??= assertCloudDatabaseSecurity().catch((error: unknown) => {
    ready = undefined;
    throw error;
  });
  return ready;
}
