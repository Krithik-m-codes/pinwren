import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateKeys, normalizePayload, signLicense, verifyLicense } from "./lib.mjs";

const payload = {
  kid: "test",
  lid: "lic_test",
  customer: "Acme",
  features: ["white_label"],
  issuedAt: "2026-01-01T00:00:00Z",
  expiresAt: "2027-01-01T00:00:00Z",
};

describe("sign-license", () => {
  it("signs with a fresh key pair and verifies", () => {
    const k = generateKeys();
    const lic = signLicense(payload, k.privateKeyPem);
    expect(lic.split(".")).toHaveLength(2);
    const p = verifyLicense(lic, k.publicKey);
    expect(p).toMatchObject({ v: 1, edition: "enterprise", lid: "lic_test", graceDays: 30, instance: null });
  });

  it("rejects a tampered payload and another key", () => {
    const k = generateKeys();
    const [body, sig] = signLicense(payload, k.privateKeyPem).split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), customer: "Mallory" }),
    ).toString("base64url");
    expect(() => verifyLicense(`${forged}.${sig}`, k.publicKey)).toThrow(/signature/);
    expect(() => verifyLicense(`${body}.${sig}`, generateKeys().publicKey)).toThrow(/signature/);
  });

  it("refuses incomplete payloads", () => {
    expect(() => normalizePayload({ ...payload, kid: undefined })).toThrow(/kid/);
    expect(() => normalizePayload({ ...payload, expiresAt: "2025-01-01T00:00:00Z" })).toThrow(/after/);
    expect(() => normalizePayload({ ...payload, features: [1] })).toThrow(/features/);
  });

  it("CLI: signs from the environment key only", () => {
    const k = generateKeys();
    const dir = mkdtempSync(join(tmpdir(), "pinwren-lic-"));
    const file = join(dir, "p.json");
    writeFileSync(file, JSON.stringify(payload));
    const cli = fileURLToPath(new URL("./index.mjs", import.meta.url));
    const out = join(dir, "a.lic");
    execFileSync(process.execPath, [cli, "sign", file, "--days", "30", "--out", out], {
      env: { ...process.env, PINWREN_LICENSE_PRIVATE_KEY: k.privateKeyPem },
      stdio: "pipe",
    });
    const p = verifyLicense(readFileSync(out, "utf8"), k.publicKey);
    expect(Date.parse(p.expiresAt) - Date.parse(p.issuedAt)).toBe(30 * 86_400_000);
    expect(() =>
      execFileSync(process.execPath, [cli, "sign", file], {
        env: { ...process.env, PINWREN_LICENSE_PRIVATE_KEY: "", PINWREN_LICENSE_PRIVATE_KEY_FILE: "" },
        stdio: "pipe",
      }),
    ).toThrow();
  });

  it("the committed dev key matches the server's DEV_KEYS entry", () => {
    const pem = readFileSync(fileURLToPath(new URL("./dev-private-key.pem", import.meta.url)), "utf8");
    const keys = readFileSync(
      fileURLToPath(new URL("../../packages/api/src/license/keys.ts", import.meta.url)),
      "utf8",
    );
    const pub = /"dev-2026":\s*"([^"]+)"/.exec(keys)?.[1];
    expect(pub).toBeTruthy();
    expect(verifyLicense(signLicense(payload, pem), pub)).toMatchObject({ lid: "lic_test" });
  });
});
