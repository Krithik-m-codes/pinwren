/** URL parser errors carry their original input, including passwords; expose only a safe diagnostic. */
export function parseCloudDatabaseUrl(value: string): URL {
  try {
    const url = new URL(value);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      url.pathname.length < 2
    ) {
      throw new Error();
    }
    decodeURIComponent(url.username);
    decodeURIComponent(url.pathname);
    return url;
  } catch {
    throw new Error("Cloud database URLs must be valid PostgreSQL URLs naming a role, host and database");
  }
}

export function sameDatabaseEndpoint(a: URL, b: URL): boolean {
  return (
    a.hostname.toLowerCase() === b.hostname.toLowerCase() &&
    (a.port || "5432") === (b.port || "5432") &&
    decodeURIComponent(a.pathname) === decodeURIComponent(b.pathname)
  );
}
