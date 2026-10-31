import inventory from "../tenant-route-inventory.json";

export type InventoryRoute = { boundary: string; databaseLifetime: string; check: string };

/** Every inventory entry of the given boundaries, keyed `METHOD /path`. */
export function inventoryRoutes(...boundaries: string[]): Record<string, InventoryRoute> {
  return Object.fromEntries(
    Object.entries(inventory as Record<string, InventoryRoute>).filter(([, route]) =>
      boundaries.includes(route.boundary),
    ),
  );
}

/** The check an acceptance case must declare for an inventory route; mirrors the inventory's own wording. */
export function expectedCheck(key: string, boundary: string): string {
  const prefix =
    boundary === "tenant" || boundary === "capability"
      ? "foreign tenant"
      : boundary === "system"
        ? "system authorization"
        : boundary === "identity"
          ? "identity authorization"
          : "public authorization";
  return `${prefix}: ${key}`;
}

/** Fails (with the exact route names) when a registry and the inventory disagree in either direction. */
export function coverageGaps(
  boundaries: string[],
  cases: Record<string, { check: string }>,
): { missing: string[]; stale: string[]; mismatched: string[] } {
  const routes = inventoryRoutes(...boundaries);
  const missing = Object.keys(routes).filter((key) => !(key in cases));
  const stale = Object.keys(cases).filter((key) => !(key in routes));
  const mismatched = Object.entries(routes)
    .filter(([key, route]) => cases[key] && cases[key].check !== route.check)
    .map(([key]) => key);
  return { missing, stale, mismatched };
}
