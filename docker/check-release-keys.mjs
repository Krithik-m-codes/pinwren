// Release gate: an official build must carry at least one production licence public key, or no
// Enterprise licence can ever verify on it (dev keys are refused in production). Run by the Dockerfile
// when PINWREN_RELEASE=1 (the release workflow), and usable on its own:
//   node docker/check-release-keys.mjs
// Steps for maintainers: docs/release/licence-keys.md.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("../packages/api/src/license/keys.ts", import.meta.url));
const source = readFileSync(file, "utf8");
const block = /export const PRODUCTION_KEYS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(source)?.[1] ?? "";
// Entries look like `"kid": "MCowBQYDK2VwAyEA…",` — commented-out lines don't count.
const keys = block
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => !l.startsWith("//"))
  .filter((l) => /^["'][\w.-]+["']\s*:\s*["']MCow[A-Za-z0-9+/=]{40,}["']/.test(l));

if (keys.length === 0) {
  console.error(
    [
      "",
      "ERROR: PRODUCTION_KEYS in packages/api/src/license/keys.ts is empty.",
      "A release build without a production public key can't verify any Enterprise licence.",
      "Generate a key pair with `node tools/sign-license keygen` (see docs/release/licence-keys.md),",
      "commit only the public key, and keep the private key in the secret store.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
console.log(`[release] ${keys.length} production licence key(s) present.`);
