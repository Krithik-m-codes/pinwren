import type { Metadata } from "next";
import { Suspense } from "react";
import type { FeedbackList } from "@/lib/api";
import { inboxArgsFromParams, listQueryString } from "@/lib/inbox-filters";
import { serverApi } from "@/lib/server/api";
import { HydrateQueries } from "@/lib/store/hydrate";
import { InboxSkeleton } from "./inbox-skeleton";
import { InboxView } from "./inbox-view";

export const metadata: Metadata = { title: "Inbox" };

export default function InboxPage({ searchParams }: PageProps<"/inbox">) {
  return (
    <Suspense fallback={<InboxSkeleton />}>
      <InboxData searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * The first page of the list is fetched on the server (the same query the client would run, parsed from
 * the same URL) and seeded into RTK Query: the inbox renders filled, with no second request. Filter
 * changes after that stay in the browser (History API + RTK Query).
 */
async function InboxData({ searchParams }: { searchParams: PageProps<"/inbox">["searchParams"] }) {
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") sp.set(k, v);
  const args = inboxArgsFromParams(sp);
  const list = await serverApi<FeedbackList>(`/feedback?${listQueryString(args)}`);
  return (
    <HydrateQueries
      key={listQueryString(args)}
      entries={list.ok ? [{ endpointName: "listFeedback", arg: args, value: list.data }] : []}
    >
      <InboxView />
    </HydrateQueries>
  );
}
