import type { Metadata } from "next";
import { RedirectSignedIn } from "../redirect-signed-in";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage({ searchParams }: PageProps<"/forgot-password">) {
  return (
    <>
      <RedirectSignedIn searchParams={searchParams} />
      <ForgotPasswordForm />
    </>
  );
}
