/**
 * `s` without trailing slashes. A loop, not `/\/+$/`: that regex is quadratic on long runs of `/`
 * (CodeQL js/polynomial-redos), and these strings come from the host page.
 */
export function trimTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* / */) end--;
  return s.slice(0, end);
}
