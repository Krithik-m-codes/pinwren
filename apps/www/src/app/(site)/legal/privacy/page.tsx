import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { GITHUB_ISSUES_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy (draft)",
  description: "How the Pinwren website and live demo handle data. Draft — not legal advice.",
  alternates: { canonical: "/legal/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="22 October 2026">
      <h2>Who this covers</h2>
      <p>
        This page covers the Pinwren website (this site, including the docs and the live demo). It does not
        cover Pinwren instances that other people run: a self-hosted Pinwren server belongs to whoever
        operates it, and its data never reaches the Pinwren project.
      </p>
      <h2>What the website collects</h2>
      <ul>
        <li>
          <strong>No analytics or advertising trackers.</strong> The site loads no third-party scripts.
        </li>
        <li>
          <strong>Server logs.</strong> The hosting provider may keep standard request logs (IP address, user
          agent, time, URL) for security and operations.
        </li>
        <li>
          <strong>Your theme choice</strong> is stored in your browser’s local storage.
        </li>
      </ul>
      <h2>The live demo</h2>
      <ul>
        <li>
          Opening <Link href="/demo">/demo</Link> sets a functional cookie, <code>pinwren_demo</code>, with a
          random id for your private sandbox. It is not used for anything else.
        </li>
        <li>
          Comments, bug reports, screenshots and diagnostics you send in the demo are kept{" "}
          <strong>in memory only</strong> on the web server, are visible only to your browser, and are
          discarded after a few hours of inactivity, when you press “Reset demo”, or when the server restarts.
        </li>
        <li>
          The widget keeps a few things in your browser so nothing is lost on reload: the name and email you
          entered, your consent choice, unsent drafts and queued reports (local storage and IndexedDB). Clear
          site data to remove them.
        </li>
        <li>Please do not enter real personal data in the demo.</li>
      </ul>
      <h2>Your rights and contact</h2>
      <p>
        Questions or requests about this page: open an issue on{" "}
        <a href={GITHUB_ISSUES_URL} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        . A full privacy policy and data-processing terms will be published before Pinwren Cloud launches.
      </p>
    </LegalPage>
  );
}
