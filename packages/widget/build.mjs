import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { watch as fsWatch } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { build } from "esbuild";

// Script-tag bundles (blueprint 05 §1–§2, wave-4 §7):
//
//   widget.js                       the core, un-hashed (served with a short cache); it carries the manifest
//   widget-<chunk>.<hash>.js        lazy chunks: panel, report, editor, capture, replay, flows
//   widget-i18n-<code>.<hash>.js    one per non-English locale, loaded only for visitors in that language
//
// Chunk names are content-hashed, so a server or CDN can cache them forever (`immutable`). They are written
// to dist/ and to the web app's public/ (which hosts them); stale hashed files from earlier builds are
// removed from both. dist/ also gets manifest.json (names + sizes), the npm ESM entry (index.js) and its
// type declarations (index.d.ts).
const pkgDir = fileURLToPath(new URL(".", import.meta.url));
const dist = join(pkgDir, "dist");
const outdirs = [dist, join(pkgDir, "..", "..", "apps", "web", "public")];
const LOCALES = ["es", "fr", "de", "pt-BR", "it", "ja", "hi", "nl", "zh", "ru"];
const CHUNKS = ["panel", "report", "editor", "capture", "replay", "flows"];
const src = join(pkgDir, "src");
const pkg = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf8"));

// Gzip budgets in KB (blueprint 05 §2, wave-4 §7). Over budget is reported, not fatal — capture is SnapDOM's
// own pre-minified bundle; the e2e suite enforces the hard limits.
const BUDGET = { widget: 35, panel: 15, report: 15, editor: 30, capture: 75, replay: 60, flows: 10 };

// Chunks share the core's modules through `window.__pinwrenLib` (src/lib.ts) instead of bundling copies:
// an import of one of these from a chunk becomes a read of the object the core put there.
const SHARED = /^\.\/(chunks|config|diagnostics|dom|env|form|i18n|idb|picker|queue|store|ui)$/;
const lib = await build({
  entryPoints: ["src/lib.ts"],
  absWorkingDir: pkgDir,
  bundle: false,
  format: "esm",
  write: false,
  metafile: true,
  logLevel: "silent",
});
const libNames = Object.values(lib.metafile.outputs)[0].exports;
const shared = {
  name: "pinwren-shared",
  setup(b) {
    b.onResolve({ filter: SHARED }, (a) => ({ path: a.path, namespace: "pinwren-lib" }));
    b.onLoad({ filter: /.*/, namespace: "pinwren-lib" }, () => ({
      contents: `export const { ${libNames.join(", ")} } = window.__pinwrenLib;`,
      loader: "js",
    }));
  },
};

// The stylesheets are CSS inside template literals (`/* css */ \`…\``), which esbuild can't minify:
// strip comments and collapse whitespace there ourselves. Selectors keep a space before `:` (descendant vs.
// pseudo-class), so only the unambiguous spaces go.
const minifyCss = {
  name: "pinwren-css",
  setup(b) {
    b.onLoad({ filter: /styles\.ts$/ }, async (a) => {
      const text = await readFile(a.path, "utf8");
      const contents = text.replace(/\/\* css \*\/ `([\s\S]*?)`;/g, (_m, css) => {
        const min = css
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\s+/g, " ")
          .replace(/\s*([{};,>])\s*/g, "$1")
          .replace(/:\s+/g, ":")
          .replace(/;}/g, "}")
          .trim();
        return `\`${min}\`;`;
      });
      return { contents, loader: "ts" };
    });
  },
};

const common = {
  absWorkingDir: pkgDir,
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2020", "safari15"],
  legalComments: "eof",
  write: false,
  logLevel: "warning",
};

/** Build one bundle in memory and return its code. */
async function bundle(options) {
  const r = await build({ ...common, ...options });
  return r.outputFiles[0].text;
}

const hash = (code) => createHash("sha256").update(code).digest("hex").slice(0, 10);
const sizes = (code) => ({
  raw: Buffer.byteLength(code),
  gzip: gzipSync(code, { level: 9 }).length,
  brotli: brotliCompressSync(code).length,
});

