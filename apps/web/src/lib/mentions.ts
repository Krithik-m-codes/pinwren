// @mentions in the comment composer (wave-5 contract §3.2): typing `@` opens a member list; picking one
// writes `@Name ` into the text and remembers the id. Only the ids whose `@Name` is still in the text are
// sent (`mentions: string[]`); the API checks that each is a member.

/** The text typed after an `@` that starts a word, up to the caret, or null when the caret isn't in one. */
export function mentionQuery(beforeCaret: string): string | null {
  const m = /(?:^|\s)@([^\s@]{0,30})$/.exec(beforeCaret);
  return m ? (m[1] ?? "") : null;
}

/** Replace the `@query` that ends at `caret` with `@Name `; returns the new text and caret. */
export function insertMention(text: string, caret: number, name: string): { text: string; caret: number } {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return { text, caret };
  const insert = `@${name} `;
  return { text: `${text.slice(0, at)}${insert}${text.slice(caret)}`, caret: at + insert.length };
}

/** Ids of the picked members whose `@Name` is still in the body. */
export function mentionsIn(body: string, picked: ReadonlyMap<string, string>): string[] {
  return [...picked].filter(([, name]) => body.includes(`@${name}`)).map(([id]) => id);
}

/** Members whose name or email matches the typed query (start of a word first). */
export function matchMembers<M extends { id: string; name: string; email: string }>(
  members: readonly M[],
  query: string,
  limit = 6,
): M[] {
  const q = query.toLowerCase();
  if (!q) return members.slice(0, limit);
  const starts = (m: M) =>
    m.name
      .toLowerCase()
      .split(/\s+/)
      .some((w) => w.startsWith(q)) || m.email.toLowerCase().startsWith(q);
  const contains = (m: M) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
  return [...members.filter(starts), ...members.filter((m) => !starts(m) && contains(m))].slice(0, limit);
}

/**
 * Splits a comment body into text and `@Name` parts for the members it mentions, so the timeline can
 * highlight them. Longer names win (so `@Ann Lee` isn't cut to `@Ann`); unknown `@words` stay plain text.
 */
export function mentionParts(body: string, names: readonly string[]): { text: string; mention: boolean }[] {
  const wanted = [...new Set(names.filter((n) => n.trim()))].sort((a, b) => b.length - a.length);
  if (!wanted.length) return [{ text: body, mention: false }];
  const escaped = wanted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(?<![\\w@])@(?:${escaped.join("|")})(?![\\w])`, "g");
  const parts: { text: string; mention: boolean }[] = [];
  let last = 0;
  for (const m of body.matchAll(re)) {
    if (m.index > last) parts.push({ text: body.slice(last, m.index), mention: false });
    parts.push({ text: m[0], mention: true });
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last), mention: false });
  return parts;
}
