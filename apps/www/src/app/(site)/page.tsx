import type { Metadata } from "next";
import { JsonLd } from "@/components/json-ld";
import { Comparison } from "@/components/landing/comparison";
import { FinalCta } from "@/components/landing/cta";
import { Faq, FAQ } from "@/components/landing/faq";
import { Features } from "@/components/landing/features";
import { Frameworks } from "@/components/landing/frameworks";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { absoluteUrl, GITHUB_URL, SITE_DESCRIPTION, SITE_NAME, VERSION } from "@/lib/site";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const SOFTWARE = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  description: SITE_DESCRIPTION,
  url: absoluteUrl("/"),
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Linux, macOS, Windows (Docker)",
  softwareVersion: VERSION,
  license: "https://www.gnu.org/licenses/agpl-3.0.html",
  codeRepository: GITHUB_URL,
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    description: "Free to self-host (Community edition)",
  },
};

const FAQ_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.text },
  })),
};

export default function Home() {
  return (
    <>
      <JsonLd data={SOFTWARE} />
      <JsonLd data={FAQ_LD} />
      <Hero />
      <Frameworks />
      <Features />
      <HowItWorks />
      <Comparison />
      <Faq />
      <FinalCta />
    </>
  );
}
