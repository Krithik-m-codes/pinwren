import { ArrowRight, Heart, Users } from "lucide-react";
import { ButtonLink } from "@/components/button-link";

const BUY_ME_COFFEE_URL = "https://www.buymeacoffee.com/krithikm92f";
const GITHUB_SPONSORS_URL = "https://github.com/sponsors/Krithik-m-codes";

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
              Run Pinwren on your own server in about five minutes, or click around the live demo first —
              it&apos;s the real widget.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <ButtonLink
                href="/docs/quickstart"
                size="lg"
                className="h-10 bg-brand px-4 text-brand-foreground hover:bg-brand/90"
              >
                Self-host for free
                <ArrowRight aria-hidden />
              </ButtonLink>
              <ButtonLink href="/demo" variant="outline" size="lg" className="h-10 px-4">
                Open the demo
              </ButtonLink>
            </div>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <a
                href={BUY_ME_COFFEE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 px-4 py-2 text-sm font-medium text-orange-600 transition-colors hover:bg-orange-500/20 dark:text-orange-400"
                aria-label="Buy me a coffee"
              >
                <Heart className="size-4" aria-hidden />
                Buy me a coffee
              </a>
              <a
                href={GITHUB_SPONSORS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-purple-500/30 bg-purple-500/10 px-4 py-2 text-sm font-medium text-purple-600 transition-colors hover:bg-purple-500/20 dark:text-purple-400"
                aria-label="Sponsor on GitHub"
              >
                <Users className="size-4" aria-hidden />
                Sponsor us
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
