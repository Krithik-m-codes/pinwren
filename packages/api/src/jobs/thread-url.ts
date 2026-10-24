import { safeHref } from "../email/markdown";
import { pageLinkUrl } from "../services/page-link";

/** Reporter emails are read days later: their thread links outlive the dashboard's 7-day "Open on page". */
export const REPORTER_LINK_TTL_DAYS = 30;

/**
 * `threadUrl` in reporter emails: the page, opened on their feedback with a signed token (works while pins
 * are private), or the plain page when it can't be built; empty when the page isn't a web address.
 */
export function reporterThreadUrl(feedbackId: string, pageUrl: string | null): string {
  const page = pageUrl ? safeHref(pageUrl) : null;
  if (!page || !/^https?:/i.test(page)) return "";
  try {
    return pageLinkUrl(feedbackId, page, REPORTER_LINK_TTL_DAYS).url;
  } catch {
    return page;
  }
}
