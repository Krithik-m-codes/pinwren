import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for the store (slices, RTK Query endpoints, the real-time middleware) and pure helpers.
// Playwright covers the screens (e2e/).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
