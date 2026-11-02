import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { landingPath, LANDING_COOKIE } from "@/lib/landing";

/** `/` opens the screen the person chose as their start page (Settings › Profile), the inbox by default. */
export default function Home() {
  return (
    <Suspense>
      <Landing />
    </Suspense>
  );
}

async function Landing(): Promise<never> {
  return redirect(landingPath((await cookies()).get(LANDING_COOKIE)?.value));
}
