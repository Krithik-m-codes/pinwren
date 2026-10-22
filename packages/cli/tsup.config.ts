import { defineConfig } from "tsup";

// One self-contained file: @pinwren/sdk is bundled in, so `npx @pinwren/cli` installs nothing else.
export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  sourcemap: true,
  clean: true,
  noExternal: ["@pinwren/sdk"],
});
