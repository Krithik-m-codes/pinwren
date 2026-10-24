// String trimming for URLs and paths without backtracking regexes. `/\/+$/` and `/[?#].*$/` look harmless
// but run in quadratic time on long runs of `/` or `#` (CodeQL js/polynomial-redos), and these run on
// input from visitors, API clients and settings forms.

/** `s` without trailing slashes: `https://x.com//` → `https://x.com`. */
export function trimTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* / */) end--;
  return s.slice(0, end);
}

/** `s` up to (not including) the first of `chars`: `cutAt("/a?b#c", "?#")` → `/a`. */
export function cutAt(s: string, chars: string): string {
  for (let i = 0; i < s.length; i++) {
    if (chars.includes(s.charAt(i))) return s.slice(0, i);
  }
  return s;
}
