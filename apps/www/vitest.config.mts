import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for server-side helpers (the in-memory demo backend). Playwright covers the pages (e2e/).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside a React Server Components bundle; its empty entry is what Next uses there.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
