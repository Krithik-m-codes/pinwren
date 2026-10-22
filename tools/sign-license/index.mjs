#!/usr/bin/env node
// Sign Pinwren Enterprise licence files. Internal tool for maintainers — see README.md.
//
//   node tools/sign-license keygen
//   PINWREN_LICENSE_PRIVATE_KEY="$(cat key.pem)" node tools/sign-license sign payload.json --out acme.lic
//   node tools/sign-license verify acme.lic --public-key MCowBQYDK2VwAyEA…
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { generateKeys, signLicense, verifyLicense } from "./lib.mjs";

const USAGE = `Usage:
  sign-license keygen
      Print a new Ed25519 key pair. Put the public key in packages/api/src/license/keys.ts
      (PRODUCTION_KEYS, under a new key id); store the private key in your secret manager.
  sign-license sign <payload.json> [--kid <id>] [--days <n>] [--out <file.lic>]
      Sign a payload. The private key comes from PINWREN_LICENSE_PRIVATE_KEY (PEM or base64
      PKCS#8) or the file in PINWREN_LICENSE_PRIVATE_KEY_FILE — never from an argument.
      --days sets issuedAt = now and expiresAt = now + n days.
  sign-license verify <file.lic> --public-key <base64 SPKI>
      Check a file and print its payload.`;

function privateKey() {
  if (process.env.PINWREN_LICENSE_PRIVATE_KEY) return process.env.PINWREN_LICENSE_PRIVATE_KEY;
  if (process.env.PINWREN_LICENSE_PRIVATE_KEY_FILE) {
    return readFileSync(process.env.PINWREN_LICENSE_PRIVATE_KEY_FILE, "utf8");
  }
  throw new Error("set PINWREN_LICENSE_PRIVATE_KEY or PINWREN_LICENSE_PRIVATE_KEY_FILE");
}

function main(argv) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      kid: { type: "string" },
      days: { type: "string" },
      out: { type: "string" },
      "public-key": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, file] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return command ? 0 : 1;
  }
  if (command === "keygen") {
    const k = generateKeys();
    console.log(`Public key (commit this, base64 SPKI):\n${k.publicKey}\n`);
    console.log(`Private key (keep secret, never commit):\n${k.privateKeyPem}`);
    return 0;
  }
  if (command === "sign") {
    if (!file) throw new Error("sign needs a payload JSON file");
    const payload = JSON.parse(readFileSync(file, "utf8"));
    if (values.kid) payload.kid = values.kid;
    if (values.days) {
      const days = Number(values.days);
      if (!Number.isInteger(days) || days < 1) throw new Error("--days must be a whole number ≥ 1");
      const now = Date.now();
      payload.issuedAt = new Date(now).toISOString();
      payload.expiresAt = new Date(now + days * 86_400_000).toISOString();
    }
    const lic = signLicense(payload, privateKey());
    if (values.out) {
      writeFileSync(values.out, `${lic}\n`);
      console.error(`wrote ${values.out}`);
    } else {
      console.log(lic);
    }
    return 0;
  }
  if (command === "verify") {
    if (!file || !values["public-key"]) throw new Error("verify needs a .lic file and --public-key");
    console.log(JSON.stringify(verifyLicense(readFileSync(file, "utf8"), values["public-key"]), null, 2));
    return 0;
  }
  throw new Error(`unknown command "${command}"\n\n${USAGE}`);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  console.error(`sign-license: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
