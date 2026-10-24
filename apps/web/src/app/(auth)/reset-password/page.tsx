import type { Metadata } from "next";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

/** Reset links land here (emailed, or copied by an administrator). Open to signed-in people too. */
export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
