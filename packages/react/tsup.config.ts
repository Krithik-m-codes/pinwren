import { defineConfig } from "tsup";

// ESM + CJS with declarations. The tiny loader from @pinwren/widget is bundled in (it's a dev dependency), so
// this package has no runtime dependency besides React and works from CommonJS too. The entry's
// `"use client"` directive is kept at the top of both outputs (Next.js App Router client boundary).
export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm", "cjs"],
  dts: { resolve: ["@pinwren/widget"] },
  noExternal: ["@pinwren/widget"],
  external: ["react"],
  target: "es2020",
  platform: "browser",
  sourcemap: true,
  clean: true,
});
