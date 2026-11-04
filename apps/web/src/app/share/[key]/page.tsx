import type { Metadata } from "next";
import { Suspense } from "react";
import { BrowserLocale } from "@/lib/i18n/browser-locale";
import { ShareView } from "./share-view";
import ShareLoading from "./loading";

// The page behind a share link: no account, no team shell. The token stays in the URL fragment.
export const metadata: Metadata = {
  title: "Shared feedback",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

async function SharePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return (
    <>
      <BrowserLocale />
      <ShareView key={key} projectKey={key} />
    </>
  );
}

export default function Page({ params }: { params: Promise<{ key: string }> }) {
  return (
    <Suspense fallback={<ShareLoading />}>
      <SharePage params={params} />
    </Suspense>
  );
}
