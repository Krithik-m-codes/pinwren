import { ArrowRight, Bug, Keyboard, MousePointerClick, SquareDashedMousePointer } from "lucide-react";
import type { Metadata } from "next";
import { ButtonLink } from "@/components/button-link";
import { DemoWidget } from "@/components/demo/demo-widget";
import { ResetDemoButton } from "@/components/demo/reset-button";
import { SampleStore } from "@/components/demo/sample-store";

export const metadata: Metadata = {
  title: "Live demo",
  description:
    "Try the real Pinwren widget on a sample page: pin comments, drag over a region, send an annotated bug report, then see it in the inbox.",
  alternates: { canonical: "/demo" },
};

const TIPS = [
  {
    icon: MousePointerClick,
    text: "Click the launcher (bottom right) or press C, then click any element to pin a comment.",
  },
  {
    icon: SquareDashedMousePointer,
    text: "Drag over an area to comment on a region — or select text to quote it.",
  },
  {
    icon: Bug,
    text: "“Add to cart” is broken on purpose: press B and report it with an annotated screenshot.",
  },
  { icon: Keyboard, text: "Open the side panel to see every pin on the page, filter them and export." },
];

export default function DemoPage() {
  return (
    <div className="pb-24">
      <DemoWidget />
      <section className="border-b bg-background">
        <div className="container-page flex flex-col gap-6 py-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-brand text-sm font-semibold">Live demo</p>
            <h1 className="mt-1.5 text-3xl font-semibold tracking-tight sm:text-4xl">
              The real widget, on a sample page
            </h1>
            <p className="mt-3 text-muted-foreground">
              Below is a made-up client site with Pinwren installed. Your comments and reports go to a private
              sandbox that only your browser can see; it resets after a few hours.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/demo/inbox" className="bg-brand text-brand-foreground hover:bg-brand/90">
              Open your inbox
              <ArrowRight aria-hidden />
            </ButtonLink>
            <ResetDemoButton />
          </div>
        </div>
        <div className="container-page pb-8">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        <SampleStore />
      </section>
    </div>
  );
}
