import { idbKV } from "./idb";

// The core only needs to know whether a bug-report draft is waiting (for the menu's "unsent draft" line);
// reading and validating it belongs to the report chunk (report.ts `readDraft`), which uses the same store.
const drafts = idbKV<{ v?: unknown; clientId?: unknown }>("drafts");

export const hasDraft = (project: string) =>
  drafts
    .get(project)
    .then((d) => d?.v === 1 && typeof d.clientId === "string")
    .catch(() => false);
