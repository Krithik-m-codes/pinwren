import { defineConfig } from "tsup";

// The library (ESM + CJS + types) keeps its dependencies external. The `pinwren-mcp` binary bundles
// @pinwren/sdk so it runs straight from a checkout too (the workspace links the SDK as TypeScript source).
export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "node20",
    platform: "node",
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    noExternal: ["@pinwren/sdk"],
    sourcemap: true,
    target: "node20",
    platform: "node",
  },
]);
