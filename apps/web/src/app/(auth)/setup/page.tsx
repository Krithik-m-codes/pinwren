import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSession } from "@/lib/server/session";

export const metadata: Metadata = { title: "Set up" };

/**
 * The old setup-token claim (ADR 0021, amended): the first account now administers the instance, so this
 * only forwards old links and bookmarks — to the inbox when signed in, else to create that account.
 */
export default function SetupPage() {
  return (
    <Suspense fallback={null}>
      <Forward />
    </Suspense>
  );
}

async function Forward(): Promise<null> {
  redirect((await getSession()) ? "/inbox" : "/sign-up");
}
