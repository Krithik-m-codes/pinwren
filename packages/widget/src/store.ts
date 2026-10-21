// Small localStorage helpers. Storage can be missing or throw (private mode, blocked cookies), so every
// access is guarded and the widget works without it.

export type Reporter = { name?: string | undefined; email?: string | undefined };
export type Mine = { id: string; token?: string | undefined };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const REPORTER = "annota:reporter";

export const store = {
  reporter: (): Reporter => {
    const r = read<Reporter>(REPORTER, {});
    return {
      name: typeof r.name === "string" ? r.name : undefined,
      email: typeof r.email === "string" ? r.email : undefined,
    };
  },
  setReporter: (r: Reporter) => write(REPORTER, r),

  /** Feedback this browser sent, with the one-time reporter token that lets it resolve its own items. */
  mine: (project: string): Mine[] => {
    const list = read<unknown>(`annota:mine:${project}`, []);
    return Array.isArray(list) ? list.filter((m): m is Mine => typeof m?.id === "string") : [];
  },
  addMine: (project: string, m: Mine) => {
    const list = store.mine(project).filter((x) => x.id !== m.id);
    list.unshift(m);
    write(`annota:mine:${project}`, list.slice(0, 300));
  },

  consented: (project: string) => read<boolean>(`annota:consent:${project}`, false) === true,
  setConsented: (project: string) => write(`annota:consent:${project}`, true),
};
