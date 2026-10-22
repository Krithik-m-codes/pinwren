import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { githubBlob } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms (draft)",
  description: "Terms for using the Pinwren website and live demo. Draft — not legal advice.",
  alternates: { canonical: "/legal/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms" updated="22 October 2026">
      <h2>The software</h2>
      <p>
        Pinwren is open-source software. The server and dashboard are licensed under the{" "}
        <a href={githubBlob("LICENSE")} target="_blank" rel="noopener noreferrer">
          GNU Affero General Public License v3.0
        </a>
        ; the widget, SDK, React, MCP and CLI packages under the MIT licence. Those licences — not this page —
        govern your use of the code, and both come without warranty. See{" "}
        <Link href="/docs/licensing">Editions & licensing</Link>.
      </p>
      <h2>This website and the demo</h2>
      <ul>
        <li>
          The site and the live demo are provided as they are, free of charge, without any guarantee of
          availability.
        </li>
        <li>
          Use the demo to try Pinwren. Don’t submit personal or confidential data, don’t try to disrupt the
          service or other visitors, and don’t use it to store or distribute content. Requests are
          rate-limited.
        </li>
        <li>Demo data is temporary and may be deleted at any time.</li>
      </ul>
      <h2>Pinwren Cloud and Enterprise</h2>
      <p>
        Hosted plans and commercial Enterprise licences are not available yet. They will come with their own
        terms, which will be published here before launch.
      </p>
      <h2>Trademarks</h2>
      <p>
        “Pinwren” and the Pinwren logo identify the project. Forks are welcome under the licences above;
        please use a different name for a modified hosted service so people aren’t confused about who runs it.
      </p>
    </LegalPage>
  );
}
