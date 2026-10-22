// Generates what the website reads from the rest of the repository, so docs never drift from the code:
//
//   src/generated/env.json        every environment variable, parsed from packages/api/src/env.ts (the Zod
//                                 schema the server validates its config with) plus the few read elsewhere
//   src/generated/changelog.json  CHANGELOG.md split into releases
//   public/demo-api/widget*.js    the built widget (packages/widget/dist) for the live demo on /demo
//
// Runs before `next dev`, `next build` and the typecheck. Never edits anything outside apps/www.
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");
const repo = join(app, "../..");
const out = join(app, "src/generated");
mkdirSync(out, { recursive: true });

const write = (file, data) => writeFileSync(join(out, file), `${JSON.stringify(data, null, 2)}\n`);

// --- Environment variables ---------------------------------------------------------------------------

/** Where each variable is documented; anything not listed lands in "Other" so a new key still shows up. */
const GROUPS = [
  ["Required", ["DATABASE_URL", "PINWREN_URL", "PINWREN_SECRET"]],
  [
    "Server",
    [
      "PINWREN_DATA_DIR",
      "PINWREN_DISABLE_SIGNUP",
      "PINWREN_ADMIN_EMAILS",
      "PINWREN_ROLE",
      "PINWREN_WORKERS",
      "DATABASE_POOL_MAX",
      "PINWREN_JOBS_POOL_MAX",
      "WIDGET_RATE_LIMIT_PER_MIN",
      "PINWREN_SKIP_MIGRATIONS",
      "PINWREN_MIGRATIONS_DIR",
    ],
  ],
  ["Security", ["PINWREN_TRUST_PROXY", "PINWREN_ENFORCE_HTTPS", "PINWREN_SESSION_DAYS"]],
  ["Email (SMTP)", ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_SECURE", "EMAIL_FROM"]],
  [
    "Storage",
    [
      "STORAGE_DRIVER",
      "S3_ENDPOINT",
      "S3_BUCKET",
      "S3_REGION",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "S3_FORCE_PATH_STYLE",
    ],
  ],
  ["Issue trackers", ["GITHUB_API_URL", "GITLAB_URL"]],
  ["Updates", ["PINWREN_UPDATE_CHECK", "PINWREN_UPDATE_REPO", "PINWREN_VERSION"]],
  ["Enterprise licence", ["PINWREN_LICENSE_FILE", "PINWREN_INSTANCE_ID"]],
];

/** Plain-language descriptions. The schema's own comments are appended when it has them. */
const DESCRIPTIONS = {
  DATABASE_URL: "Postgres connection string. The Docker compose file builds it from `POSTGRES_PASSWORD`.",
  PINWREN_URL:
    "The public URL people open and the widget calls, without a trailing slash, e.g. `https://feedback.example.com`.",
  PINWREN_SECRET:
    "At least 32 characters (`openssl rand -base64 48`). Signs sessions and encrypts stored credentials such as the SMTP password and tracker tokens. Keep it stable: changing it signs everyone out and makes stored credentials unreadable.",
  PINWREN_DATA_DIR:
    "Folder for uploaded files when `STORAGE_DRIVER=fs`. The Docker image sets it to `/data`.",
  PINWREN_DISABLE_SIGNUP: "Close public sign-up once your team has accounts; invite everyone else.",
  PINWREN_ADMIN_EMAILS:
    "Comma-separated emails of instance admins (email settings, security settings). Unset: the first user who signed up.",
  PINWREN_ROLE:
    "`all` serves HTTP and runs background jobs; `web` serves only (jobs are still enqueued); `worker` runs jobs only.",
  PINWREN_WORKERS:
    "Node processes serving requests in the Docker image (`node:cluster`), roughly one per CPU core. `1` runs a single process.",
  DATABASE_POOL_MAX: "Postgres connections per process for requests.",
  PINWREN_JOBS_POOL_MAX: "Postgres connections per process for the pg-boss job queue.",
  WIDGET_RATE_LIMIT_PER_MIN:
    "Reports and replies one IP may send per project per minute. Each project can override it.",
  PINWREN_SKIP_MIGRATIONS: "`true` skips the automatic database migrations on start.",
  PINWREN_MIGRATIONS_DIR: "Where the SQL migrations live. Set by the Docker image; leave it alone.",
  PINWREN_TRUST_PROXY:
    "Believe `X-Forwarded-For`, `-Proto` and `-Host`. Turn on only behind a reverse proxy that sets them (the compose file defaults it to on).",
  PINWREN_ENFORCE_HTTPS: "Redirect or refuse plain-HTTP requests that don't come from localhost.",
  PINWREN_SESSION_DAYS:
    "Session lifetime in days (1–90) for new sign-ins. Setting it locks the field in Settings › Security.",
  SMTP_HOST: "SMTP server. Without it, emails are skipped (in-app notifications still work).",
  SMTP_PORT: "SMTP port, usually 587 (STARTTLS) or 465 (TLS).",
  SMTP_USER: "SMTP username.",
  SMTP_PASSWORD: "SMTP password.",
  SMTP_SECURE: "`true` for implicit TLS (port 465); `false` uses STARTTLS when the server offers it.",
  EMAIL_FROM: 'Sender, e.g. `"Pinwren <feedback@example.com>"`.',
  STORAGE_DRIVER: "`fs` stores files under `PINWREN_DATA_DIR`; `s3` uses any S3-compatible bucket.",
  S3_ENDPOINT:
    "S3 endpoint URL (AWS, Cloudflare R2, MinIO, Backblaze B2, …). Required with `STORAGE_DRIVER=s3`.",
  S3_BUCKET: "Bucket name. Required with `STORAGE_DRIVER=s3`. Keep it private.",
  S3_REGION: "Bucket region; `auto` works for R2 and most S3-compatible services.",
  S3_ACCESS_KEY_ID: "Access key. Required with `STORAGE_DRIVER=s3`.",
  S3_SECRET_ACCESS_KEY: "Secret key. Required with `STORAGE_DRIVER=s3`.",
  S3_FORCE_PATH_STYLE: "Path-style URLs (`endpoint/bucket/key`), needed by MinIO and most self-hosted S3.",
  GITHUB_API_URL: "GitHub API base URL. Each integration can override it (GitHub Enterprise Server).",
  GITLAB_URL: "GitLab base URL. Each integration can override it (self-managed GitLab).",
  PINWREN_UPDATE_CHECK:
    "Daily check for a newer release, shown to instance admins. Setting it locks the switch in Settings › Security; it is off on its own while any project uses privacy mode.",
  PINWREN_UPDATE_REPO: "GitHub repository whose latest release is compared with `PINWREN_VERSION`.",
  PINWREN_VERSION: "The running version (set by the release); used by the update check.",
  PINWREN_LICENSE_FILE:
    "Path to an Enterprise licence file inside the container. Setting it overrides and locks the upload in Settings › Licence. Community installs need no licence.",
  PINWREN_INSTANCE_ID:
    "Only for licences bound to one instance: this instance's id, matched against the licence.",
};

/** Variables read outside the Zod schema (database pool, cluster, jobs, migrations). */
const EXTRA = [
  { name: "PINWREN_WORKERS", type: "number", default: "2", source: "docker/cluster.cjs" },
  { name: "DATABASE_POOL_MAX", type: "number", default: "10", source: "packages/db/src/index.ts" },
  { name: "PINWREN_JOBS_POOL_MAX", type: "number", default: "3", source: "packages/api/src/jobs/boss.ts" },
  {
    name: "PINWREN_SKIP_MIGRATIONS",
    type: "boolean",
    default: "false",
    source: "apps/web/src/instrumentation-node.ts",
  },
  {
    name: "PINWREN_MIGRATIONS_DIR",
    type: "string",
    default: null,
    source: "apps/web/src/instrumentation-node.ts",
  },
];

function parseEnvSchema() {
  const file = join(repo, "packages/api/src/env.ts");
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  /** @type {ts.ObjectLiteralExpression | undefined} */
  let literal;
  sf.forEachChild(function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(sf) === "schema" &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      const arg = node.initializer.arguments[0];
      if (arg && ts.isObjectLiteralExpression(arg)) literal = arg;
    }
    node.forEachChild(visit);
  });
  if (!literal)
    throw new Error("prepare: couldn't find `const schema = z.object({…})` in packages/api/src/env.ts");

  const vars = [];
  for (const prop of literal.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = prop.name.getText(sf);
    const expr = prop.initializer.getText(sf).replace(/\s+/g, "");
    // Own doc comment (/** … */ or // lines directly above), skipping section headings separated by a blank line.
    const ranges = ts.getLeadingCommentRanges(text, prop.getFullStart()) ?? [];
    const comments = [];
    for (const r of ranges) {
      const raw = text.slice(r.pos, r.end);
      const after = text.slice(r.end, prop.getStart(sf));
      if (/\n\s*\n/.test(after)) continue; // a heading for the group, not this variable
      comments.push(
        raw
          .replace(/^\/\*\*?|\*\/$/g, "")
          .replace(/^\s*\*\s?/gm, "")
          .replace(/^\/\/\s?/gm, "")
          .trim(),
      );
    }
    const trailing = ts.getTrailingCommentRanges(text, prop.getEnd() + 1) ?? [];
    for (const r of trailing) {
      const c = text
        .slice(r.pos, r.end)
        .replace(/^\/\/\s?/, "")
        .trim();
      if (!c.startsWith("x-release-please")) comments.push(c);
    }

    let type = "string";
    let values = null;
    let def = null;
    let required = true;
    const enumMatch = /z\.enum\(\[([^\]]*)\]\)/.exec(expr);
    if (/^bool\(/.test(expr)) {
      type = "boolean";
      def = /^bool\("(\w+)"\)/.exec(expr)?.[1] ?? null;
    } else if (enumMatch) {
      const opts = enumMatch[1].split(",").map((s) => s.replace(/"/g, ""));
      const boolish = opts.every((o) => ["0", "1", "true", "false"].includes(o));
      type = boolish ? "boolean" : "enum";
      if (!boolish) values = opts;
    } else if (/z\.coerce\.number/.test(expr)) type = "number";
    else if (/z\.url\(/.test(expr)) type = "url";
    else if (expr === "optionalString") type = "string";
    const defMatch = /\.default\(("?)([^)"]*)\1\)/.exec(expr);
    if (defMatch) def = defMatch[2];
    if (def !== null || /\.optional\(\)|optionalString|^bool\(/.test(expr)) required = false;
    const min = /\.min\((\d+)/.exec(expr)?.[1];
    const max = /\.max\((\d+)/.exec(expr)?.[1];
    vars.push({
      name,
      type,
      values,
      default: def,
      required,
      range: type === "number" && min && max ? `${min}–${max}` : null,
      schemaComment: comments.join(" ") || null,
      source: "packages/api/src/env.ts",
    });
  }
  return vars;
}

const schemaVars = parseEnvSchema();
const known = new Set(schemaVars.map((v) => v.name));
const all = [
  ...schemaVars,
  ...EXTRA.filter((e) => !known.has(e.name)).map((e) => ({
    values: null,
    required: false,
    range: null,
    schemaComment: null,
    ...e,
  })),
];
const byName = new Map(all.map((v) => [v.name, v]));
const grouped = [];
const placed = new Set();
for (const [title, names] of GROUPS) {
  const items = names.filter((n) => byName.has(n)).map((n) => byName.get(n));
  items.forEach((v) => placed.add(v.name));
  if (items.length) grouped.push({ title, items });
}
const other = all.filter((v) => !placed.has(v.name));
if (other.length) grouped.push({ title: "Other", items: other });
for (const g of grouped)
  for (const v of g.items) v.description = DESCRIPTIONS[v.name] ?? v.schemaComment ?? "";
write("env.json", { generatedFrom: "packages/api/src/env.ts", groups: grouped });

// --- Changelog --------------------------------------------------------------------------------------

const changelog = readFileSync(join(repo, "CHANGELOG.md"), "utf8").replace(/\r\n/g, "\n");
const releases = [];
const linkDefs = {};
for (const m of changelog.matchAll(/^\[([^\]]+)\]:\s*(\S+)$/gm)) linkDefs[m[1]] = m[2];
const parts = changelog.split(/^## /m).slice(1);
for (const part of parts) {
  const [head = "", ...rest] = part.split("\n");
  const body = rest
    .join("\n")
    .replace(/^\[[^\]]+\]:\s*\S+$/gm, "")
    .trim();
  const version = /\[?([^\]\s]+)\]?/.exec(head)?.[1] ?? head;
  const date = /(\d{4}-\d{2}-\d{2})/.exec(head)?.[1] ?? null;
  releases.push({ version, date, link: linkDefs[version] ?? null, body });
}
write("changelog.json", { releases });

// --- Demo widget ----------------------------------------------------------------------------------------

const widgetDist = join(repo, "packages/widget/dist");
if (!existsSync(join(widgetDist, "widget.js"))) {
  console.log("[www] packages/widget/dist is missing — building the widget once");
  execFileSync(process.execPath, ["build.mjs"], { cwd: join(repo, "packages/widget"), stdio: "inherit" });
}
const demoDir = join(app, "public/demo-api");
rmSync(demoDir, { recursive: true, force: true });
mkdirSync(demoDir, { recursive: true });
let copied = 0;
for (const f of readdirSync(widgetDist)) {
  if (!/^widget.*\.(js|json)$/.test(f)) continue;
  copyFileSync(join(widgetDist, f), join(demoDir, f));
  copied++;
}
console.log(
  `[www] env reference: ${all.length} variables · changelog: ${releases.length} release(s) · demo widget: ${copied} file(s)`,
);
