import type { Metadata } from "next";
import { Suspense } from "react";
import { SlackLink } from "./slack-link";

export const metadata: Metadata = { title: "Link your Slack account" };

export default function SlackLinkPage() {
  return (
    <Suspense>
      <SlackLink />
    </Suspense>
  );
}
