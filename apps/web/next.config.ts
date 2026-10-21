import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // React Compiler, run by Turbopack's native Rust port rather than the Babel plugin (no
  // babel-plugin-react-compiler dependency). ESLint enforces the compiler's rules (eslint.config.mjs).
  reactCompiler: true,
  experimental: {
    turbopackRustReactCompiler: true,
  },
  // `<Link href>` and `router.push()` are checked against the app's real routes.
  typedRoutes: true,
  // A second dev server in the same checkout (e.g. a parallel test run on another port) needs its own
  // build folder: Next refuses two dev servers on one dist dir. Default unchanged.
  distDir: process.env.PINWREN_NEXT_DIST_DIR || ".next",
  partialPrefetching: true,
  // One self-contained server for the Docker image (blueprint 08).
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@pinwren/api", "@pinwren/core", "@pinwren/db"],
  poweredByHeader: false,
  turbopack: {
    root: fileURLToPath(new URL("../..", import.meta.url)),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  headers() {
    return Promise.resolve([
      {
        source: "/((?!w/|widget\\.js).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ]);
  },
};

export default nextConfig;
