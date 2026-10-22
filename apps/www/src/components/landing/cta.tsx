import { ArrowRight } from "lucide-react";
import { ButtonLink } from "@/components/button-link";

export function FinalCta() {
  return (
    <section className="py-24">
      <div className="container-page">
        <div className="relative overflow-hidden rounded-3xl border bg-card px-6 py-16 text-center shadow-sm sm:px-12">
          <div className="bg-dots absolute inset-0 -z-0 [mask-image:radial-gradient(60%_70%_at_50%_100%,black,transparent)] opacity-50" />
          <div className="relative">
            <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Stop collecting feedback in screenshots and email threads
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-muted-foreground">
              Run Pinwren on your own server in about five minutes, or click around the live demo first — it’s
              the real widget.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <ButtonLink
                href="/docs/quickstart"
                size="lg"
                className="bg-brand text-brand-foreground hover:bg-brand/90 h-10 px-4"
              >
                Self-host for free
                <ArrowRight aria-hidden />
              </ButtonLink>
              <ButtonLink href="/demo" variant="outline" size="lg" className="h-10 px-4">
                Open the demo
              </ButtonLink>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
