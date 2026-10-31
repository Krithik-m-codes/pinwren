// Post-deploy sanity check: node scripts/post-deploy-check.mjs [baseUrl]   (default PINWREN_URL)
// /api/health answers 200 only after the Cloud startup guard (roles, grants, RLS, policies) passed;
// a failed guard keeps it at 500, so a 200 here also proves the database was provisioned correctly.
// Exits non-zero on the first failed check.
const base = (process.argv[2] ?? process.env.PINWREN_URL ?? "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error("usage: node scripts/post-deploy-check.mjs https://app.example.com");
  process.exit(2);
}

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed = true;
};

// A rolling deploy can take a minute to pass its health check; retry before failing.
let health;
for (let attempt = 1; attempt <= 12; attempt++) {
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(8000) });
    health = { status: res.status, body: await res.json().catch(() => null) };
    if (res.status === 200) break;
  } catch (e) {
    health = { status: 0, body: null, error: String(e.message ?? e) };
  }
  await new Promise((r) => setTimeout(r, 5000));
}
check("health answers 200 (Cloud startup guard passed)", health?.status === 200, `status ${health?.status}`);
check("health body is { ok: true }", health?.body?.ok === true, health?.body?.version ?? health?.error ?? "");

if (base.startsWith("https://")) {
  const res = await fetch(base.replace("https://", "http://") + "/api/health", { redirect: "manual" }).catch(
    () => null,
  );
  check(
    "plain HTTP redirects to HTTPS",
    !!res && [301, 302, 307, 308].includes(res.status),
    `status ${res?.status}`,
  );
}

const home = await fetch(base, { redirect: "manual" }).catch(() => null);
check("dashboard responds", !!home && home.status < 500, `status ${home?.status}`);
check(
  "strict-transport-security header present",
  !!home?.headers.get("strict-transport-security"),
  home?.headers.get("strict-transport-security") ?? "missing",
);

if (failed) {
  console.error("\nFAILED. Read `fly logs` for a 'Cloud' startup error before changing anything else.");
  process.exit(1);
}
console.log("\nall checks passed");
