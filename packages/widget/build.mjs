import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

// Script-tag bundles (blueprint 05 §1–§2): the widget core, its lazy chunks (side panel, bug report form,
// screenshot capture + editor) and one small file per non-English locale (widget-i18n-<code>.js), loaded only
// for visitors in that language. They are written to dist/ and copied into the web app's public/ so the
// server hosts them.
const outdirs = [
  fileURLToPath(new URL("./dist", import.meta.url)),
  fileURLToPath(new URL("../../apps/web/public", import.meta.url)),
];
const watch = process.argv.includes("--watch");
const LOCALES = ["es", "fr", "de", "pt-BR", "it", "ja", "hi", "nl", "zh", "ru"];
const CHUNKS = ["panel", "report", "capture"];
const src = fileURLToPath(new URL("./src", import.meta.url));

// Chunks share the core's modules through `window.__annotaLib` (src/lib.ts) instead of bundling copies:
// an import of one of these from a chunk becomes a read of the object the core put there.
const SHARED = /^\.\/(chunks|config|diagnostics|dom|env|form|i18n|idb|picker|queue|store|ui)$/;
const lib = await build({
  entryPoints: ["src/lib.ts"],
  bundle: false,
  format: "esm",
  write: false,
  metafile: true,
  logLevel: "silent",
});
const libNames = Object.values(lib.metafile.outputs)[0].exports;
const shared = {
  name: "annota-shared",
  setup(b) {
    b.onResolve({ filter: SHARED }, (a) => ({ path: a.path, namespace: "annota-lib" }));
    b.onLoad({ filter: /.*/, namespace: "annota-lib" }, () => ({
      contents: `export const { ${libNames.join(", ")} } = window.__annotaLib;`,
      loader: "js",
    }));
  },
};

// The stylesheets are CSS inside template literals (`/* css */ \`…\``), which esbuild can't minify:
// strip comments and collapse whitespace there ourselves. Selectors keep a space before `:` (descendant vs.
// pseudo-class), so only the unambiguous spaces go.
const minifyCss = {
  name: "annota-css",
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

const configs = outdirs
  .flatMap((outdir) => [
    { entryPoints: ["src/index.ts"], outfile: `${outdir}/widget.js`, plugins: [minifyCss] },
    ...CHUNKS.map((name) => ({
      entryPoints: [`src/${name}.ts`],
      outfile: `${outdir}/widget-${name}.js`,
      plugins: [shared, minifyCss],
    })),
    ...LOCALES.map((code) => ({
      stdin: {
        contents: `import c from "./locales/${code}"; (window.__annotaI18n ||= {})[${JSON.stringify(code)}] = c;`,
        resolveDir: src,
        loader: "ts",
      },
      outfile: `${outdir}/widget-i18n-${code}.js`,
    })),
  ])
  .map((c) => ({
    ...c,
    bundle: true,
    minify: true,
    format: "iife",
    target: ["es2020", "safari15"],
    legalComments: "eof",
    logLevel: "info",
  }));

for (const dir of outdirs) await mkdir(dir, { recursive: true });
if (watch) {
  for (const c of configs) await (await context(c)).watch();
} else {
  await Promise.all(configs.map((c) => build(c)));
}
