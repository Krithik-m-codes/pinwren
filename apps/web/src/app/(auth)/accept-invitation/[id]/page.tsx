import type { Metadata } from "next";
import { Suspense } from "react";
import { AcceptInvitation } from "./accept-invitation";

export const metadata: Metadata = { title: "Join workspace" };

export default function AcceptInvitationPage({ params }: PageProps<"/accept-invitation/[id]">) {
  return (
    <Suspense>
      <AcceptInvitation params={params} />
    </Suspense>
  );
}
