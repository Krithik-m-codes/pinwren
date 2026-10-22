import { fileURLToPath } from "node:url";
import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // React Compiler via Turbopack's native Rust port, as in the dashboard (ADR 0017).
  reactCompiler: true,
  experimental: {
    turbopackRustReactCompiler: true,
  },
  typedRoutes: true,
  // A second server in the same checkout (e.g. a test run) needs its own build folder.
  distDir: process.env.PINWREN_WWW_DIST_DIR || ".next",
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  // The demo API validates requests with the real widget contract schemas.
  transpilePackages: ["@pinwren/core"],
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
  redirects() {
    return Promise.resolve([
      { source: "/self-hosting", destination: "/docs/self-hosting", permanent: false },
      { source: "/quickstart", destination: "/docs/quickstart", permanent: false },
    ]);
  },
  headers() {
    return Promise.resolve([
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        // The demo widget bundle and its chunks (static files): short cache, every deploy replaces them.
        source: "/demo-api/:file(widget[^/]*[.]js)",
        headers: [{ key: "Cache-Control", value: "public, max-age=300" }],
      },
    ]);
  },
};

const withMDX = createMDX();

export default withMDX(nextConfig);
