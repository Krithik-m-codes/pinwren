import Link from "next/link";
import type { ReactNode } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const A = ({
  href,
  children,
}: {
  href:
    | "/docs/licensing"
    | "/docs/widget/anchoring"
    | "/docs/self-hosting"
    | "/docs/api/mcp"
    | "/pricing"
    | "/docs/widget/privacy";
  children: ReactNode;
}) => (
  <Link href={href} className="font-medium text-foreground underline underline-offset-4">
    {children}
  </Link>
);

export const FAQ: { q: string; a: ReactNode; text: string }[] = [
  {
    q: "Is it really free?",
    text: "Yes. The self-hosted Community edition has every collection, triage and routing feature, for unlimited projects, seats and reports. Paid plans will cover organisation-scale needs (SSO, audit, white-label) and the hosted Cloud.",
    a: (
      <>
        Yes. The self-hosted Community edition has every collection, triage and routing feature — for
        unlimited projects, seats and reports. Paid plans will cover organisation-scale needs (SSO, audit,
        white-label) and the hosted Cloud. See <A href="/pricing">pricing</A>.
      </>
    ),
  },
  {
    q: "What does the AGPL licence mean for me?",
    text: "You can use, modify and self-host the server commercially. If you modify it and let other people use it over a network, you must offer them your modified source. The widget, SDK, React, MCP and CLI packages are MIT, so embedding Pinwren in your site places no obligations on your code.",
    a: (
      <>
        You can use, modify and self-host the server commercially. If you modify it and let other people use
        it over a network, you must offer them your modified source. The widget, SDK, React, MCP and CLI
        packages are MIT, so embedding Pinwren in your site places no obligations on your own code.{" "}
        <A href="/docs/licensing">Editions & licensing</A>
      </>
    ),
  },
  {
    q: "Will the widget slow my site down?",
    text: "The core is about 26 KB gzip and runs in a closed Shadow DOM with no global CSS or JS. The side panel, report form, screenshot engine, replay recorder and each language are separate files loaded only when a visitor needs them.",
    a: (
      <>
        The core is about 26 KB gzip and runs in a closed Shadow DOM with no global CSS or JS. The side panel,
        report form, screenshot engine, replay recorder and each language are separate files, loaded only when
        a visitor needs them.
      </>
    ),
  },
  {
    q: "Do pins survive a redesign?",
    text: "Pins are anchored to the element, not to pixels: an explicit data-pinwren-anchor, test id or id first, then CSS selector, XPath and a fuzzy text match. Pins that can't be placed are listed in the side panel instead of disappearing.",
    a: (
      <>
        Pins are anchored to the element, not to pixels: an explicit <code>data-pinwren-anchor</code>, test id
        or id first, then CSS selector, XPath and a fuzzy text match. Pins that can’t be placed are listed in
        the side panel instead of silently disappearing.{" "}
        <A href="/docs/widget/anchoring">How anchoring works</A>
      </>
    ),
  },
  {
    q: "Do clients need an account?",
    text: "No. Visitors comment straight from the page and may leave a name and email. The widget identifies itself with the project's public key and is only accepted from the sites you allow.",
    a: (
      <>
        No. Visitors comment straight from the page and may leave a name and email. The widget identifies
        itself with the project’s public key, and the server only accepts it from the sites you allow — no
        secret ever reaches the browser.
      </>
    ),
  },
  {
    q: "Where is the data stored?",
    text: "On your server: Postgres for data, and local disk or any S3-compatible bucket for screenshots and attachments. Nothing is sent to us; the only optional outbound call is a daily update check you can turn off.",
    a: (
      <>
        On your server: Postgres for the data, and local disk or any S3-compatible bucket for screenshots and
        attachments. Nothing is sent to us; the only outbound call is an optional daily update check you can
        turn off. <A href="/docs/widget/privacy">Privacy & masking</A>
      </>
    ),
  },
  {
    q: "Is there a hosted version?",
    text: "Pinwren Cloud is coming soon. Until then, self-hosting is one Docker container plus Postgres.",
    a: (
      <>
        Pinwren Cloud is coming soon. Until then, self-hosting is one Docker container plus Postgres —{" "}
        <A href="/docs/self-hosting">the guide</A> takes about five minutes.
      </>
    ),
  },
  {
    q: "Can AI coding agents work with the feedback?",
    text: "Yes. The MCP server lets Claude Code, Cursor and other MCP clients search feedback, read the reproduction context and comment on or resolve items, with a scoped API token.",
    a: (
      <>
        Yes. The MCP server lets Claude Code, Cursor and other MCP clients search feedback, read the
        reproduction context, comment and resolve — with a scoped API token.{" "}
        <A href="/docs/api/mcp">MCP setup</A>
      </>
    ),
  },
  {
    q: "Which frameworks does it work with?",
    text: "Any website: the script tag works with plain HTML, WordPress, Webflow and every framework. For bundled apps there is an npm package and a React component.",
    a: (
      <>
        Any website. The script tag works with plain HTML, WordPress, Webflow and every framework; single-page
        apps are followed across route changes. For bundled apps there is an npm package and a React
        component.
      </>
    ),
  },
];

export function Faq() {
  return (
    <section id="faq" className="scroll-mt-20 border-b py-24">
      <div className="container-page grid gap-10 lg:grid-cols-[1fr_1.6fr]">
        <div>
          <p className="text-brand text-sm font-semibold">FAQ</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">Questions, answered</h2>
          <p className="mt-4 text-muted-foreground">
            More in the{" "}
            <Link href="/docs/faq" className="font-medium text-foreground underline underline-offset-4">
              docs FAQ
            </Link>
            , or ask in GitHub Discussions.
          </p>
        </div>
        <Accordion className="rounded-2xl border bg-card px-5 shadow-xs">
          {FAQ.map((item) => (
            <AccordionItem key={item.q} value={item.q}>
              <AccordionTrigger>{item.q}</AccordionTrigger>
              <AccordionContent className="[&_code]:font-mono [&_code]:text-[13px]">
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
