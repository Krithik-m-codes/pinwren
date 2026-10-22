import { Pinwren } from "@pinwren/sdk";

// `pinwren doctor` and `pinwren status`. Each check reports instead of throwing, so one failure doesn't
// hide the rest.

export type Check = { name: string; ok: boolean; detail: string; warn?: boolean };

type Fetch = typeof fetch;

async function get(fetchImpl: Fetch, url: string, headers: Record<string, string> = {}) {
  try {
    const res = await fetchImpl(url, { headers, redirect: "manual", signal: AbortSignal.timeout(10_000) });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // not JSON
    }
    return { status: res.status, headers: res.headers, text, json: json as Record<string, unknown> | null };
  } catch (err) {
    return {
      status: 0,
      headers: new Headers(),
      text: err instanceof Error ? err.message : String(err),
      json: null,
    };
  }
}

export type DoctorInput = { url: string; projectKey?: string | undefined; origin?: string | undefined };

export async function doctor(input: DoctorInput, fetchImpl: Fetch = fetch): Promise<Check[]> {
  const checks: Check[] = [];
  const health = await get(fetchImpl, `${input.url}/api/health`);
  const version = typeof health.json?.version === "string" ? health.json.version : null;
  checks.push(
    health.status === 200 && health.json?.ok === true
      ? { name: "server", ok: true, detail: `reachable${version ? `, Pinwren ${version}` : ""}` }
      : {
          name: "server",
          ok: false,
          detail: health.status
            ? `GET /api/health answered ${health.status}`
            : `unreachable (${health.text})`,
        },
  );
  if (health.status === 0) return checks;

  const script = await get(fetchImpl, `${input.url}/widget.js`);
  const type = script.headers.get("content-type") ?? "";
  checks.push(
    script.status === 200 && type.includes("javascript")
      ? { name: "widget.js", ok: true, detail: "served" }
      : { name: "widget.js", ok: false, detail: `GET /widget.js answered ${script.status} ${type}`.trim() },
  );

  if (!input.projectKey) {
    checks.push({
      name: "widget config",
      ok: true,
      warn: true,
      detail: "skipped (pass --key pk_… to check a project)",
    });
    return checks;
  }
  const origin = input.origin ?? new URL(input.url).origin;
  const cfg = await get(fetchImpl, `${input.url}/w/config`, { "x-pinwren-key": input.projectKey, origin });
  const code = typeof cfg.json?.code === "string" ? cfg.json.code : "";
  if (cfg.status === 200) {
    const project = (cfg.json?.project ?? {}) as { name?: unknown };
    checks.push({
      name: "widget config",
      ok: true,
      detail: `project "${typeof project.name === "string" ? project.name : "?"}" accepts ${origin}`,
    });
  } else if (code === "ORIGIN_NOT_ALLOWED") {
    checks.push({
      name: "widget config",
      ok: false,
      detail: `${origin} is not on the project's allowed origins (Settings › Install)`,
    });
  } else if (code === "INVALID_PROJECT_KEY" || cfg.status === 401) {
    checks.push({ name: "widget config", ok: false, detail: "unknown or archived project key" });
  } else {
    checks.push({
      name: "widget config",
      ok: false,
      detail: `GET /w/config answered ${cfg.status} ${code}`.trim(),
    });
  }
  return checks;
}

export type StatusResult = {
  user: string | null;
  role: string;
  projects: { id: string; name: string; openCount: number }[];
};

export async function status(url: string, token: string, fetchImpl: Fetch = fetch): Promise<StatusResult> {
  const client = new Pinwren({ url, token, fetch: fetchImpl, userAgent: "pinwren-cli" });
  const who = (await (await client.request("GET", "/token")).json()) as {
    user: { name: string } | null;
    role: string;
  };
  const projects = await client.projects.list();
  return {
    user: who.user?.name ?? null,
    role: who.role,
    projects: projects.map((p) => ({ id: p.id, name: p.name, openCount: p.openCount })),
  };
}
