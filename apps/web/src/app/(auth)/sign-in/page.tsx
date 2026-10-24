import type { Metadata } from "next";
import { RedirectSignedIn } from "../redirect-signed-in";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <>
      <RedirectSignedIn searchParams={searchParams} />
      <SignInForm />
    </>
  );
}
