import { getTableName, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "../../db/src/schema";
import { tenantInventory, isTenantProtected } from "../../db/src/tenant-inventory";
import routeInventory from "./tenant-route-inventory.json";

const tables = Object.values(schema).filter((value) => is(value, PgTable));

describe("Cloud database boundary inventory", () => {
  it("classifies every exported table exactly once", () => {
    expect(tenantInventory.map((entry) => entry.table).sort()).toEqual(tables.map(getTableName).sort());
    expect(new Set(tenantInventory.map((entry) => entry.table)).size).toBe(tenantInventory.length);
  });

  it("declares real protected parents and direct ownership columns", () => {
    for (const entry of tenantInventory) {
      const table = tables.find((value) => getTableName(value) === entry.table);
      if (!table) throw new Error(`Unknown inventory table: ${entry.table}`);
      if (entry.ownership === "direct") {
        expect(getTableConfig(table).columns.some((column) => column.name === "org_id")).toBe(true);
      }
      if (entry.ownership === "parent") expect(entry.parents.length).toBeGreaterThan(0);
      const columns = getTableConfig(table).columns.map((column) => column.name);
      if (entry.scopeColumn) expect(columns).toContain(entry.scopeColumn);
      for (const column of [...(entry.runtimeColumns ?? []), ...(entry.bootstrapColumns ?? [])])
        expect(columns).toContain(column);
      if (entry.runtimeColumns) expect(entry.profileScope).toBe(true);
      for (const parent of entry.parents) {
        const parentEntry = tenantInventory.find((value) => value.table === parent);
        expect(parentEntry && isTenantProtected(parentEntry)).toBe(true);
      }
      const tenantParents = getTableConfig(table)
        .foreignKeys.map((key) => getTableName(key.reference().foreignTable))
        .filter((name) =>
          /direct|parent/.test(tenantInventory.find((value) => value.table === name)?.ownership ?? ""),
        );
      expect(entry.parents).toEqual(expect.arrayContaining(tenantParents));
    }
  });

  it("inventories every mounted endpoint, including the ALL-method MCP handler", async () => {
    process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:1/none";
    process.env.PINWREN_URL ??= "http://localhost:3100";
    process.env.PINWREN_SECRET ??= "x".repeat(48);
    const { app } = await import("./index");
    const routes = [
      ...new Set(
        app.routes
          .filter((route) => route.method !== "ALL" || route.path === "/mcp")
          .map((route) => `${route.method} ${route.path}`),
      ),
    ].sort();
    expect(Object.keys(routeInventory).sort()).toEqual(routes);
    for (const entry of Object.values(routeInventory)) {
      expect(entry.boundary).toMatch(/^(tenant|identity|system|capability|public)$/);
      expect(entry.check).not.toBe("");
    }
    expect(Object.keys(routeInventory)).not.toContain("GET /api/unreviewed-resource");
  });
});
