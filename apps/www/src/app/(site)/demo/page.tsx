import { ArrowRight, Bug, ListChecks, MousePointerClick, SlidersHorizontal } from "lucide-react";
import type { Metadata } from "next";
import { ButtonLink } from "@/components/button-link";
import { Playground } from "@/components/demo/playground/playground";
import { SampleSite } from "@/components/demo/sample-site";

export const metadata: Metadata = {
  title: "Live demo",
  description:
    "Try the real Pinwren widget in a playground: switch theme, language, position and accent, then pin feedback, report a bug and manage it all from the sidebar.",
  alternates: { canonical: "/demo" },
};

const TIPS = [
  {
    icon: MousePointerClick,
    text: "Open the launcher (bottom right) and pick “Create new annotation” — or press C — then click or drag on the page.",
  },
  {
    icon: Bug,
    text: "“Book a call” is broken on purpose: press B and report it with an annotated screenshot and diagnostics.",
  },
  {
    icon: ListChecks,
    text: "“Show sidebar” lists every item: filter, search, resolve, delete your own and export.",
  },
  {
    icon: SlidersHorizontal,
    text: "The playground panel changes the widget live: theme, language, position, accent and features.",
  },
];

export default function DemoPage() {
  return (
    <div className="pb-24">
      <Playground />
      <div className="lg:pl-[19.5rem]">
        <section className="border-b bg-background">
          <div className="container-page flex flex-col gap-6 py-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-brand text-sm font-semibold">Live demo</p>
              <h1 className="mt-1.5 text-3xl font-semibold tracking-tight sm:text-4xl">Widget playground</h1>
              <p className="mt-3 text-muted-foreground">
                Below is a made-up agency site with the real Pinwren widget on it. In Server API mode your
                feedback goes to a private sandbox that resets every 10 minutes; in Local mode it never leaves
                this browser.
              </p>
            </div>
            <ButtonLink href="/demo/inbox" className="bg-brand text-brand-foreground hover:bg-brand/90">
              Open your inbox
              <ArrowRight aria-hidden />
            </ButtonLink>
          </div>
          <div className="container-page pb-8">
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {TIPS.map((t) => (
                <li key={t.text} className="flex gap-3 rounded-xl border bg-card p-3.5 text-sm shadow-xs">
                  <t.icon className="text-brand mt-0.5 size-4 shrink-0" aria-hidden />
                  <span className="text-muted-foreground">{t.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section aria-label="Sample client website" className="container-page pt-10">
          <SampleSite />
        </section>
      </div>
    </div>
  );
}
