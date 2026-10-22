#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { PinwrenError } from "@pinwren/sdk";
import pkg from "../package.json" with { type: "json" };
import { doctor, status } from "./checks";
import {
  assertProjectKey,
  detectFramework,
  type Framework,
  insertIntoHtml,
  insertIntoNextLayout,
  normalizeUrl,
  snippetFor,
} from "./snippet";

const HELP = `pinwren ${pkg.version} — Pinwren command line

Usage:
  pinwren init   [--url <instance>] [--key <pk_…>] [--framework html|vite|next] [--write] [--file <path>]
      Print the widget snippet for this project (and insert it with --write).
  pinwren doctor --url <instance> [--key <pk_…>] [--origin <https://your-site>] [--json]
      Check the server, widget.js and the widget config for a project key + origin.
  pinwren status --url <instance> --token <pwt_…> [--json]
      List projects and their open feedback.

Environment: PINWREN_URL, PINWREN_KEY, PINWREN_TOKEN fill the matching flags.`;

const ok = (s: string) => `✓ ${s}`;
const bad = (s: string) => `✗ ${s}`;

async function ask(question: string, fallback?: string): Promise<string> {
  if (!process.stdin.isTTY) {
    if (fallback) return fallback;
    throw new Error(`${question.trim()} — pass it as a flag (not an interactive terminal)`);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(fallback ? `${question} (${fallback}) ` : `${question} `)).trim();
    return answer || fallback || "";
  } finally {
    rl.close();
  }
}

function readPackageJson(dir: string) {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { dependencies?: object };
  } catch {
    return null;
  }
}

function targetFile(framework: Framework, cwd: string, given?: string): string | null {
  if (given) return given;
  const candidates =
    framework === "next"
      ? ["app/layout.tsx", "src/app/layout.tsx", "app/layout.jsx", "src/app/layout.jsx"]
      : ["index.html", "public/index.html", "src/index.html"];
  return candidates.map((c) => join(cwd, c)).find((p) => existsSync(p)) ?? null;
}

async function init(values: Record<string, string | boolean | undefined>): Promise<number> {
  const url = normalizeUrl(
    (values.url as string | undefined) ??
      process.env.PINWREN_URL ??
      (await ask("Pinwren URL (e.g. https://feedback.example.com):")),
  );
  const projectKey = assertProjectKey(
    (values.key as string | undefined) ?? process.env.PINWREN_KEY ?? (await ask("Project key (pk_…):")),
  );
  const cwd = process.cwd();
  const framework = (values.framework as Framework | undefined) ?? detectFramework(readPackageJson(cwd));
  if (!["html", "vite", "next"].includes(framework)) throw new Error("--framework is html, vite or next");
  const input = { url, projectKey };
  const snippet = snippetFor(framework, input);

  if (!values.write) {
    console.log(
      framework === "next"
        ? `Add to your root layout (app/layout.tsx), inside <body>:\n\n  import Script from "next/script";\n\n  ${snippet}\n`
        : `Add before </body> of every page${framework === "vite" ? " (index.html)" : ""}:\n\n  ${snippet}\n`,
    );
    console.log(`Then run: pinwren doctor --url ${url} --key ${projectKey} --origin <your site>`);
    return 0;
  }
  const file = targetFile(framework, cwd, values.file as string | undefined);
  if (!file) {
    console.error(
      bad(`No ${framework === "next" ? "app/layout.tsx" : "index.html"} found; pass --file. Snippet:`),
    );
    console.log(snippet);
    return 1;
  }
  const source = readFileSync(file, "utf8");
  const next = framework === "next" ? insertIntoNextLayout(source, input) : insertIntoHtml(source, input);
  if (next === null) {
    console.log(
      source.includes("data-project=")
        ? ok(`${file} already loads the widget`)
        : bad(`${file} has no </body>; add this yourself:\n  ${snippet}`),
    );
    return source.includes("data-project=") ? 0 : 1;
  }
  writeFileSync(file, next);
  console.log(ok(`Added the widget to ${file}`));
  return 0;
}

async function run(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      url: { type: "string" },
      key: { type: "string" },
      token: { type: "string" },
      origin: { type: "string" },
      framework: { type: "string" },
      file: { type: "string" },
      write: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  if (values.version) {
    console.log(pkg.version);
    return 0;
  }
  const [command] = positionals;
  if (values.help || !command) {
    console.log(HELP);
    return command || values.help ? 0 : 1;
  }

  if (command === "init") return init(values);

  const rawUrl = values.url ?? process.env.PINWREN_URL;
  if (!rawUrl) throw new Error("--url (or PINWREN_URL) is required");
  const url = normalizeUrl(rawUrl);

  if (command === "doctor") {
    const checks = await doctor({
      url,
      projectKey: values.key ?? process.env.PINWREN_KEY,
      origin: values.origin,
    });
    const failed = checks.some((c) => !c.ok);
    if (values.json) console.log(JSON.stringify({ ok: !failed, checks }, null, 2));
    else for (const c of checks) console.log(`${c.ok ? (c.warn ? "- " : "✓ ") : "✗ "}${c.name}: ${c.detail}`);
    return failed ? 1 : 0;
  }

  if (command === "status") {
    const token = values.token ?? process.env.PINWREN_TOKEN;
    if (!token)
      throw new Error("--token (or PINWREN_TOKEN) is required: create one in Settings › API tokens");
    const s = await status(url, token);
    if (values.json) {
      console.log(JSON.stringify(s, null, 2));
      return 0;
    }
    console.log(`Signed in as ${s.user ?? "?"} (${s.role})`);
    if (!s.projects.length) console.log("No projects yet.");
    const width = Math.max(7, ...s.projects.map((p) => p.name.length));
    for (const p of s.projects)
      console.log(`  ${p.name.padEnd(width)}  ${String(p.openCount).padStart(4)} open`);
    return 0;
  }

  throw new Error(`Unknown command "${command}". Run pinwren --help.`);
}

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (err) {
  const msg =
    err instanceof PinwrenError
      ? `${err.message} (${err.code})`
      : err instanceof Error
        ? err.message
        : String(err);
  console.error(bad(msg));
  process.exitCode = 1;
}
