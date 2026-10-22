import { defineConfig } from "tsup";

// ESM + CommonJS with type declarations. The SDK has no runtime dependencies: its types are generated
// from the server's schemas (scripts/generate-types.ts), so nothing from the monorepo is bundled.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  platform: "neutral",
});
