import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

// Two script-tag bundles: the widget core, and the screenshot module it loads on demand.
// They are written to dist/ and copied into the web app's public/ so the server hosts them.
const outdirs = [
  fileURLToPath(new URL("./dist", import.meta.url)),
  fileURLToPath(new URL("../../apps/web/public", import.meta.url)),
];
const watch = process.argv.includes("--watch");

const configs = outdirs
  .flatMap((outdir) => [
    { entryPoints: ["src/index.ts"], outfile: `${outdir}/widget.js` },
    { entryPoints: ["src/capture.ts"], outfile: `${outdir}/widget-capture.js` },
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
