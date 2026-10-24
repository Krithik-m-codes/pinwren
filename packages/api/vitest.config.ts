import { defineConfig } from "vitest/config";

// Route tests import the whole Hono app (Better Auth, Drizzle, every router). The first test in each
// file pays that cold import, which can pass vitest's 5 s default on a busy machine.
export default defineConfig({
  test: {
    testTimeout: 30_000,
  },
});
