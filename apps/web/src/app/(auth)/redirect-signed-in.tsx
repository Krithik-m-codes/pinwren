import type { Route } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { safeNext } from "@/lib/next-path";
import { getSession } from "@/lib/server/session";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Someone already signed in has nothing to do on sign-in, sign-up or forgot-password: send them on (to
 * `?next=` when it is a path on this site). Streams behind its own boundary, so the form itself stays in
 * the prerendered shell.
 */
export function RedirectSignedIn({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={null}>
      <Check searchParams={searchParams} />
    </Suspense>
  );
}

async function Check({ searchParams }: { searchParams: SearchParams }) {
  const session = await getSession();
  if (!session) return null;
  const next = (await searchParams).next;
  redirect(safeNext(typeof next === "string" ? next : null) as Route);
}
