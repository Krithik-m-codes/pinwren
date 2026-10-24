// Every public URL the website links to, in one place. Change the domain or repository here only.

export const SITE_URL = "https://pinwren.xride-labs.in";
export const SITE_NAME = "Pinwren";
export const SITE_TAGLINE = "Pinned feedback and annotated bug reports for any website — self-hosted.";
export const SITE_DESCRIPTION =
  "Pinwren is a self-hostable visual feedback tool. One script tag lets clients pin comments on any element and send annotated bug reports with console errors and failed requests; your team triages them in a fast inbox.";

export const GITHUB_REPO = "Krithik-m-codes/pinwren";
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
export const GITHUB_ISSUES_URL = `${GITHUB_URL}/issues`;
export const GITHUB_DISCUSSIONS_URL = `${GITHUB_URL}/discussions`;
export const GITHUB_RELEASES_URL = `${GITHUB_URL}/releases`;
export const GITHUB_SECURITY_URL = `${GITHUB_URL}/security/advisories/new`;
/** Source of a file in the repository, e.g. `githubBlob("docker/compose.yml")`. */
export const githubBlob = (path: string) => `${GITHUB_URL}/blob/main/${path}`;

export const NPM_SCOPE = "@pinwren";
export const npmUrl = (pkg: string) => `https://www.npmjs.com/package/${pkg}`;

export const DOCKER_IMAGE = "ghcr.io/krithik-m-codes/pinwren";

export const VERSION = "0.1.0";

/** Absolute URL for a site path (canonical links, sitemap, JSON-LD). */
export const absoluteUrl = (path = "/") => new URL(path, SITE_URL).toString();
