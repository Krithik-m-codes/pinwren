import type { IssueProvider } from "@pinwren/core";
import type { TrackerAdapter } from "../sdk/types";
import { asana } from "./asana";
import { clickup } from "./clickup";
import { github } from "./github";
import { gitlab } from "./gitlab";
import { jira } from "./jira";
import { linearAdapter } from "./linear";
import { notion } from "./notion";
import { trello } from "./trello";

/**
 * Every tracker Pinwren can sync with. Adding one is: an adapter file, an entry here, the provider in core's
 * `ISSUE_PROVIDERS` (plus a migration for the `issue_provider` enum) — see docs/integrations/tracker-adapters.md.
 */
export const ADAPTERS: Record<IssueProvider, TrackerAdapter> = {
  github,
  gitlab,
  linear: linearAdapter,
  jira,
  trello,
  asana,
  clickup,
  notion,
};

export const adapterFor = (provider: IssueProvider): TrackerAdapter => ADAPTERS[provider];

/** Display names, for errors and the UI. */
export const PROVIDER_NAMES = Object.fromEntries(
  Object.entries(ADAPTERS).map(([id, a]) => [id, a.name]),
) as Record<IssueProvider, string>;
