import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

// Script-tag bundles: the widget core, the screenshot + editor module it loads on the first bug report, and
// one small file per non-English locale (widget-i18n-<code>.js) loaded only for visitors in that language.
// They are written to dist/ and copied into the web app's public/ so the server hosts them.
const outdirs = [
  fileURLToPath(new URL("./dist", import.meta.url)),
  fileURLToPath(new URL("../../apps/web/public", import.meta.url)),
];
const watch = process.argv.includes("--watch");
const LOCALES = ["es", "fr", "de", "pt-BR", "it", "ja", "hi", "nl", "zh"];
const src = fileURLToPath(new URL("./src", import.meta.url));

const configs = outdirs
  .flatMap((outdir) => [
    { entryPoints: ["src/index.ts"], outfile: `${outdir}/widget.js` },
    { entryPoints: ["src/capture.ts"], outfile: `${outdir}/widget-capture.js` },
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
