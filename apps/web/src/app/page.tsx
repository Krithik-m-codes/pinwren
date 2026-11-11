import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { landingPath, LANDING_COOKIE } from "@/lib/landing";
import { serverApi } from "@/lib/server/api";

/**
 * `/` opens the screen the person chose as their start page (Settings › Profile), the inbox by default. The
 * cookie answers at once; a browser that has none yet asks the account (the choice follows the person, ADR 0037).
 */
export default function Home() {
  return (
    <Suspense>
      <Landing />
    </Suspense>
  );
}

async function Landing(): Promise<never> {
  const cookie = (await cookies()).get(LANDING_COOKIE)?.value;
  if (!cookie) {
    const account = await serverApi<{ uiState: { startPage: string | null } }>("/me/ui-state");
    if (account.ok) return redirect(landingPath(account.data.uiState.startPage));
  }
  return redirect(landingPath(cookie));
}
