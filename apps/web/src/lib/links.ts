/** `url` with one query parameter set (unchanged if it isn't a valid URL). */
export function withParam(url: string, key: string, value: string) {
  try {
    const u = new URL(url);
    u.searchParams.set(key, value);
    return u.toString();
  } catch {
    return url;
  }
}

/** Dashboard deep link to one item. */
export const itemLink = (id: string) =>
  `${typeof window === "undefined" ? "" : window.location.origin}/inbox?status=all&item=${id}`;
