import { ButtonLink } from "@/components/button-link";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main
        id="main"
        className="container-page grid min-h-[60vh] flex-1 place-items-center py-24 text-center"
      >
        <div>
          <p className="font-mono text-sm text-brand">404</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">This page has no pin</h1>
          <p className="mt-3 text-muted-foreground">
            The link may be old, or the page moved. Try the docs or the home page.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <ButtonLink href="/">Home</ButtonLink>
            <ButtonLink href="/docs/quickstart" variant="outline">
              Quickstart
            </ButtonLink>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