async function buildAll() {
  const started = Date.now();
  const parts = await Promise.all([
    ...CHUNKS.map(async (name) => ({
      key: name,
      code: await bundle({ entryPoints: [`src/${name}.ts`], plugins: [shared, minifyCss] }),
    })),
    ...LOCALES.map(async (code) => ({
      key: `i18n-${code}`,
      code: await bundle({
        stdin: {
          contents: `import c from "./locales/${code}"; (window.__pinwrenI18n ||= {})[${JSON.stringify(code)}] = c;`,
          resolveDir: src,
          loader: "ts",
        },
      }),
    })),
  ]);
  const files = new Map(); // file name → code
  const chunks = {};
  for (const p of parts) {
    const file = `widget-${p.key}.${hash(p.code)}.js`;
    chunks[p.key] = file;
    files.set(file, p.code);
  }
  // The core goes last: the chunk names are compiled into it.
  const core = await bundle({
    entryPoints: ["src/index.ts"],
    plugins: [minifyCss],
    define: { __PINWREN_MANIFEST__: JSON.stringify(chunks) },
  });
  files.set("widget.js", core);

  for (const dir of outdirs) {
    await mkdir(dir, { recursive: true });
    await Promise.all([...files].map(([f, code]) => writeFile(join(dir, f), code)));
    // Old hashed (and pre-hashing, un-hashed) chunks of earlier builds.
    for (const f of await readdir(dir))
      if (/^widget-[\w.-]+\.js$/.test(f) && !files.has(f)) await rm(join(dir, f), { force: true });
  }

  const manifest = {
    name: pkg.name,
    version: pkg.version,
    entry: "widget.js",
    chunks,
    files: Object.fromEntries([...files].map(([f, code]) => [f, sizes(code)])),
  };
  await writeFile(join(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  // The licences of the bundled third-party code travel with the package.
  await copyFile(join(pkgDir, "..", "..", "THIRD_PARTY_NOTICES.md"), join(dist, "THIRD_PARTY_NOTICES.md"));

  // npm ESM entry (`import { init } from "@pinwren/widget"`) — a loader, not the widget itself.
  await build({
    absWorkingDir: pkgDir,
    entryPoints: ["src/loader.ts"],
    outfile: join(dist, "index.js"),
    bundle: true,
    format: "esm",
    target: ["es2020"],
    platform: "neutral",
    logLevel: "warning",
  });
  // Its declarations: one self-contained file (the public types are defined in loader.ts).
  const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  execFileSync(process.execPath, [tsc, "-p", "tsconfig.types.json"], { cwd: pkgDir, stdio: "inherit" });
  await rename(join(dist, ".types", "loader.d.ts"), join(dist, "index.d.ts"));
  await rm(join(dist, ".types"), { recursive: true, force: true });

  report(manifest, Date.now() - started);
}

function report(manifest, ms) {
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  const rows = [
    ["widget", "widget.js"],
    ...Object.entries(manifest.chunks).filter(([k]) => !k.startsWith("i18n")),
  ];
  const over = [];
  console.log(`\n  ${manifest.name} ${manifest.version}  (gzip -9 / brotli)`);
  for (const [key, file] of rows) {
    const s = manifest.files[file];
    const budget = BUDGET[key];
    const flag = budget && s.gzip > budget * 1024 ? `  over the ${budget} KB budget` : "";
    if (flag) over.push(key);
    console.log(`  ${file.padEnd(32)} ${kb(s.gzip).padStart(9)} ${kb(s.brotli).padStart(9)}${flag}`);
  }
  const i18n = Object.entries(manifest.chunks).filter(([k]) => k.startsWith("i18n"));
  const max = Math.max(...i18n.map(([, f]) => manifest.files[f].gzip));
  console.log(`  ${`${i18n.length} locale files`.padEnd(32)} ≤${kb(max).padStart(8)}`);
  console.log(`  built in ${ms} ms${over.length ? ` — over budget: ${over.join(", ")}` : ""}\n`);
}

await buildAll();

if (process.argv.includes("--watch")) {
  let timer;
  let running = Promise.resolve();
  fsWatch(src, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      running = running.then(buildAll).catch((err) => console.error(err));
    }, 100);
  });
  console.log("  watching src/ …");
}
