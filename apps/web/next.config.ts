import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * Content-Security-Policy for the dashboard (ADR 0021). Not nonce-based: Next.js applies nonces only
 * while rendering a request, and the dashboard's static shells (Cache Components, ADR 0020) are
 * prerendered at build time, so their inline bootstrap/flight scripts could never carry one — the
 * Next.js CSP guide calls nonces incompatible with partial prerendering. Inline scripts therefore stay
 * allowed; everything else is locked down: no third-party script, style, image, font or connection,
 * no plugins, no <base> hijack, forms only to this origin, never framed. The same policy also governs
 * rrweb's about:blank replay iframe, so a recorded page can't load remote resources when replayed.
 */
function contentSecurityPolicy(): string {
  const dev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    // 'unsafe-eval' only in development: React rebuilds server error stacks with eval there.
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const nextConfig: NextConfig = {
  cacheComponents: true,
  // React Compiler, run by Turbopack's native Rust port rather than the Babel plugin (no
  // babel-plugin-react-compiler dependency). ESLint enforces the compiler's rules (eslint.config.mjs).
  reactCompiler: true,
  experimental: {
    turbopackRustReactCompiler: true,
    // The proxy (src/proxy.ts) buffers request bodies, by default only the first 10 MB — a 10 MB session
    // replay is ~13.4 MB as base64 JSON, plus screenshot and attachments. The API enforces its own limits
    // per field (replay ≤ 10 MB decoded, attachments ≤ 5 MB each); this only has to let them through.
    proxyClientMaxBodySize: "48mb",
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
    // The widget is loaded cross-origin by customers' sites (wave-4 contract §8): widget.js keeps a stable
    // name and a short cache; its chunks are content-hashed and cached for a year. Compression (brotli /
    // gzip) is the reverse proxy's job — see docs/self-hosting/reverse-proxy.md.
    const script = [
      { key: "Content-Type", value: "text/javascript; charset=utf-8" },
      { key: "Access-Control-Allow-Origin", value: "*" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ];
    return Promise.resolve([
      {
        source: "/widget.js",
        headers: [...script, { key: "Cache-Control", value: "public, max-age=300" }],
      },
      {
        // ^/widget-[\w-]+\.[0-9a-f]{10}\.js$ — widget-panel.<hash>.js, widget-i18n-pt-BR.<hash>.js, …
        source: "/:chunk(widget-[\\w-]+\\.[0-9a-f]{10}\\.js)",
        headers: [...script, { key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        // Pages only: API responses set their own policy where they serve content (sandboxed assets).
        source: "/((?!w/|widget[.-]|api/|mcp).*)",
        headers: [{ key: "Content-Security-Policy", value: contentSecurityPolicy() }],
      },
      {
        source: "/((?!w/|widget[.-]).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
        ],
      },
    ]);
  },
};

export default nextConfig;
