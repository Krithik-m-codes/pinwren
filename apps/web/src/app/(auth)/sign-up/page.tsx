import type { Metadata } from "next";
import { RedirectSignedIn } from "../redirect-signed-in";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  return (
    <>
      <RedirectSignedIn searchParams={searchParams} />
      <SignUpForm />
    </>
  );
}
