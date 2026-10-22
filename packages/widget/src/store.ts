// Small localStorage helpers. Storage can be missing or throw (private mode, blocked cookies), so every
// access is guarded and the widget works without it.

export type Reporter = { name?: string | undefined; email?: string | undefined };
/** A reporter the host app identified (wave-4 §4): `id` + `signature` make it a verified reporter. */
export type Identity = Reporter & { id?: string | undefined; signature?: string | undefined };
/** The consent notice a visitor accepted (wave-4 §6). */
export type Consent = { version: string; acceptedAt: string };
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
  } catch {
    // private browsing or a full quota: settings just won't persist
  }
}

const REPORTER = "pinwren:reporter";

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
    const list = read<unknown>(`pinwren:mine:${project}`, []);
    return Array.isArray(list)
      ? list.filter((m: unknown): m is Mine => typeof (m as { id?: unknown } | null)?.id === "string")
      : [];
  },
  addMine: (project: string, m: Mine) => {
    const list = store.mine(project).filter((x) => x.id !== m.id);
    list.unshift(m);
    write(`pinwren:mine:${project}`, list.slice(0, 300));
  },

  /**
   * The accepted notice for this project, when it is the current `version`. A changed notice text is a new
   * version and is asked for again. The page can write localStorage too, so only a well-formed record counts
   * (the bare `true` older widgets stored predates versions and is asked for once more).
   */
  consent: (project: string, version: string): Consent | null => {
    const c = read<unknown>(`pinwren:consent:${project}`, null) as Partial<Consent> | null;
    if (c?.version !== version || typeof c.acceptedAt !== "string") return null;
    return Number.isNaN(Date.parse(c.acceptedAt)) ? null : { version, acceptedAt: c.acceptedAt };
  },
  setConsent: (project: string, c: Consent) => write(`pinwren:consent:${project}`, c),
};
