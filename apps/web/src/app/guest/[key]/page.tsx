import type { Metadata } from "next";
import { Suspense } from "react";
import { BrowserLocale } from "@/lib/i18n/browser-locale";
import { GuestPortal } from "./guest-portal";
import GuestPortalLoading from "./loading";

export const metadata: Metadata = {
  title: "Your feedback",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

async function GuestPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return (
    <>
      <BrowserLocale />
      <GuestPortal key={key} projectKey={key} />
    </>
  );
}

export default function Page({ params }: { params: Promise<{ key: string }> }) {
  return (
    <Suspense fallback={<GuestPortalLoading />}>
      <GuestPage params={params} />
    </Suspense>
  );
}
