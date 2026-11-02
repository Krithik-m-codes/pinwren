// Pure rules for the soft prompts (update strip, support card). Kept free of React and storage so the
// timing is unit-tested; the hook that persists the state is in ./storage.ts (ADR 0025).

export const REPO_URL = "https://github.com/Krithik-m-codes/pinwren";
export const SPONSOR_URL = "https://github.com/sponsors/Krithik-m-codes";

const DAY = 86_400_000;
/** Days a person has used Pinwren before the first support card. */
export const SUPPORT_AFTER_DAYS = 14;
/** Quiet period after dismissing the support card. */
export const SUPPORT_SNOOZE_DAYS = 30;
/** Quiet period after they acted on it (starred / opened sponsors). */
export const SUPPORT_ACTED_SNOOZE_DAYS = 90;

export type NudgeState = {
  /** First time this person opened the dashboard on this browser (ISO). */
  firstSeen: string | null;
  /** Release tag whose update strip was dismissed; a newer release shows it again. */
  dismissedUpdate: string | null;
  /** Support card hidden until this moment (ISO). */
  supportSnoozedUntil: string | null;
  /** "Don't ask again". */
  supportOptOut: boolean;
};

export const emptyNudgeState: NudgeState = {
  firstSeen: null,
  dismissedUpdate: null,
  supportSnoozedUntil: null,
  supportOptOut: false,
};

/** Read stored JSON defensively: anything unreadable is the empty state. */
export function parseNudgeState(raw: string | null): NudgeState {
  if (!raw) return emptyNudgeState;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof NudgeState, unknown>>;
    const str = (x: unknown) => (typeof x === "string" && x.length <= 100 ? x : null);
    return {
      firstSeen: str(v.firstSeen),
      dismissedUpdate: str(v.dismissedUpdate),
      supportSnoozedUntil: str(v.supportSnoozedUntil),
      supportOptOut: v.supportOptOut === true,
    };
  } catch {
    return emptyNudgeState;
  }
}

/** The update strip shows for a release this person has not dismissed. */
export function updateStripVisible(state: NudgeState, latest: string | null): boolean {
  return !!latest && state.dismissedUpdate !== latest;
}

/** The support card shows after SUPPORT_AFTER_DAYS of use, outside a snooze, unless opted out. */
export function supportCardVisible(state: NudgeState, now: number): boolean {
  if (state.supportOptOut || !state.firstSeen) return false;
  const first = Date.parse(state.firstSeen);
  if (Number.isNaN(first) || now - first < SUPPORT_AFTER_DAYS * DAY) return false;
  if (state.supportSnoozedUntil) {
    const until = Date.parse(state.supportSnoozedUntil);
    if (!Number.isNaN(until) && now < until) return false;
  }
  return true;
}

export function snoozeUntil(now: number, days: number): string {
  return new Date(now + days * DAY).toISOString();
}

/** Human form of a release tag for the pull command: "v1.2.3" and "1.2.3" both give "1.2.3". */
export function versionNumber(tag: string): string {
  return tag.replace(/^v/i, "");
}
