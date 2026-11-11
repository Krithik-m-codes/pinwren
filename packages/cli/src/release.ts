import { Pinwren, type Release } from "@pinwren/sdk";

type Fetch = typeof fetch;

const client = (url: string, token: string, fetchImpl?: Fetch) =>
  new Pinwren({ url, token, ...(fetchImpl ? { fetch: fetchImpl } : {}), userAgent: "pinwren-cli" });

/** A project by id or slug (CI knows the slug; the API wants the id). */
export async function resolveProject(
  url: string,
  token: string,
  idOrSlug: string,
  fetchImpl?: Fetch,
): Promise<{ id: string; name: string }> {
  const projects = await client(url, token, fetchImpl).projects.list();
  const hit = projects.find((p) => p.id === idOrSlug) ?? projects.find((p) => p.slug === idOrSlug);
  if (!hit) {
    const known = projects.map((p) => p.slug).join(", ") || "none";
    throw new Error(`No project "${idOrSlug}" for this token (projects: ${known})`);
  }
  return { id: hit.id, name: hit.name };
}

export type ReleaseCreateOptions = {
  project: string;
  version: string;
  commit?: string | undefined;
  notes?: string | undefined;
  deployedAt?: string | undefined;
};

/** Record a release (idempotent: the same version again updates it). Needs a `releases:write` token. */
export async function createRelease(url: string, token: string, o: ReleaseCreateOptions, fetchImpl?: Fetch) {
  const project = await resolveProject(url, token, o.project, fetchImpl);
  const out = await client(url, token, fetchImpl).releases.create(project.id, {
    version: o.version,
    ...(o.commit ? { commit: o.commit } : {}),
    ...(o.notes ? { notes: o.notes } : {}),
    ...(o.deployedAt ? { deployedAt: o.deployedAt } : {}),
  });
  return { project, ...out };
}

export async function listReleases(url: string, token: string, projectIdOrSlug: string, fetchImpl?: Fetch) {
  const project = await resolveProject(url, token, projectIdOrSlug, fetchImpl);
  return { project, releases: await client(url, token, fetchImpl).releases.list(project.id) };
}

export function formatReleases(releases: Release[]): string {
  if (!releases.length) return "No releases yet.";
  const width = Math.max(7, ...releases.map((r) => r.version.length));
  return releases
    .map(
      (r) =>
        `${r.version.padEnd(width)}  ${r.deployedAt.slice(0, 10)}  ${String(r.fixedCount).padStart(3)} fixed  ${String(r.regressionCount).padStart(3)} regressions${r.commit ? `  ${r.commit.slice(0, 10)}` : ""}`,
    )
    .join("\n");
}
