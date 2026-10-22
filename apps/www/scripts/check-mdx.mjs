// Compiles every docs page with MDX (as `next build` would) and checks that each JSX component it uses is
// registered in src/components/mdx.tsx and that every /docs link points at a page that exists.
//   node scripts/check-mdx.mjs [content/docs/widget]
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const app = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(realpathSync(join(app, "node_modules/fumadocs-mdx/package.json")));
const resolveEsm = (name) => pathToFileURL(require.resolve(name)).href;
const { compile } = await import(resolveEsm("@mdx-js/mdx"));
const remarkGfm = (await import(resolveEsm("remark-gfm"))).default;

const ALLOWED = new Set([
  "Accordion",
  "Accordions",
  "Callout",
  "Card",
  "Cards",
  "EnvTable",
  "File",
  "Files",
  "Folder",
  "NewIn",
  "Step",
  "Steps",
  "Tab",
  "Tabs",
  "TypeTable",
]);

const root = join(app, "content/docs");
const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".mdx") ? [p] : [];
  });
const all = walk(root);
const routes = new Set(
  all.map((f) => {
    const r = relative(root, f)
      .replace(/\\/g, "/")
      .replace(/\.mdx$/, "")
      .replace(/(^|\/)index$/, "");
    return r ? `/docs/${r}` : "/docs";
  }),
);

const target = process.argv[2] ? join(app, process.argv[2]) : root;
let failed = 0;
for (const file of all.filter((f) => f.startsWith(target))) {
  const rel = relative(app, file);
  const text = readFileSync(file, "utf8");
  if (!/^---\n(?:[\s\S]*?\n)?title: .+\n[\s\S]*?---/.test(text.replace(/\r\n/g, "\n"))) {
    console.error(`${rel}: missing frontmatter title`);
    failed++;
  }
  try {
    await compile(text.replace(/^---[\s\S]*?---/, ""), { remarkPlugins: [remarkGfm] });
  } catch (err) {
    console.error(`${rel}: ${err.message}`);
    failed++;
  }
  const body = text.replace(/```[\s\S]*?```/g, "");
  for (const m of body.matchAll(/<([A-Z][A-Za-z]*)/g)) {
    if (!ALLOWED.has(m[1])) {
      console.error(`${rel}: unknown component <${m[1]}>`);
      failed++;
    }
  }
  for (const m of body.matchAll(/\]\((\/docs[^)#\s]*)(#[^)]*)?\)|href="(\/docs[^"#]*)/g)) {
    const link = (m[1] ?? m[3]).replace(/\/$/, "") || "/docs";
    if (!routes.has(link)) {
      console.error(`${rel}: broken link ${link}`);
      failed++;
    }
  }
}
console.log(failed ? `${failed} problem(s)` : `ok — ${all.length} pages`);
process.exit(failed ? 1 : 0);
